import { SmartAccount } from "../SmartAccount";
import { BaseUserOperationDummyValues, CALIBUR_UNISWAP_V1_0_0_SINGLETON_ADDRESS, ENTRYPOINT_V8, ZeroAddress } from "src/constants";
import {
	createCallData, createUserOperationHash, fetchAccountNonce,
	getDelegatedAddress, getFunctionSelector, handlefetchGasPrice, sendJsonRpcRequest
} from "../../utils";
import { UserOperationV8 } from "src/types";
import { AbstractionKitError } from "src/errors";
import {
	Authorization7702Hex, bigintToHex,
	createAndSignEip7702RawTransaction,
	createRevokeDelegationAuthorization,
} from "src/utils7702";
import { Bundler } from "src/Bundler";
import { Wallet, AbiCoder, keccak256 } from "ethers";
import { SendUseroperationResponse } from "../SendUseroperationResponse";
import { SimpleMetaTransaction } from "../simple/Simple7702Account";
import { PrependTokenPaymasterApproveAccount } from "src/paymaster/types";
import {
	CaliburKeyType, CaliburKey, CaliburKeySettings, CaliburKeySettingsResult,
	WebAuthnSignatureData, CaliburCreateUserOperationOverrides,
	CaliburSignatureOverrides, SignerFunction,
} from "./types";


const DEFAULT_SINGLETON_ADDRESS = CALIBUR_UNISWAP_V1_0_0_SINGLETON_ADDRESS;

/** Root key hash (bytes32 zero) — used for the EOA's own secp256k1 key */
const ROOT_KEY_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";

// Function selectors — computed from Calibur's actual Solidity interfaces:
// - executeUserOp is IAccountExecute.executeUserOp(PackedUserOperation,bytes32)
//   The EntryPoint calls this; userOp.callData = selector + abi.encode(BatchedCall)
// - register takes Key struct: register((uint8,bytes))
// - update/revoke/invalidateNonce match standard signatures

/** executeUserOp selector — `executeUserOp((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes),bytes32)` from IAccountExecute */
const EXECUTE_USER_OP_SELECTOR = "0x8dd7712f";
/** register((uint8,bytes)) — registers a Key struct */
const REGISTER_SELECTOR = "0x30b1fa3b";
/** update(bytes32,uint256) — updates key settings */
const UPDATE_SELECTOR = "0xa58bb84a";
/** revoke(bytes32) — revokes a key by hash */
const REVOKE_SELECTOR = "0xb75c7dc6";
/** invalidateNonce(uint256) — invalidates nonces */
const INVALIDATE_NONCE_SELECTOR = "0xb70e36f0";

// Read function selectors
/** isRegistered(bytes32) */
const IS_REGISTERED_SELECTOR = "0x27258b22";
/** getKeySettings(bytes32) — returns packed Settings (uint256) */
const GET_KEY_SETTINGS_SELECTOR = "0x0f3ebf6e";
/** getKey(bytes32) — returns Key struct (uint8,bytes) */
const GET_KEY_SELECTOR = "0x12aaac70";
/** keyCount() */
const KEY_COUNT_SELECTOR = "0xfac750e0";
/** keyAt(uint256) — returns Key struct */
const KEY_AT_SELECTOR = "0x4223b5c2";

/**
 * EIP-7702 smart account implementation for the Calibur (Uniswap) singleton.
 * Calibur turns an EOA into a smart account via EIP-7702 delegation, providing
 * batched transactions, passkey signing, ERC-4337 support, and per-key hooks.
 *
 * Unlike Safe accounts, there is no factory or proxy — the EOA IS the account.
 * All transactions go through `executeUserOp(bytes)` with `BatchedCall` encoding.
 *
 * @example
 * ```typescript
 * const account = new Calibur7702Account("0xMyEOA");
 * const userOp = await account.createUserOperation(
 *     [{ to: "0xRecipient", value: 1000000000000000n, data: "0x" }],
 *     nodeRpc, bundlerRpc,
 *     { eip7702Auth: { chainId: 11155111n } }
 * );
 * userOp.signature = account.signUserOperation(userOp, privateKey, 11155111n);
 * const response = await account.sendUserOperation(userOp, bundlerRpc);
 * ```
 */
export class Calibur7702Account extends SmartAccount
	implements PrependTokenPaymasterApproveAccount {

	/** Function selector for `executeUserOp(bytes)` */
	static readonly executorFunctionSelector = EXECUTE_USER_OP_SELECTOR;

	/**
	 * Dummy ECDSA signature for gas estimation with root key signing.
	 * Format: `abi.encode(bytes32 keyHash, bytes sig, bytes hookData)`
	 */
	static readonly dummySignature: string = AbiCoder.defaultAbiCoder().encode(
		["bytes32", "bytes", "bytes"],
		[
			ROOT_KEY_HASH,
			"0xd2614025fc173b86704caf37b2fb447f7618101a0d31f5f304c777024cef38a060a29ee43fcf0c46f9107d4f670b8a85c2c017a1fe9e4af891f24f0be6ba5d671c",
			"0x",
		],
	);

	/**
	 * Create a dummy WebAuthn signature for gas estimation with passkey signing.
	 * The key hash must correspond to an actually registered key on the account,
	 * otherwise the contract's `validateUserOp` will revert with `KeyDoesNotExist`.
	 *
	 * @param keyHash - The key hash of a registered passkey (from {@link getKeyHash})
	 * @returns A dummy signature suitable for passing as `dummySignature` override
	 */
	public static createDummyWebAuthnSignature(keyHash: string): string {
		const abiCoder = AbiCoder.defaultAbiCoder();
		const dummyClientDataJSON = '{"type":"webauthn.get","challenge":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","origin":"https://example.com","crossOrigin":false}';
		const challengeIndex = BigInt(dummyClientDataJSON.indexOf('"challenge":"'));
		const typeIndex = BigInt(dummyClientDataJSON.indexOf('"type":"webauthn.get"'));
		return abiCoder.encode(
			["bytes32", "bytes", "bytes"],
			[
				keyHash,
				abiCoder.encode(
					["(bytes,string,uint256,uint256,uint256,uint256)"],
					[[
						"0x49960de5880e8c687434170f6476605b8fe4aeb9a28632c7995cf3ba831d97630500000000",
						dummyClientDataJSON,
						challengeIndex,
						typeIndex,
						BigInt("0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0"),
						BigInt("0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0"),
					]],
				),
				"0x",
			],
		);
	}

	/**
	 * Wrap a raw ECDSA signature in Calibur's signature format:
	 * `abi.encode(bytes32 keyHash, bytes signature, bytes hookData)`.
	 *
	 * Use this when signing externally (e.g., with viem, hardware wallet, MPC)
	 * to avoid manually ABI-encoding the wrapped signature.
	 *
	 * @param keyHash - The key hash (use ROOT_KEY_HASH `0x00...00` for the EOA's root key)
	 * @param rawSignature - The raw ECDSA signature (65 bytes, hex-encoded)
	 * @param hookData - Optional hook data (default: "0x")
	 * @returns Hex-encoded wrapped signature ready for `userOp.signature`
	 */
	public static wrapSignature(
		keyHash: string,
		rawSignature: string,
		hookData = "0x",
	): string {
		const abiCoder = AbiCoder.defaultAbiCoder();
		return abiCoder.encode(
			["bytes32", "bytes", "bytes"],
			[keyHash, rawSignature, hookData],
		);
	}

	/** The EntryPoint contract address this account targets */
	readonly entrypointAddress: string;
	/** The Calibur singleton (delegatee) contract address */
	readonly delegateeAddress: string;

	/**
	 * Create a new Calibur7702Account instance for an existing EOA.
	 * @param accountAddress - The EOA address that will be (or already is) delegated via EIP-7702
	 * @param overrides - Optional overrides for entrypoint and delegatee addresses
	 * @param overrides.entrypointAddress - Custom EntryPoint address (defaults to EntryPoint v0.8)
	 * @param overrides.delegateeAddress - Custom Calibur singleton address
	 */
	constructor(
		accountAddress: string,
		overrides: {
			entrypointAddress?: string;
			delegateeAddress?: string;
		} = {},
	) {
		super(accountAddress);
		this.entrypointAddress = overrides.entrypointAddress ?? ENTRYPOINT_V8;
		this.delegateeAddress = overrides.delegateeAddress ?? DEFAULT_SINGLETON_ADDRESS;
	}

	/**
	 * Compute the UserOperation hash for this account's EntryPoint.
	 * Convenience wrapper around the standalone `createUserOperationHash` that
	 * automatically uses this account's EntryPoint address.
	 *
	 * @param userOperation - The UserOperation to hash
	 * @param chainId - Target chain ID
	 * @returns The UserOperation hash as a hex string
	 */
	public getUserOperationHash(
		userOperation: UserOperationV8,
		chainId: bigint,
	): string {
		return createUserOperationHash(
			userOperation,
			this.entrypointAddress,
			chainId,
		);
	}

	// ─── CallData Encoding ───────────────────────────────────────────────

	/**
	 * Encode calldata for `executeUserOp(bytes)` with BatchedCall format.
	 * All transactions (even single ones) go through the same BatchedCall path.
	 *
	 * @param transactions - One or more transactions to encode
	 * @param revertOnFailure - Whether to revert the entire batch if any call fails (default: true)
	 * @returns Encoded calldata for the executeUserOp function
	 */
	public static createAccountCallData(
		transactions: SimpleMetaTransaction[],
		revertOnFailure = true,
	): string {
		const abiCoder = AbiCoder.defaultAbiCoder();
		const calls = transactions.map(tx => [tx.to, tx.value, tx.data]);
		// BatchedCall struct { Call[] calls; bool revertOnFailure; }
		// Solidity's abi.decode(data, (BatchedCall)) expects a single struct/tuple
		// parameter, which has an extra offset layer compared to two separate args.
		const batchedCallEncoded = abiCoder.encode(
			["((address,uint256,bytes)[],bool)"],
			[[calls, revertOnFailure]],
		);
		return EXECUTE_USER_OP_SELECTOR + batchedCallEncoded.slice(2);
	}

	// ─── UserOperation Lifecycle ─────────────────────────────────────────

	/**
	 * Build an unsigned {@link UserOperationV8} from one or more transactions.
	 * Determines nonce, fetches gas prices, estimates gas limits, and
	 * optionally includes EIP-7702 authorization. All auto-determined
	 * values can be overridden.
	 *
	 * @param transactions - One or more transactions to encode into callData
	 * @param providerRpc - JSON-RPC endpoint for nonce and gas price queries
	 * @param bundlerRpc - Bundler RPC endpoint for gas estimation
	 * @param overrides - Optional overrides for gas, nonce, and EIP-7702 auth fields
	 * @returns A promise resolving to an unsigned {@link UserOperationV8}
	 */
	public async createUserOperation(
		transactions: SimpleMetaTransaction[],
		providerRpc?: string,
		bundlerRpc?: string,
		overrides: CaliburCreateUserOperationOverrides = {},
	): Promise<UserOperationV8> {
		if (transactions.length < 1) {
			throw new RangeError("There should be at least one transaction");
		}

		let nonce: bigint | null = null;
		let nonceOp: Promise<bigint> | null = null;

		if (overrides.nonce == null) {
			if (providerRpc != null) {
				nonceOp = fetchAccountNonce(
					providerRpc,
					this.entrypointAddress,
					this.accountAddress,
				);
			} else {
				throw new AbstractionKitError(
					"BAD_DATA",
					"providerRpc can't be null if nonce is not overridden",
				);
			}
		} else {
			nonce = overrides.nonce;
		}

		if (
			typeof overrides.maxFeePerGas === "bigint" &&
			overrides.maxFeePerGas < 0n
		) {
			throw new RangeError("maxFeePerGas override can't be negative");
		}

		if (
			typeof overrides.maxPriorityFeePerGas === "bigint" &&
			overrides.maxPriorityFeePerGas < 0n
		) {
			throw new RangeError("maxPriorityFeePerGas override can't be negative");
		}

		let maxFeePerGas = BaseUserOperationDummyValues.maxFeePerGas;
		let maxPriorityFeePerGas = BaseUserOperationDummyValues.maxPriorityFeePerGas;

		let gasPriceOp: Promise<[bigint, bigint]> | null = null;
		if (
			overrides.maxFeePerGas == null ||
			overrides.maxPriorityFeePerGas == null
		) {
			gasPriceOp = handlefetchGasPrice(
				providerRpc, overrides.polygonGasStation, overrides.gasLevel
			);
		}

		let eip7702AuthChainId: bigint | null = null;
		let eip7702AuthAddress: string | null = null;
		let eip7702AuthNonce: bigint | null = null;

		if (overrides.eip7702Auth != null) {
			eip7702AuthChainId = overrides.eip7702Auth.chainId;
			eip7702AuthAddress = overrides.eip7702Auth.address ??
				this.delegateeAddress;
			eip7702AuthNonce = overrides.eip7702Auth.nonce ?? null;
		}

		// When eip7702Auth is provided, check if already delegated in parallel.
		// If already delegated to the target, skip the authorization.
		let skipEip7702Auth = false;
		let delegationCheckOp: Promise<string | null> | null = null;
		if (overrides.eip7702Auth != null && providerRpc != null) {
			delegationCheckOp = getDelegatedAddress(this.accountAddress, providerRpc)
				.catch(() => null);
		}

		if (overrides.eip7702Auth != null && eip7702AuthNonce == null) {
			let eip7702AuthNonceOp;
			if (providerRpc != null) {
				eip7702AuthNonceOp = sendJsonRpcRequest(
					providerRpc,
					"eth_getTransactionCount",
					[this.accountAddress, "latest"]
				);
			} else {
				throw new AbstractionKitError(
					"BAD_DATA",
					"providerRpc can't be null if eoaDelegatorNonce " +
					"is not overriden",
				);
			}

			const ops: Promise<any>[] = [eip7702AuthNonceOp];
			if (nonceOp != null) ops.push(nonceOp);
			if (gasPriceOp != null) ops.push(gasPriceOp);
			if (delegationCheckOp != null) ops.push(delegationCheckOp);

			const values = await Promise.all(ops);
			let idx = 0;
			eip7702AuthNonce = BigInt(values[idx++] as string);
			if (nonceOp != null) nonce = values[idx++];
			if (gasPriceOp != null) [maxFeePerGas, maxPriorityFeePerGas] = values[idx++];
			if (delegationCheckOp != null) {
				const delegatedTo = values[idx++] as string | null;
				if (delegatedTo != null &&
					delegatedTo.toLowerCase() === (eip7702AuthAddress as string).toLowerCase()) {
					skipEip7702Auth = true;
				}
			}
		} else if (overrides.eip7702Auth != null) {
			const ops: Promise<any>[] = [];
			if (nonceOp != null) ops.push(nonceOp);
			if (gasPriceOp != null) ops.push(gasPriceOp);
			if (delegationCheckOp != null) ops.push(delegationCheckOp);

			if (ops.length > 0) {
				const values = await Promise.all(ops);
				let idx = 0;
				if (nonceOp != null) nonce = values[idx++];
				if (gasPriceOp != null) [maxFeePerGas, maxPriorityFeePerGas] = values[idx++];
				if (delegationCheckOp != null) {
					const delegatedTo = values[idx++] as string | null;
					if (delegatedTo != null &&
						delegatedTo.toLowerCase() === (eip7702AuthAddress as string).toLowerCase()) {
						skipEip7702Auth = true;
					}
				}
			}
		} else {
			if (gasPriceOp != null && nonceOp != null) {
				await Promise.all([nonceOp, gasPriceOp]).then((values) => {
					nonce = values[0];
					[maxFeePerGas, maxPriorityFeePerGas] = values[1];
				});
			} else if (gasPriceOp != null) {
				[maxFeePerGas, maxPriorityFeePerGas] = await gasPriceOp;
			} else if (nonceOp != null) {
				nonce = await nonceOp;
			}
		}

		maxFeePerGas = overrides.maxFeePerGas ??
			BigInt(
				Math.floor(
					Number(maxFeePerGas) *
					(((overrides.maxFeePerGasPercentageMultiplier ?? 0) + 100) / 100)
				)
			);
		maxPriorityFeePerGas = overrides.maxPriorityFeePerGas ??
			BigInt(
				Math.floor(
					Number(maxPriorityFeePerGas) *
					(((overrides.maxPriorityFeePerGasPercentageMultiplier ?? 0) + 100) / 100)
				)
			);

		if (nonce == null) {
			throw new RangeError("failed to determine nonce");
		} else if (nonce < 0n) {
			throw new RangeError("nonce can't be negative");
		}

		let callData = "0x" as string;
		if (overrides.callData == null) {
			callData = Calibur7702Account.createAccountCallData(
				transactions,
				overrides.revertOnFailure ?? true,
			);
		} else {
			callData = overrides.callData;
		}

		const pmFields = overrides.paymasterFields;
		let userOperation: UserOperationV8;
		if (overrides.eip7702Auth != null && !skipEip7702Auth) {
			const yParity = overrides.eip7702Auth.yParity ?? "0x0";
			if (
				yParity != "0x0" && yParity != "0x00" &&
				yParity != "0x1" && yParity != "0x01"
			) {
				throw new AbstractionKitError(
					"BAD_DATA",
					"invalid yParity value for eoaDelegatorSignature. " +
					"must be '0x0' or '0x1'"
				);
			}

			const authorization: Authorization7702Hex = {
				chainId: bigintToHex(eip7702AuthChainId as bigint),
				address: eip7702AuthAddress as string,
				nonce: bigintToHex(eip7702AuthNonce as bigint),
				yParity: yParity,
				r: overrides.eip7702Auth.r ??
					"0x4277ba564d2c138823415df0ec8e8f97f30825056d54ec5128a8b29ec2dd81b2",
				s: overrides.eip7702Auth.s ??
					"0x1075a1bec7f59848cca899ece93075199cd2aabceb0654b9ae00b881a30044cd",
			};
			userOperation = {
				...BaseUserOperationDummyValues,
				sender: this.accountAddress,
				nonce: nonce,
				callData: callData,
				maxFeePerGas: maxFeePerGas,
				maxPriorityFeePerGas: maxPriorityFeePerGas,
				factory: "0x7702",
				factoryData: null,
				paymaster: pmFields?.paymaster ?? null,
				paymasterVerificationGasLimit: pmFields?.paymasterVerificationGasLimit ?? null,
				paymasterPostOpGasLimit: pmFields?.paymasterPostOpGasLimit ?? null,
				paymasterData: pmFields?.paymasterData ?? null,
				eip7702Auth: authorization,
			};
		} else {
			userOperation = {
				...BaseUserOperationDummyValues,
				sender: this.accountAddress,
				nonce: nonce,
				callData: callData,
				maxFeePerGas: maxFeePerGas,
				maxPriorityFeePerGas: maxPriorityFeePerGas,
				factory: null,
				factoryData: null,
				paymaster: pmFields?.paymaster ?? null,
				paymasterVerificationGasLimit: pmFields?.paymasterVerificationGasLimit ?? null,
				paymasterPostOpGasLimit: pmFields?.paymasterPostOpGasLimit ?? null,
				paymasterData: pmFields?.paymasterData ?? null,
				eip7702Auth: null,
			};
		}

		let preVerificationGas = BaseUserOperationDummyValues.preVerificationGas;
		let verificationGasLimit = BaseUserOperationDummyValues.verificationGasLimit;
		let callGasLimit = BaseUserOperationDummyValues.callGasLimit;

		if (
			overrides.preVerificationGas == null ||
			overrides.verificationGasLimit == null ||
			overrides.callGasLimit == null
		) {
			if (bundlerRpc != null) {
				userOperation.callGasLimit = 0n;
				userOperation.verificationGasLimit = 0n;
				userOperation.preVerificationGas = 0n;
				const inputMaxFeePerGas = userOperation.maxFeePerGas;
				const inputMaxPriorityFeePerGas = userOperation.maxPriorityFeePerGas;
				userOperation.maxFeePerGas = 0n;
				userOperation.maxPriorityFeePerGas = 0n;

				const userOperationToEstimate: UserOperationV8 = { ...userOperation };
				userOperationToEstimate.signature = overrides.dummySignature ??
					Calibur7702Account.dummySignature;

				const bundler = new Bundler(bundlerRpc);
				const estimation = await bundler.estimateUserOperationGas(
					userOperationToEstimate,
					this.entrypointAddress,
					overrides.state_override_set,
				);

				preVerificationGas = BigInt(estimation.preVerificationGas);
				verificationGasLimit = BigInt(estimation.verificationGasLimit);
				callGasLimit = BigInt(estimation.callGasLimit);
				// Safety margin for P-256/WebAuthn signature verification overhead
			// that the bundler's simulation may underestimate.
			verificationGasLimit += 55_000n;

				userOperation.maxFeePerGas = inputMaxFeePerGas;
				userOperation.maxPriorityFeePerGas = inputMaxPriorityFeePerGas;
			} else {
				throw new AbstractionKitError(
					"BAD_DATA",
					"bundlerRpc can't be null if preVerificationGas," +
					"verificationGasLimit and callGasLimit are not overriden",
				);
			}
		}

		if (
			typeof overrides.preVerificationGas === "bigint" &&
			overrides.preVerificationGas < 0n
		) {
			throw new RangeError("preVerificationGas override can't be negative");
		}

		if (
			typeof overrides.verificationGasLimit === "bigint" &&
			overrides.verificationGasLimit < 0n
		) {
			throw new RangeError("verificationGasLimit override can't be negative");
		}

		if (
			typeof overrides.callGasLimit === "bigint" &&
			overrides.callGasLimit < 0n
		) {
			throw new RangeError("callGasLimit override can't be negative");
		}

		userOperation.preVerificationGas = overrides.preVerificationGas ??
			BigInt(
				Math.floor(
					Number(preVerificationGas) *
					(((overrides.preVerificationGasPercentageMultiplier ?? 0) + 100) / 100)
				),
			);

		userOperation.verificationGasLimit = overrides.verificationGasLimit ??
			BigInt(
				Math.floor(
					Number(verificationGasLimit) *
					(((overrides.verificationGasLimitPercentageMultiplier ?? 0) + 100) / 100)
				),
			);

		userOperation.callGasLimit = overrides.callGasLimit ??
			BigInt(
				Math.floor(
					Number(callGasLimit) *
					(((overrides.callGasLimitPercentageMultiplier ?? 0) + 100) / 100)
				),
			);

		// Set the dummy signature so paymaster sponsorship calls can simulate
		// validateUserOp (Calibur's signature decoder rejects empty signatures).
		userOperation.signature = overrides.dummySignature ??
			Calibur7702Account.dummySignature;

		return userOperation;
	}

	/**
	 * Sign a UserOperation with a private key.
	 * Computes the UserOperation hash and wraps the ECDSA signature in
	 * Calibur's format: `abi.encode(keyHash, ecdsaSig, hookData)`.
	 *
	 * By default signs with the root key. To sign with a registered
	 * secondary key, pass its key hash via `overrides.keyHash`.
	 *
	 * @param userOperation - The UserOperation to sign
	 * @param privateKey - Hex-encoded private key
	 * @param chainId - Target chain ID
	 * @param overrides - Optional overrides (keyHash for secondary keys, hookData)
	 * @returns Hex-encoded wrapped signature
	 *
	 * @example
	 * // Sign with root key
	 * userOp.signature = account.signUserOperation(userOp, privateKey, chainId);
	 *
	 * // Sign with a registered secondary key
	 * userOp.signature = account.signUserOperation(userOp, privateKey, chainId, { keyHash });
	 */
	public signUserOperation(
		userOperation: UserOperationV8,
		privateKey: string,
		chainId: bigint,
		overrides: CaliburSignatureOverrides = {},
	): string {
		const userOperationHash = createUserOperationHash(
			userOperation,
			this.entrypointAddress,
			chainId,
		);
		const keyHash = overrides.keyHash ?? ROOT_KEY_HASH;
		const hookData = overrides.hookData ?? "0x";
		const wallet = new Wallet(privateKey);
		const ecdsaSig = wallet.signingKey.sign(userOperationHash).serialized;
		return Calibur7702Account.wrapSignature(keyHash, ecdsaSig, hookData);
	}

	/**
	 * Sign a UserOperation with an external signer (viem, ethers Signer,
	 * hardware wallet, MPC signer, etc.).
	 * Computes the UserOperation hash and wraps the returned signature in
	 * Calibur's format: `abi.encode(keyHash, ecdsaSig, hookData)`.
	 *
	 * By default signs with the root key. To sign with a registered
	 * secondary key, pass its key hash via `overrides.keyHash`.
	 *
	 * @param userOperation - The UserOperation to sign
	 * @param signer - Async signing function: `(hash: string) => Promise<string>`
	 * @param chainId - Target chain ID
	 * @param overrides - Optional overrides (keyHash for secondary keys, hookData)
	 * @returns Promise resolving to the hex-encoded wrapped signature
	 *
	 * @example
	 * // Sign with a viem wallet client
	 * userOp.signature = await account.signUserOperationWithSigner(
	 *   userOp,
	 *   (hash) => walletClient.signMessage({ message: { raw: hash } }),
	 *   chainId,
	 * );
	 */
	public async signUserOperationWithSigner(
		userOperation: UserOperationV8,
		signer: SignerFunction,
		chainId: bigint,
		overrides: CaliburSignatureOverrides = {},
	): Promise<string> {
		const userOperationHash = createUserOperationHash(
			userOperation,
			this.entrypointAddress,
			chainId,
		);
		const keyHash = overrides.keyHash ?? ROOT_KEY_HASH;
		const hookData = overrides.hookData ?? "0x";
		const ecdsaSig = await signer(userOperationHash);
		return Calibur7702Account.wrapSignature(keyHash, ecdsaSig, hookData);
	}

	/**
	 * Format a WebAuthn (passkey) assertion into Calibur's signature format.
	 * The challenge for the WebAuthn assertion should be `abi.encode(userOpHash)`.
	 *
	 * @param keyHash - The key hash of the registered passkey (from {@link getKeyHash})
	 * @param webAuthnAuth - WebAuthn assertion data from the browser
	 * @param overrides - Optional signature overrides (e.g., hookData)
	 * @returns Hex-encoded wrapped signature
	 */
	public formatWebAuthnSignature(
		keyHash: string,
		webAuthnAuth: WebAuthnSignatureData,
		overrides: CaliburSignatureOverrides = {},
	): string {
		const abiCoder = AbiCoder.defaultAbiCoder();
		const hookData = overrides.hookData ?? "0x";

		// Encode as a struct/tuple — Calibur decodes with:
		//   abi.decode(signature, (WebAuthn.WebAuthnAuth))
		// which expects struct-wrapped encoding (extra offset for dynamic tuple).
		const webAuthnEncoded = abiCoder.encode(
			["(bytes,string,uint256,uint256,uint256,uint256)"],
			[[
				webAuthnAuth.authenticatorData,
				webAuthnAuth.clientDataJSON,
				webAuthnAuth.challengeIndex,
				webAuthnAuth.typeIndex,
				webAuthnAuth.r,
				webAuthnAuth.s,
			]],
		);

		return abiCoder.encode(
			["bytes32", "bytes", "bytes"],
			[keyHash, webAuthnEncoded, hookData],
		);
	}

	/**
	 * Submit a signed UserOperation to a bundler for on-chain inclusion.
	 *
	 * @param userOperation - The signed UserOperation to submit
	 * @param bundlerRpc - Bundler RPC endpoint
	 * @returns A {@link SendUseroperationResponse} that can be used to wait for inclusion
	 */
	public async sendUserOperation(
		userOperation: UserOperationV8,
		bundlerRpc: string,
	): Promise<SendUseroperationResponse> {
		const bundler = new Bundler(bundlerRpc);
		const sendUserOperationRes = await bundler.sendUserOperation(
			userOperation,
			this.entrypointAddress,
		);

		return new SendUseroperationResponse(
			sendUserOperationRes,
			bundler,
			this.entrypointAddress,
		);
	}

	// ─── Key Helpers (static) ────────────────────────────────────────────

	/**
	 * Create a secp256k1 key descriptor from an Ethereum address.
	 * @param address - The Ethereum address (EOA public address)
	 * @returns A {@link CaliburKey} with type Secp256k1
	 */
	public static createSecp256k1Key(address: string): CaliburKey {
		const abiCoder = AbiCoder.defaultAbiCoder();
		return {
			keyType: CaliburKeyType.Secp256k1,
			publicKey: abiCoder.encode(["address"], [address]),
		};
	}

	/**
	 * Create a WebAuthn P-256 key descriptor from public key coordinates.
	 * @param x - The x coordinate of the P-256 public key
	 * @param y - The y coordinate of the P-256 public key
	 * @returns A {@link CaliburKey} with type WebAuthnP256
	 */
	public static createWebAuthnP256Key(x: bigint, y: bigint): CaliburKey {
		const abiCoder = AbiCoder.defaultAbiCoder();
		return {
			keyType: CaliburKeyType.WebAuthnP256,
			publicKey: abiCoder.encode(["uint256", "uint256"], [x, y]),
		};
	}

	/**
	 * Create a raw P-256 key descriptor from public key coordinates.
	 * @param x - The x coordinate of the P-256 public key
	 * @param y - The y coordinate of the P-256 public key
	 * @returns A {@link CaliburKey} with type P256
	 */
	public static createP256Key(x: bigint, y: bigint): CaliburKey {
		const abiCoder = AbiCoder.defaultAbiCoder();
		return {
			keyType: CaliburKeyType.P256,
			publicKey: abiCoder.encode(["uint256", "uint256"], [x, y]),
		};
	}

	/**
	 * Compute the key hash for a Calibur key.
	 * Uses double hashing: `keccak256(abi.encode(uint8 keyType, bytes32 keccak256(publicKey)))`.
	 *
	 * @param key - The key to hash
	 * @returns The key hash as a bytes32 hex string
	 */
	public static getKeyHash(key: CaliburKey): string {
		const innerHash = keccak256(key.publicKey);
		const abiCoder = AbiCoder.defaultAbiCoder();
		const encoded = abiCoder.encode(
			["uint8", "bytes32"],
			[key.keyType, innerHash],
		);
		return keccak256(encoded);
	}

	/**
	 * Pack key settings into a single uint256 value.
	 * Layout: `(isAdmin << 200) | (expiration << 160) | hook`
	 *
	 * @param settings - The key settings to pack
	 * @returns The packed settings as a bigint
	 */
	public static packKeySettings(settings: CaliburKeySettings): bigint {
		const hook = BigInt(settings.hook ?? ZeroAddress);
		const expiration = BigInt(settings.expiration ?? 0);
		const isAdmin = settings.isAdmin ? 1n : 0n;
		return (isAdmin << 200n) | (expiration << 160n) | hook;
	}

	/**
	 * Unpack a uint256 settings value into a {@link CaliburKeySettingsResult} object.
	 *
	 * @param packed - The packed settings value
	 * @returns Parsed key settings with all fields populated
	 */
	public static unpackKeySettings(packed: bigint): CaliburKeySettingsResult {
		const hook = "0x" + (packed & ((1n << 160n) - 1n)).toString(16).padStart(40, "0");
		const expiration = Number((packed >> 160n) & ((1n << 40n) - 1n));
		const isAdmin = ((packed >> 200n) & 1n) === 1n;
		return { hook, expiration, isAdmin };
	}

	// ─── Key Management (static, return SimpleMetaTransaction) ───────────

	/**
	 * Create meta-transactions to register a new key on the Calibur account.
	 * Returns **two transactions**: `[register, update]`. Both must be included
	 * in the same UserOperation.
	 *
	 * **Safety guardrail:** This method never sets `isAdmin: true` regardless
	 * of input settings. Developers who need admin keys must encode calldata themselves.
	 *
	 * @param key - The key to register
	 * @param settings - Optional key settings (isAdmin is always forced to false)
	 * @returns A tuple of exactly two {@link SimpleMetaTransaction}s: [registerTx, updateTx].
	 *          Both must be included in the same UserOperation.
	 */
	public static createRegisterKeyMetaTransactions(
		key: CaliburKey,
		settings: CaliburKeySettings = {},
	): [SimpleMetaTransaction, SimpleMetaTransaction] {
		if (settings.isAdmin === true) {
			throw new AbstractionKitError(
				"BAD_DATA",
				"createRegisterKeyMetaTransactions does not allow setting " +
				"isAdmin to true. Encode the calldata manually for admin keys.",
			);
		}

		const abiCoder = AbiCoder.defaultAbiCoder();

		// Register: register((uint8 keyType, bytes publicKey))
		const registerCallData = REGISTER_SELECTOR + abiCoder.encode(
			["(uint8,bytes)"],
			[[key.keyType, key.publicKey]],
		).slice(2);

		// Update: update(bytes32 keyHash, uint256 packedSettings)
		const safeSettings: CaliburKeySettings = {
			...settings,
			isAdmin: false,
		};
		const keyHash = Calibur7702Account.getKeyHash(key);
		const packedSettings = Calibur7702Account.packKeySettings(safeSettings);
		const updateCallData = UPDATE_SELECTOR + abiCoder.encode(
			["bytes32", "uint256"],
			[keyHash, packedSettings],
		).slice(2);

		return [
			{ to: ZeroAddress, value: 0n, data: registerCallData },
			{ to: ZeroAddress, value: 0n, data: updateCallData },
		] as [SimpleMetaTransaction, SimpleMetaTransaction];
	}

	/**
	 * Create a meta-transaction to revoke a key from the Calibur account.
	 *
	 * @param keyHash - The key hash to revoke
	 * @returns A {@link SimpleMetaTransaction} that calls `revoke(bytes32)`
	 */
	public static createRevokeKeyMetaTransaction(
		keyHash: string,
	): SimpleMetaTransaction {
		const abiCoder = AbiCoder.defaultAbiCoder();
		const callData = REVOKE_SELECTOR + abiCoder.encode(
			["bytes32"],
			[keyHash],
		).slice(2);

		return { to: ZeroAddress, value: 0n, data: callData };
	}

	/**
	 * Create meta-transactions to revoke ALL registered keys on this account.
	 * Queries the on-chain key list and returns one `revoke(bytes32)` call per key.
	 *
	 * **Recommended before revoking EIP-7702 delegation** to prevent stale keys
	 * from becoming active again if the EOA re-delegates later.
	 *
	 * @param providerRpc - JSON-RPC endpoint to query registered keys
	 * @returns Array of {@link SimpleMetaTransaction}s — one revoke call per key.
	 *          Empty array if no keys are registered.
	 *
	 * @example
	 * ```typescript
	 * // Step 1: Revoke all keys (send as UserOp)
	 * const revokeTxs = await account.createRevokeAllKeysMetaTransactions(providerRpc);
	 * if (revokeTxs.length > 0) {
	 *     const userOp = await account.createUserOperation(revokeTxs, providerRpc, bundlerRpc);
	 *     userOp.signature = account.signUserOperation(userOp, privateKey, chainId);
	 *     const response = await account.sendUserOperation(userOp, bundlerRpc);
	 *     await response.included();
	 * }
	 *
	 * // Step 2: Revoke delegation
	 * const rawTx = await account.createRevokeDelegationRawTransaction(chainId, privateKey, providerRpc);
	 * ```
	 */
	public async createRevokeAllKeysMetaTransactions(
		providerRpc: string,
	): Promise<SimpleMetaTransaction[]> {
		const keys = await this.listKeys(providerRpc);
		return keys.map((key) => {
			const keyHash = Calibur7702Account.getKeyHash(key);
			return Calibur7702Account.createRevokeKeyMetaTransaction(keyHash);
		});
	}

	/**
	 * Create a signed raw transaction that revokes EIP-7702 delegation,
	 * restoring this account to a plain EOA.
	 *
	 * **Recommended flow:** Call {@link createRevokeAllKeysMetaTransactions} first
	 * and send the cleanup UserOp, then call this method to revoke delegation.
	 * This prevents stale keys from reactivating if the EOA re-delegates later.
	 *
	 * @param chainId - Target chain ID
	 * @param eoaPrivateKey - The EOA's private key for signing
	 * @param providerRpc - JSON-RPC endpoint for nonce and gas price queries
	 * @param overrides - Optional overrides for transaction parameters
	 * @param overrides.nonce - Transaction nonce (fetched from provider if omitted)
	 * @param overrides.authorizationNonce - EIP-7702 authorization nonce (defaults to txNonce + 1)
	 * @param overrides.maxFeePerGas - Max fee per gas (fetched from provider if omitted)
	 * @param overrides.maxPriorityFeePerGas - Max priority fee per gas (fetched if omitted)
	 * @param overrides.gasLimit - Gas limit (defaults to 60,000)
	 * @returns Hex-encoded signed EIP-7702 type-4 transaction ready for `eth_sendRawTransaction`
	 * @throws {AbstractionKitError} If the account is not delegated or is delegated to a different address
	 *
	 * @example
	 * ```typescript
	 * const rawTx = await account.createRevokeDelegationRawTransaction(
	 *     11155111n, privateKey, providerRpc,
	 * );
	 * await sendJsonRpcRequest(providerRpc, "eth_sendRawTransaction", [rawTx]);
	 * ```
	 */
	public async createRevokeDelegationRawTransaction(
		chainId: bigint,
		eoaPrivateKey: string,
		providerRpc: string,
		overrides: {
			nonce?: bigint;
			authorizationNonce?: bigint;
			maxFeePerGas?: bigint;
			maxPriorityFeePerGas?: bigint;
			gasLimit?: bigint;
		} = {},
	): Promise<string> {
		// Verify delegation state before revoking
		const delegatedTo = await getDelegatedAddress(this.accountAddress, providerRpc);
		if (delegatedTo === null) {
			throw new AbstractionKitError(
				"BAD_DATA",
				"Account is not delegated — nothing to revoke",
			);
		}
		if (delegatedTo.toLowerCase() !== this.delegateeAddress.toLowerCase()) {
			throw new AbstractionKitError(
				"BAD_DATA",
				"Account is delegated to a different address (" +
					delegatedTo + "), not " + this.delegateeAddress +
					" — use the correct account class to revoke",
			);
		}

		const results: {
			nonce?: bigint;
			maxFeePerGas?: bigint;
			maxPriorityFeePerGas?: bigint;
		} = {};

		// Build parallel fetch list
		const ops: Promise<void>[] = [];

		if (overrides.nonce == null) {
			ops.push(
				sendJsonRpcRequest(
					providerRpc, "eth_getTransactionCount",
					[this.accountAddress, "latest"]
				).then((v) => { results.nonce = BigInt(v as string); })
			);
		}

		if (overrides.maxFeePerGas == null || overrides.maxPriorityFeePerGas == null) {
			ops.push(
				handlefetchGasPrice(providerRpc, undefined)
					.then(([fee, tip]) => {
						results.maxFeePerGas = fee;
						results.maxPriorityFeePerGas = tip;
					})
			);
		}

		if (ops.length > 0) await Promise.all(ops);

		const txNonce = overrides.nonce ?? results.nonce ?? 0n;
		const maxFeePerGas = overrides.maxFeePerGas ?? results.maxFeePerGas ?? 0n;
		const maxPriorityFeePerGas = overrides.maxPriorityFeePerGas ?? results.maxPriorityFeePerGas ?? 0n;

		// Authorization nonce = txNonce + 1 by default
		// (tx nonce is incremented before authorization processing in EIP-7702)
		const authNonce = overrides.authorizationNonce ?? (txNonce + 1n);

		// Create undelegation authorization (delegates to address(0))
		const authHex = createRevokeDelegationAuthorization(
			chainId, authNonce, eoaPrivateKey
		);

		// Convert Authorization7702Hex -> Authorization7702 for raw tx builder
		const auth = {
			chainId: BigInt(authHex.chainId),
			address: authHex.address,
			nonce: BigInt(authHex.nonce),
			yParity: (BigInt(authHex.yParity) === 0n ? 0 : 1) as 0 | 1,
			r: BigInt(authHex.r),
			s: BigInt(authHex.s),
		};

		const gasLimit = overrides.gasLimit ?? 60_000n;

		return createAndSignEip7702RawTransaction(
			chainId,
			txNonce,
			maxPriorityFeePerGas,
			maxFeePerGas,
			gasLimit,
			this.accountAddress,
			0n,
			"0x",
			[],
			[auth],
			eoaPrivateKey,
		);
	}

	/**
	 * Create a meta-transaction to update settings for a registered key.
	 *
	 * **Safety guardrail:** Throws if `settings.isAdmin` is `true`.
	 * Developers who need admin keys must encode calldata themselves.
	 *
	 * @param keyHash - The key hash to update
	 * @param settings - New settings for the key
	 * @returns A {@link SimpleMetaTransaction} that calls `update(bytes32, uint256)`
	 * @throws {AbstractionKitError} If settings.isAdmin is true
	 */
	public static createUpdateKeySettingsMetaTransaction(
		keyHash: string,
		settings: CaliburKeySettings,
	): SimpleMetaTransaction {
		if (settings.isAdmin === true) {
			throw new AbstractionKitError(
				"BAD_DATA",
				"createUpdateKeySettingsMetaTransaction does not allow setting " +
				"isAdmin to true. Encode the calldata manually for admin keys.",
			);
		}

		const abiCoder = AbiCoder.defaultAbiCoder();
		const packedSettings = Calibur7702Account.packKeySettings(settings);
		const callData = UPDATE_SELECTOR + abiCoder.encode(
			["bytes32", "uint256"],
			[keyHash, packedSettings],
		).slice(2);

		return { to: ZeroAddress, value: 0n, data: callData };
	}

	/**
	 * Create a meta-transaction to invalidate nonces up to a given value.
	 *
	 * @param newNonce - The new nonce value (all nonces below this are invalidated)
	 * @returns A {@link SimpleMetaTransaction} that calls `invalidateNonce(uint256)`
	 */
	public static createInvalidateNonceMetaTransaction(
		newNonce: bigint,
	): SimpleMetaTransaction {
		const abiCoder = AbiCoder.defaultAbiCoder();
		const callData = INVALIDATE_NONCE_SELECTOR + abiCoder.encode(
			["uint256"],
			[newNonce],
		).slice(2);

		return { to: ZeroAddress, value: 0n, data: callData };
	}

	// ─── Read Functions (instance, RPC calls) ────────────────────────────

	/**
	 * Check if this EOA is delegated to this account's singleton (delegatee).
	 * Returns `false` if not delegated at all or delegated to a different
	 * singleton. Use the standalone {@link getDelegatedAddress} utility to
	 * get the raw delegatee address regardless of which singleton it is.
	 *
	 * @param providerRpc - JSON-RPC endpoint
	 * @returns True if the account is delegated to `this.delegateeAddress`
	 */
	public async isDelegatedToThisAccount(providerRpc: string): Promise<boolean> {
		const address = await getDelegatedAddress(this.accountAddress, providerRpc);
		if (address === null) return false;
		return address.toLowerCase() === this.delegateeAddress.toLowerCase();
	}

	/**
	 * Get the account nonce from the EntryPoint.
	 *
	 * @param providerRpc - JSON-RPC endpoint
	 * @param sequenceKey - Optional sequence key for parallel nonce channels (default: 0)
	 * @returns The fully constructed nonce `(sequenceKey << 64) | seq`
	 */
	public async getNonce(
		providerRpc: string,
		sequenceKey = 0,
	): Promise<bigint> {
		return fetchAccountNonce(
			providerRpc,
			this.entrypointAddress,
			this.accountAddress,
			sequenceKey,
		);
	}

	/**
	 * Check if a key is registered on this account.
	 *
	 * @param providerRpc - JSON-RPC endpoint
	 * @param keyHash - The key hash to check
	 * @returns True if the key is registered
	 */
	public async isKeyRegistered(
		providerRpc: string,
		keyHash: string,
	): Promise<boolean> {
		const abiCoder = AbiCoder.defaultAbiCoder();
		const callData = IS_REGISTERED_SELECTOR + abiCoder.encode(
			["bytes32"],
			[keyHash],
		).slice(2);

		const result = await sendJsonRpcRequest(
			providerRpc,
			"eth_call",
			[
				{
					from: ZeroAddress,
					to: this.accountAddress,
					data: callData,
				},
				"latest",
			],
		);

		if (typeof result === "string") {
			const decoded = abiCoder.decode(["bool"], result);
			return decoded[0] as boolean;
		}
		throw new AbstractionKitError(
			"BAD_DATA",
			"Unexpected response from isRegistered call",
		);
	}

	/**
	 * Get the settings for a registered key.
	 *
	 * @param providerRpc - JSON-RPC endpoint
	 * @param keyHash - The key hash to query
	 * @returns Parsed {@link CaliburKeySettingsResult} with all fields populated
	 */
	public async getKeySettings(
		providerRpc: string,
		keyHash: string,
	): Promise<CaliburKeySettingsResult> {
		const abiCoder = AbiCoder.defaultAbiCoder();
		const callData = GET_KEY_SETTINGS_SELECTOR + abiCoder.encode(
			["bytes32"],
			[keyHash],
		).slice(2);

		const result = await sendJsonRpcRequest(
			providerRpc,
			"eth_call",
			[
				{
					from: ZeroAddress,
					to: this.accountAddress,
					data: callData,
				},
				"latest",
			],
		);

		if (typeof result === "string") {
			const decoded = abiCoder.decode(["uint256"], result);
			return Calibur7702Account.unpackKeySettings(BigInt(decoded[0]));
		}
		throw new AbstractionKitError(
			"BAD_DATA",
			"Unexpected response from getKeySettings call",
		);
	}

	/**
	 * Get the full key data for a registered key.
	 *
	 * @param providerRpc - JSON-RPC endpoint
	 * @param keyHash - The key hash to query
	 * @returns Parsed {@link CaliburKey}
	 */
	public async getKey(
		providerRpc: string,
		keyHash: string,
	): Promise<CaliburKey> {
		const abiCoder = AbiCoder.defaultAbiCoder();
		const callData = GET_KEY_SELECTOR + abiCoder.encode(
			["bytes32"],
			[keyHash],
		).slice(2);

		const result = await sendJsonRpcRequest(
			providerRpc,
			"eth_call",
			[
				{
					from: ZeroAddress,
					to: this.accountAddress,
					data: callData,
				},
				"latest",
			],
		);

		if (typeof result === "string") {
			const decoded = abiCoder.decode(["(uint8,bytes)"], result);
			const keyTuple = decoded[0] as [number, string];
			return {
				keyType: Number(keyTuple[0]) as CaliburKeyType,
				publicKey: keyTuple[1] as string,
			};
		}
		throw new AbstractionKitError(
			"BAD_DATA",
			"Unexpected response from getKey call",
		);
	}

	/**
	 * List all keys registered on this account.
	 * Iterates `keyCount()` + `keyAt(i)` to enumerate all keys.
	 *
	 * @param providerRpc - JSON-RPC endpoint
	 * @param overrides - Optional overrides
	 * @param overrides.blockNumber - Block number to query at (defaults to "latest").
	 *        Pass a specific block to ensure all reads are consistent.
	 * @returns Array of registered {@link CaliburKey}s
	 */
	public async listKeys(
		providerRpc: string,
		overrides: { blockNumber?: bigint } = {},
	): Promise<CaliburKey[]> {
		const abiCoder = AbiCoder.defaultAbiCoder();
		const blockTag = overrides.blockNumber != null
			? "0x" + overrides.blockNumber.toString(16)
			: "latest";

		// Get key count
		const countResult = await sendJsonRpcRequest(
			providerRpc,
			"eth_call",
			[
				{
					from: ZeroAddress,
					to: this.accountAddress,
					data: KEY_COUNT_SELECTOR,
				},
				blockTag,
			],
		);

		if (typeof countResult !== "string") {
			throw new AbstractionKitError(
				"BAD_DATA",
				"Unexpected response from keyCount call",
			);
		}

		// Non-delegated accounts return "0x" which can't be converted to BigInt.
		if (countResult === "0x" || countResult === "0x0") {
			return [];
		}

		const count = Number(BigInt(countResult));
		if (count === 0) return [];

		// Batch all keyAt calls in parallel
		const keyAtPromises: Promise<any>[] = [];
		for (let i = 0; i < count; i++) {
			const keyAtCallData = KEY_AT_SELECTOR + abiCoder.encode(
				["uint256"],
				[i],
			).slice(2);

			keyAtPromises.push(
				sendJsonRpcRequest(
					providerRpc,
					"eth_call",
					[
						{
							from: ZeroAddress,
							to: this.accountAddress,
							data: keyAtCallData,
						},
						blockTag,
					],
				),
			);
		}

		const keyResults = await Promise.all(keyAtPromises);
		const keys: CaliburKey[] = [];

		for (let i = 0; i < keyResults.length; i++) {
			const keyResult = keyResults[i];
			if (typeof keyResult !== "string") {
				throw new AbstractionKitError(
					"BAD_DATA",
					`Unexpected response from keyAt(${i}) call on ${this.accountAddress}`,
				);
			}
			const decoded = abiCoder.decode(["(uint8,bytes)"], keyResult);
			const keyTuple = decoded[0] as [number, string];
			keys.push({
				keyType: Number(keyTuple[0]) as CaliburKeyType,
				publicKey: keyTuple[1] as string,
			});
		}

		return keys;
	}

	// ─── Token Paymaster Support ─────────────────────────────────────────

	/**
	 * Prepend a token `approve` call to existing calldata for a token paymaster.
	 * Decodes the existing BatchedCall, prepends an ERC-20 approve transaction,
	 * and re-encodes.
	 *
	 * @param callData - Existing encoded calldata (executeUserOp format)
	 * @param tokenAddress - ERC-20 token contract to approve
	 * @param paymasterAddress - Paymaster address to approve as spender
	 * @param approveAmount - Token amount to approve
	 * @returns Re-encoded calldata with the approve transaction prepended
	 */
	public prependTokenPaymasterApproveToCallData(
		callData: string,
		tokenAddress: string,
		paymasterAddress: string,
		approveAmount: bigint,
	): string {
		return Calibur7702Account.prependTokenPaymasterApproveToCallDataStatic(
			callData,
			tokenAddress,
			paymasterAddress,
			approveAmount,
		);
	}

	/**
	 * Static version of {@link prependTokenPaymasterApproveToCallData}.
	 * Decodes existing executeUserOp calldata, prepends an ERC-20 approve call,
	 * and re-encodes the BatchedCall.
	 *
	 * @param callData - Existing encoded calldata (executeUserOp format)
	 * @param tokenAddress - ERC-20 token contract to approve
	 * @param paymasterAddress - Paymaster address to approve as spender
	 * @param approveAmount - Token amount to approve
	 * @returns Re-encoded calldata with the approve transaction prepended
	 */
	public static prependTokenPaymasterApproveToCallDataStatic(
		callData: string,
		tokenAddress: string,
		paymasterAddress: string,
		approveAmount: bigint,
	): string {
		const abiCoder = AbiCoder.defaultAbiCoder();

		// Build approve transaction
		const approveFunctionSelector = getFunctionSelector("approve(address,uint256)");
		const approveCallData = createCallData(
			approveFunctionSelector,
			["address", "uint256"],
			[paymasterAddress, approveAmount],
		);

		if (!callData.startsWith(EXECUTE_USER_OP_SELECTOR)) {
			throw new AbstractionKitError(
				"BAD_DATA",
				"Invalid calldata, should start with " + EXECUTE_USER_OP_SELECTOR +
				" (executeUserOp selector)",
				{ context: { callData } },
			);
		}

		// Decode: strip selector -> decode BatchedCall struct
		const batchedCallDecoded = abiCoder.decode(
			["((address,uint256,bytes)[],bool)"],
			"0x" + callData.slice(10),
		);
		const existingCalls = batchedCallDecoded[0][0] as [];
		const revertOnFailure = batchedCallDecoded[0][1] as boolean;

		const decodedTransactions: SimpleMetaTransaction[] = existingCalls.map(
			(call: [string, bigint, string]) => ({
				to: call[0],
				value: BigInt(call[1]),
				data: typeof call[2] !== "string"
					? new TextDecoder().decode(call[2])
					: call[2],
			}),
		);

		// Prepend approve
		decodedTransactions.unshift({
			to: tokenAddress,
			value: 0n,
			data: approveCallData,
		});

		// Re-encode as BatchedCall struct
		const calls = decodedTransactions.map(tx => [tx.to, tx.value, tx.data]);
		const batchedCallEncoded = abiCoder.encode(
			["((address,uint256,bytes)[],bool)"],
			[[calls, revertOnFailure]],
		);
		return EXECUTE_USER_OP_SELECTOR + batchedCallEncoded.slice(2);
	}
}
