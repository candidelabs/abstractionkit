import { getAddress, TypedDataEncoder, Wallet } from "ethers";
import { EIP712_MULTI_CHAIN_OPERATIONS_TYPE, ENTRYPOINT_V9 } from "src/constants";
import { invokeSigner, pickScheme } from "src/signer/negotiate";
import type { Signer as AkSigner, MultiOpSignContext, SignContext } from "src/signer/types";
import type { MetaTransaction, OnChainIdentifierParamsType, UserOperationV9 } from "../../types";
import {
	DEFAULT_WEB_AUTHN_DAIMO_VERIFIER_V_0_2_1,
	DEFAULT_WEB_AUTHN_PRECOMPILE_RIP_7951,
	DEFAULT_WEB_AUTHN_SHARED_SIGNER_V_0_2_1,
	DEFAULT_WEB_AUTHN_SIGNER_FACTORY_V_0_2_1,
	DEFAULT_WEB_AUTHN_SIGNER_PROXY_CREATION_CODE_V_0_2_1,
	DEFAULT_WEB_AUTHN_SIGNER_SINGLETON_V_0_2_1,
} from "./constants";
import { generateMerkleProofs } from "./MerkleTree";
import { SafeAccount } from "./SafeAccount";
import type {
	CreateUserOperationV9Overrides,
	InitCodeOverrides,
	MultiChainSignatureMerkleTreeRootTypedDataDomain,
	MultiChainSignatureMerkleTreeRootTypedMessageValue,
	SafeAccountSingleton,
	SafeSignatureOptions,
	SafeUserOperationTypedDataDomain,
	SafeUserOperationV9TypedMessageValue,
	Signer,
	SignerSignaturePair,
	UserOperationToSign,
	UserOperationToSignWithOverrides,
	WebAuthnSignatureOverrides,
	WebauthnPublicKey,
} from "./types";

/**
 * Safe account variant that supports multi-chain signatures via Merkle trees:
 * sign UserOperations for multiple chains under one signature on EntryPoint v0.9.
 *
 * Uses Safe Passkey module v0.2.1 WebAuthn verifiers by default (Daimo P256
 * verifier instead of the base class's FCL P256).
 * @see {@link https://github.com/safe-fndn/safe-modules/blob/04e65efbce634e776cc8c1fbe90061f09e09a71b/modules/passkey/CHANGELOG.md?plain=1#L23}
 *
 * @remarks Signer typing is asymmetric:
 * - {@link signUserOperationWithSigners} (singular) → {@link SignContext}
 * - {@link signUserOperationsWithSigners} (plural) → {@link MultiOpSignContext}
 *
 * Type a signer as `ExternalSigner<unknown>` (what the built-in adapters
 * return) to work on both methods; the narrow contexts exist so signers that
 * read the context get correct non-optional fields per path.
 */
export class SafeMultiChainSigAccountV1 extends SafeAccount {
	static readonly DEFAULT_ENTRYPOINT_ADDRESS = ENTRYPOINT_V9;
	static readonly DEFAULT_SAFE_4337_MODULE_ADDRESS = "0x22939E839e3c0F479B713eAF95e0df128554AEAd";
	static readonly DEFAULT_SAFE_MODULE_SETUP_ADDRESS = "0x2dd68b007B46fBe91B9A7c3EDa5A7a1063cB5b47";

	// Safe Passkey module v0.2.1 WebAuthn verifier defaults
	static readonly DEFAULT_WEB_AUTHN_SHARED_SIGNER: string = DEFAULT_WEB_AUTHN_SHARED_SIGNER_V_0_2_1;
	static readonly DEFAULT_WEB_AUTHN_SIGNER_SINGLETON: string =
		DEFAULT_WEB_AUTHN_SIGNER_SINGLETON_V_0_2_1;
	static readonly DEFAULT_WEB_AUTHN_SIGNER_FACTORY: string =
		DEFAULT_WEB_AUTHN_SIGNER_FACTORY_V_0_2_1;
	static readonly DEFAULT_WEB_AUTHN_SIGNER_PROXY_CREATION_CODE =
		DEFAULT_WEB_AUTHN_SIGNER_PROXY_CREATION_CODE_V_0_2_1;
	static readonly DEFAULT_WEB_AUTHN_PRECOMPILE: string = DEFAULT_WEB_AUTHN_PRECOMPILE_RIP_7951;
	// Daimo P256 contract verifier (Safe Passkey module v0.2.1). Same value
	// exposed under both names: DAIMO_VERIFIER for self-documentation and
	// CONTRACT_VERIFIER as the polymorphic slot fromSafeWebauthn reads.
	static readonly DEFAULT_WEB_AUTHN_DAIMO_VERIFIER: string =
		DEFAULT_WEB_AUTHN_DAIMO_VERIFIER_V_0_2_1;
	static readonly DEFAULT_WEB_AUTHN_CONTRACT_VERIFIER: string =
		DEFAULT_WEB_AUTHN_DAIMO_VERIFIER_V_0_2_1;

	/**
	 * Create a SafeMultiChainSigAccount instance for an existing or new account.
	 * @param accountAddress - the Safe account address
	 * @param overrides - optional overrides for module, entrypoint, and singleton addresses
	 */
	constructor(
		accountAddress: string,
		overrides: {
			safe4337ModuleAddress?: string;
			entrypointAddress?: string;
			onChainIdentifierParams?: OnChainIdentifierParamsType;
			onChainIdentifier?: string;
			safeAccountSingleton?: SafeAccountSingleton;
		} = {},
	) {
		const safe4337ModuleAddress =
			overrides.safe4337ModuleAddress ??
			SafeMultiChainSigAccountV1.DEFAULT_SAFE_4337_MODULE_ADDRESS;
		const entrypointAddress =
			overrides.entrypointAddress ?? SafeMultiChainSigAccountV1.DEFAULT_ENTRYPOINT_ADDRESS;

		super(accountAddress, safe4337ModuleAddress, entrypointAddress, {
			onChainIdentifierParams: overrides.onChainIdentifierParams,
			onChainIdentifier: overrides.onChainIdentifier,
			safeAccountSingleton: overrides.safeAccountSingleton,
		});
	}

	/**
	 * calculate account address from initial owners signers
	 * @param owners - list of account owners addresses
	 * @param overrides - override values to change the initialization default values
	 * @returns account address
	 */
	public static createAccountAddress(owners: Signer[], overrides: InitCodeOverrides = {}): string {
		// Init code only configures the shared signer and its verifier; the
		// verifier proxy is deployed and swapped in later by createUserOperation
		// (nonce == 0), which defaults webAuthnSignerFactory / Singleton /
		// ProxyCreationCode.
		const modOverrides = {
			...overrides,
			webAuthnSharedSigner:
				overrides.webAuthnSharedSigner ??
				SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_SHARED_SIGNER,
			eip7212WebAuthnPrecompileVerifierForSharedSigner:
				overrides.eip7212WebAuthnPrecompileVerifierForSharedSigner ??
				SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_PRECOMPILE,
			eip7212WebAuthnContractVerifierForSharedSigner:
				overrides.eip7212WebAuthnContractVerifierForSharedSigner ??
				SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_CONTRACT_VERIFIER,
		};
		const [accountAddress, ,] = SafeAccount.createAccountAddressAndFactoryAddressAndData(
			owners,
			modOverrides,
			overrides.safe4337ModuleAddress ??
				SafeMultiChainSigAccountV1.DEFAULT_SAFE_4337_MODULE_ADDRESS,
			overrides.safeModuleSetupAddress ??
				SafeMultiChainSigAccountV1.DEFAULT_SAFE_MODULE_SETUP_ADDRESS,
		);

		return accountAddress;
	}

	/**
	 * To create and initialize a SafeAccount object from its
	 * initial owners
	 * @remarks
	 * initializeNewAccount only needed when the smart account
	 * have not been deployed yet and the account address is unknown.
	 * @param owners - list of account owners signers
	 * @param overrides - override values to change the initialization default values
	 * @returns a SafeAccount object
	 */
	public static initializeNewAccount(
		owners: Signer[],
		overrides: InitCodeOverrides = {},
	): SafeMultiChainSigAccountV1 {
		let isInitWebAuthn = false;
		let x = 0n;
		let y = 0n;
		for (const owner of owners) {
			if (typeof owner !== "string") {
				if (isInitWebAuthn) {
					throw new RangeError("Only one Webauthn signer is allowed during initialization");
				}
				if (owners.indexOf(owner) !== 0) {
					throw new RangeError("Webauthn owner has to be the first owner for an init transaction.");
				}
				isInitWebAuthn = true;
				x = owner.x;
				y = owner.y;
			}
		}
		// Init code only configures the shared signer and its verifier; the
		// verifier proxy is deployed and swapped in later by createUserOperation
		// (nonce == 0), which defaults webAuthnSignerFactory / Singleton /
		// ProxyCreationCode.
		const modOverrides = {
			...overrides,
			webAuthnSharedSigner:
				overrides.webAuthnSharedSigner ??
				SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_SHARED_SIGNER,
			eip7212WebAuthnPrecompileVerifierForSharedSigner:
				overrides.eip7212WebAuthnPrecompileVerifierForSharedSigner ??
				SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_PRECOMPILE,
			eip7212WebAuthnContractVerifierForSharedSigner:
				overrides.eip7212WebAuthnContractVerifierForSharedSigner ??
				SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_CONTRACT_VERIFIER,
		};
		const [accountAddress, factoryAddress, factoryData] =
			SafeAccount.createAccountAddressAndFactoryAddressAndData(
				owners,
				modOverrides,
				overrides.safe4337ModuleAddress ??
					SafeMultiChainSigAccountV1.DEFAULT_SAFE_4337_MODULE_ADDRESS,
				overrides.safeModuleSetupAddress ??
					SafeMultiChainSigAccountV1.DEFAULT_SAFE_MODULE_SETUP_ADDRESS,
			);

		const safe = new SafeMultiChainSigAccountV1(accountAddress, {
			safe4337ModuleAddress: overrides.safe4337ModuleAddress,
			entrypointAddress: overrides.entrypointAddress,
			onChainIdentifierParams: overrides.onChainIdentifierParams,
			onChainIdentifier: overrides.onChainIdentifier,
			safeAccountSingleton: overrides.safeAccountSingleton,
		});
		safe.factoryAddress = factoryAddress;
		safe.factoryData = factoryData;
		if (isInitWebAuthn) {
			safe.isInitWebAuthn = true;
			safe.x = x;
			safe.y = y;
		}

		return safe;
	}

	/**
	 * create a useroperation eip712 hash
	 * @param useroperation - useroperation to hash
	 * @param chainId - target chain id
	 * @param overrides - overrides for the default values
	 * @param overrides.validAfter - timestamp the signature will be valid after
	 * @param overrides.validUntil - timestamp the signature will be valid until
	 * @param overrides.entrypoint - target entrypoint
	 * defaults to ENTRYPOINT_V9
	 * @param overrides.safe4337ModuleAddress - defaults to DEFAULT_SAFE_4337_MODULE_ADDRESS
	 * @returns useroperation hash
	 */
	public static getUserOperationEip712Hash(
		useroperation: UserOperationV9,
		chainId: bigint,
		overrides: {
			validAfter?: bigint;
			validUntil?: bigint;
			entrypointAddress?: string;
			safe4337ModuleAddress?: string;
		} = {},
	): string {
		const validAfter = overrides.validAfter ?? 0n;
		const validUntil = overrides.validUntil ?? 0n;
		const entrypointAddress =
			overrides.entrypointAddress ?? SafeMultiChainSigAccountV1.DEFAULT_ENTRYPOINT_ADDRESS;
		const safe4337ModuleAddress =
			overrides.safe4337ModuleAddress ??
			SafeMultiChainSigAccountV1.DEFAULT_SAFE_4337_MODULE_ADDRESS;

		return SafeAccount.getUserOperationEip712Hash(useroperation, chainId, {
			validAfter,
			validUntil,
			entrypointAddress,
			safe4337ModuleAddress,
		});
	}

	/**
	 * create a useroperation eip712 data
	 * @param useroperation - useroperation to hash
	 * @param chainId - target chain id
	 * @param overrides - overrides for the default values
	 * @param overrides.validAfter - timestamp the signature will be valid after
	 * @param overrides.validUntil - timestamp the signature will be valid until
	 * @param overrides.entrypoint - target entrypoint
	 * @param overrides.safe4337ModuleAddress - target module address
	 * @returns an object containing the typed data domain, type and typed data vales
	 * object needed for hashing and signing
	 */
	public static getUserOperationEip712Data(
		useroperation: UserOperationV9,
		chainId: bigint,
		overrides: {
			validAfter?: bigint;
			validUntil?: bigint;
			entrypointAddress?: string;
			safe4337ModuleAddress?: string;
		} = {},
	): {
		domain: SafeUserOperationTypedDataDomain;
		types: Record<string, { name: string; type: string }[]>;
		messageValue: SafeUserOperationV9TypedMessageValue;
	} {
		const validAfter = overrides.validAfter ?? 0n;
		const validUntil = overrides.validUntil ?? 0n;
		const entrypointAddress =
			overrides.entrypointAddress ?? SafeMultiChainSigAccountV1.DEFAULT_ENTRYPOINT_ADDRESS;
		const safe4337ModuleAddress =
			overrides.safe4337ModuleAddress ??
			SafeMultiChainSigAccountV1.DEFAULT_SAFE_4337_MODULE_ADDRESS;

		return SafeAccount.getUserOperationEip712Data(useroperation, chainId, {
			validAfter,
			validUntil,
			entrypointAddress,
			safe4337ModuleAddress,
		});
	}

	/**
	 * Create the initializer callData for setting up a new Safe account.
	 * @param owners - list of account owner signers
	 * @param threshold - number of required signatures for execution
	 * @param overrides - optional overrides for module and contract addresses
	 * @returns hex-encoded initializer callData
	 */
	public static createInitializerCallData(
		owners: Signer[],
		threshold: number,
		overrides: {
			safe4337ModuleAddress?: string;
			safeModuleSetupAddress?: string;
			multisendContractAddress?: string;
			webAuthnSharedSigner?: string;
			eip7212WebAuthnPrecompileVerifierForSharedSigner?: string;
			eip7212WebAuthnContractVerifierForSharedSigner?: string;
		} = {},
	): string {
		const safe4337ModuleAddress =
			overrides.safe4337ModuleAddress ??
			SafeMultiChainSigAccountV1.DEFAULT_SAFE_4337_MODULE_ADDRESS;
		const safeModuleSetupAddress =
			overrides.safeModuleSetupAddress ??
			SafeMultiChainSigAccountV1.DEFAULT_SAFE_MODULE_SETUP_ADDRESS;

		return SafeAccount.createBaseInitializerCallData(
			owners,
			threshold,
			safe4337ModuleAddress,
			safeModuleSetupAddress,
			overrides.multisendContractAddress,
			overrides.webAuthnSharedSigner ?? SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_SHARED_SIGNER,
			overrides.eip7212WebAuthnPrecompileVerifierForSharedSigner ??
				SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_PRECOMPILE,
			overrides.eip7212WebAuthnContractVerifierForSharedSigner ??
				SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_CONTRACT_VERIFIER,
		);
	}

	/**
	 * create account factory address and factory data
	 * @param owners - list of account owners signers
	 * @param overrides - override values to change the initialization default values
	 * @returns factoryAddress and factoryData
	 */
	public static createFactoryAddressAndData(
		owners: Signer[],
		overrides: InitCodeOverrides = {},
	): [string, string] {
		// Init code only configures the shared signer and its verifier; the
		// verifier proxy is deployed and swapped in later by createUserOperation
		// (nonce == 0), which defaults webAuthnSignerFactory / Singleton /
		// ProxyCreationCode.
		const modOverrides = {
			...overrides,
			webAuthnSharedSigner:
				overrides.webAuthnSharedSigner ??
				SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_SHARED_SIGNER,
			eip7212WebAuthnPrecompileVerifierForSharedSigner:
				overrides.eip7212WebAuthnPrecompileVerifierForSharedSigner ??
				SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_PRECOMPILE,
			eip7212WebAuthnContractVerifierForSharedSigner:
				overrides.eip7212WebAuthnContractVerifierForSharedSigner ??
				SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_CONTRACT_VERIFIER,
		};
		return SafeAccount.createFactoryAddressAndData(
			owners,
			modOverrides,
			overrides.safe4337ModuleAddress ??
				SafeMultiChainSigAccountV1.DEFAULT_SAFE_4337_MODULE_ADDRESS,
			overrides.safeModuleSetupAddress ??
				SafeMultiChainSigAccountV1.DEFAULT_SAFE_MODULE_SETUP_ADDRESS,
		);
	}

	/**
	 * createUserOperation will determine the nonce, fetch the gas prices,
	 * estimate gas limits and return a useroperation to be signed.
	 * you can override all these values using the overrides parameter.
	 * @param transactions - metatransaction list to be encoded
	 * @param providerRpc - node rpc to fetch account nonce and gas prices
	 * @param bundlerRpc - bundler rpc for gas estimation
	 * @param overrides - overrides for the default values
	 * @returns promise with useroperation
	 */
	public async createUserOperation(
		transactions: MetaTransaction[],
		providerRpc?: string,
		bundlerRpc?: string,
		overrides: CreateUserOperationV9Overrides = {},
	): Promise<UserOperationV9> {
		const parallelPaymasterInitValues = overrides.parallelPaymasterInitValues;
		if (
			parallelPaymasterInitValues != null &&
			!parallelPaymasterInitValues.paymasterData.toLowerCase().endsWith("22e325a297439656")
		) {
			throw new RangeError(
				"Invalid paymasterData override, it must end with the PAYMASTER_SIG_MAGIC '22e325a297439656'",
			);
		}
		const [userOperation, factoryAddress, factoryData] =
			await this.createBaseUserOperationAndFactoryAddressAndFactoryData(
				transactions,
				false,
				providerRpc,
				bundlerRpc,
				{
					...overrides,
					isMultiChainSignature: true,
					webAuthnSharedSigner:
						overrides.webAuthnSharedSigner ??
						SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_SHARED_SIGNER,
					eip7212WebAuthnPrecompileVerifier:
						overrides.eip7212WebAuthnPrecompileVerifier ??
						SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_PRECOMPILE,
					eip7212WebAuthnContractVerifier:
						overrides.eip7212WebAuthnContractVerifier ??
						SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_CONTRACT_VERIFIER,
					webAuthnSignerFactory:
						overrides.webAuthnSignerFactory ??
						SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_SIGNER_FACTORY,
					webAuthnSignerSingleton:
						overrides.webAuthnSignerSingleton ??
						SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_SIGNER_SINGLETON,
					webAuthnSignerProxyCreationCode:
						overrides.webAuthnSignerProxyCreationCode ??
						SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_SIGNER_PROXY_CREATION_CODE,
				},
			);
		if (parallelPaymasterInitValues != null) {
			return {
				...userOperation,
				factory: factoryAddress,
				factoryData,
				...parallelPaymasterInitValues,
				eip7702Auth: null,
			};
		} else {
			return {
				...userOperation,
				factory: factoryAddress,
				factoryData,
				paymaster: null,
				paymasterVerificationGasLimit: null,
				paymasterPostOpGasLimit: null,
				paymasterData: null,
				eip7702Auth: null,
			};
		}
	}

	/**
	 * create a useroperation signature
	 * @param useroperation - useroperation to sign
	 * @param privateKeys - for the signers
	 * @param chainId - target chain id
	 * @param options - {@link SafeSignatureOptions} — timing, multiChainMerkleProof, module address. The multi-chain flag is force-set true and overrides any caller value.
	 * @returns signature
	 */
	public signUserOperation(
		userOperation: UserOperationV9,
		privateKeys: string[],
		chainId: bigint,
		options: SafeSignatureOptions = {},
	): string {
		// Single-op path signs the leaf SafeOp hash directly (not a Merkle
		// root), so a caller-supplied proof would be silently encoded into
		// a signature that fails on-chain. Reject offline.
		if (options.multiChainMerkleProof != null && options.multiChainMerkleProof.length > 0) {
			throw new RangeError(
				"signUserOperation does not accept multiChainMerkleProof; use signUserOperations for multi-op Merkle signatures",
			);
		}
		return SafeAccount.baseSignSingleUserOperation(
			userOperation,
			privateKeys,
			chainId,
			this.entrypointAddress,
			this.safe4337ModuleAddress,
			{
				...options,
				isMultiChainSignature: true,
			},
		);
	}

	/**
	 * Sign a single UserOperation for multi-chain using one or more
	 * {@link AkSigner} instances. See
	 * {@link SafeAccountV0_3_0.signUserOperationWithSigners} for the full
	 * design rationale. Sets the multi-chain flag automatically.
	 *
	 * @param userOperation - UserOperation to sign
	 * @param signers - one ExternalSigner per owner (any order)
	 * @param chainId - target chain id
	 * @param options - {@link SafeSignatureOptions} — timing, multiChainMerkleProof, module address. The multi-chain flag is force-set true and overrides any caller value.
	 * @returns Promise resolving to the formatted signature string
	 */
	public signUserOperationWithSigners(
		userOperation: UserOperationV9,
		signers: ReadonlyArray<AkSigner>,
		chainId: bigint,
		options: SafeSignatureOptions = {},
	): Promise<string> {
		// Single-op path signs the leaf SafeOp hash directly (not a Merkle
		// root), so a caller-supplied proof would be silently encoded into
		// a signature that fails on-chain. Reject offline.
		if (options.multiChainMerkleProof != null && options.multiChainMerkleProof.length > 0) {
			throw new RangeError(
				"signUserOperationWithSigners does not accept multiChainMerkleProof; use signUserOperationsWithSigners for multi-op Merkle signatures",
			);
		}
		const context: SignContext<UserOperationV9> = {
			userOperation,
			chainId,
			entryPoint: this.entrypointAddress,
		};
		return SafeAccount.baseSignUserOperationWithSigners(userOperation, signers, chainId, {
			entrypointAddress: this.entrypointAddress,
			safe4337ModuleAddress: this.safe4337ModuleAddress,
			context,
			options: {
				...options,
				isMultiChainSignature: true,
			},
		});
	}

	/**
	 * sign a list of useroperations - multi chain signature
	 * @param useroperation - useroperation to sign
	 * @param privateKeys - for the signers
	 * @param chainId - target chain id
	 * @param overrides - overrides for the default values
	 * @param overrides.validAfter - timestamp the signature will be valid after
	 * @param overrides.validUntil - timestamp the signature will be valid until
	 * @returns signature
	 */
	public signUserOperations(
		userOperationsToSign: UserOperationToSign[],
		privateKeys: string[],
	): string[] {
		if (userOperationsToSign.length < 1) {
			throw new RangeError("There should be at least one userOperationsToSign");
		}
		if (privateKeys.length < 1) {
			throw new RangeError("There should be at least one privateKey");
		}
		if (userOperationsToSign.length > 1) {
			const userOperationsHashes: string[] = [];
			userOperationsToSign.forEach((userOperationsToSign, _index) => {
				const userOperationHash = SafeAccount.getUserOperationEip712Hash_V9(
					userOperationsToSign.userOperation,
					userOperationsToSign.chainId,
					{
						validAfter: userOperationsToSign.validAfter,
						validUntil: userOperationsToSign.validUntil,
						safe4337ModuleAddress: this.safe4337ModuleAddress,
						entrypointAddress: this.entrypointAddress,
					},
				);
				userOperationsHashes.push(userOperationHash);
			});
			const [root, proofs] = generateMerkleProofs(userOperationsHashes);

			const merkleTreeRootHash = TypedDataEncoder.hash(
				{ verifyingContract: this.safe4337ModuleAddress },
				EIP712_MULTI_CHAIN_OPERATIONS_TYPE,
				{ merkleTreeRoot: root },
			);

			const signerSignaturePairs: SignerSignaturePair[] = [];
			for (const privateKey of privateKeys) {
				const wallet = new Wallet(privateKey);
				const signature = wallet.signingKey.sign(merkleTreeRootHash).serialized;
				signerSignaturePairs.push({
					signer: wallet.address,
					signature,
				});
			}

			const userOpSignatures: string[] = [];
			userOperationsToSign.forEach((userOperationsToSign, index) => {
				userOpSignatures.push(
					SafeAccount.formatSignaturesToUseroperationSignature(signerSignaturePairs, {
						validAfter: userOperationsToSign.validAfter,
						validUntil: userOperationsToSign.validUntil,
						isMultiChainSignature: true,
						multiChainMerkleProof: proofs[index],
					}),
				);
			});
			return userOpSignatures;
		} else {
			return [
				this.signUserOperation(
					userOperationsToSign[0].userOperation,
					privateKeys,
					userOperationsToSign[0].chainId,
					{
						validUntil: userOperationsToSign[0].validUntil,
						validAfter: userOperationsToSign[0].validAfter,
					},
				),
			];
		}
	}

	/**
	 * Sign a list of UserOperations with a single multi-chain signature. Each
	 * signer signs the Merkle root of the UserOperation EIP-712 hashes via
	 * raw-hash signing; `signTypedData` isn't exposed because the Merkle root
	 * is opaque and has no meaningful typed-data display.
	 *
	 * Signers always receive {@link MultiOpSignContext}. The built-in adapters
	 * `fromPrivateKey`, `fromViem`, and `fromEthersWallet` return
	 * `Signer<unknown>` and work here without retyping; `fromViemWalletClient`
	 * does **not** — it only exposes `signTypedData`, so {@link pickScheme}
	 * rejects it offline. User-defined single-op signers
	 * (`Signer<SignContext>`) also don't work — they'd receive a context shape
	 * they didn't declare.
	 *
	 * @param userOperationsToSign - UserOperations + chain IDs + validity windows
	 * @param signers - one Signer per owner (any order; sorted by address on-chain)
	 * @returns one signature per input UserOperation, in the same order
	 */
	public async signUserOperationsWithSigners(
		userOperationsToSign: UserOperationToSign[],
		signers: ReadonlyArray<AkSigner<MultiOpSignContext<UserOperationV9>>>,
	): Promise<string[]> {
		if (userOperationsToSign.length < 1) {
			throw new RangeError("There should be at least one userOperationsToSign");
		}
		if (signers.length < 1) {
			throw new RangeError("There should be at least one signer");
		}

		// Multi-op context: signers see the full bundle (length 1 or N) so
		// they can log "authorizing N ops across these chains".
		const context: MultiOpSignContext<UserOperationV9> = {
			userOperations: userOperationsToSign.map((u) => ({
				userOperation: u.userOperation,
				chainId: u.chainId,
			})),
			entryPoint: this.entrypointAddress,
		};

		if (userOperationsToSign.length > 1) {
			const userOperationsHashes: string[] = [];
			userOperationsToSign.forEach((uopToSign) => {
				const userOperationHash = SafeAccount.getUserOperationEip712Hash_V9(
					uopToSign.userOperation,
					uopToSign.chainId,
					{
						validAfter: uopToSign.validAfter,
						validUntil: uopToSign.validUntil,
						safe4337ModuleAddress: this.safe4337ModuleAddress,
						entrypointAddress: this.entrypointAddress,
					},
				);
				userOperationsHashes.push(userOperationHash);
			});
			const [root, proofs] = generateMerkleProofs(userOperationsHashes);

			const merkleTreeRootHash = TypedDataEncoder.hash(
				{ verifyingContract: this.safe4337ModuleAddress },
				EIP712_MULTI_CHAIN_OPERATIONS_TYPE,
				{ merkleTreeRoot: root },
			) as `0x${string}`;

			// Preflight: validate + checksum every signer's address before
			// calling any signer. Catches malformed addresses offline
			// instead of after an external signer has been prompted.
			const normalizedAddresses = signers.map((signer) => getAddress(signer.address));

			// Merkle root is opaque; signTypedData has nothing meaningful to
			// display, so we require raw-hash signing.
			signers.forEach((signer, i) => {
				pickScheme(signer, ["hash"], {
					accountName: "SafeMultiChainSigAccountV1 (multi-op Merkle root)",
					signerIndex: i,
				});
			});

			const signatures = await Promise.all(
				signers.map((signer) =>
					invokeSigner(signer, "hash", {
						hash: merkleTreeRootHash,
						context,
					}),
				),
			);
			const signerSignaturePairs: SignerSignaturePair[] = signers.map((_signer, i) => ({
				signer: normalizedAddresses[i],
				signature: signatures[i],
				isContractSignature: signers[i].type === "contract",
			}));

			const userOpSignatures: string[] = [];
			userOperationsToSign.forEach((uopToSign, index) => {
				userOpSignatures.push(
					SafeAccount.formatSignaturesToUseroperationSignature(signerSignaturePairs, {
						validAfter: uopToSign.validAfter,
						validUntil: uopToSign.validUntil,
						isMultiChainSignature: true,
						multiChainMerkleProof: proofs[index],
					}),
				);
			});
			return userOpSignatures;
		} else {
			// length === 1: single op with multi-chain flag; signers still get
			// the length-1 multi-op context so the runtime shape matches their
			// declared type.
			const u = userOperationsToSign[0];
			const sig = await SafeAccount.baseSignUserOperationWithSigners(
				u.userOperation,
				signers,
				u.chainId,
				{
					entrypointAddress: this.entrypointAddress,
					safe4337ModuleAddress: this.safe4337ModuleAddress,
					context,
					options: {
						validAfter: u.validAfter,
						validUntil: u.validUntil,
						isMultiChainSignature: true,
					},
				},
			);
			return [sig];
		}
	}

	/**
	 * Compute the EIP-712 hash that owners must sign for a multi-chain bundle.
	 *
	 * For length≥2: returns the Merkle root wrapper digest signed once across
	 * all UserOperations.
	 *
	 * For length=1: returns the per-UserOperation SafeOp digest, matching the
	 * `merkleTreeDepth == 0` branch on the deployed Safe4337MultiChainSignatureModule
	 * (which validates against `keccak256(SafeOp)` directly, not the Merkle wrapper).
	 * Returning the wrapper here would produce a signature the on-chain depth=0
	 * path rejects with AA24: the formatter still emits the depth=0 layout the
	 * contract expects, so the digest must match.
	 *
	 * @param userOperationsToSignsToSign - list of UserOperations with their target chain IDs
	 * @param overrides - optional overrides for the Safe 4337 module address
	 * @returns the EIP-712 hash as a hex string
	 */
	public static getMultiChainSingleSignatureUserOperationsEip712Hash(
		userOperationsToSignsToSign: UserOperationToSign[],
		overrides: {
			safe4337ModuleAddress?: string;
			entrypointAddress?: string;
		} = {},
	): string {
		if (userOperationsToSignsToSign.length < 1) {
			throw new RangeError("There should be at least one userOperationsToSign");
		}
		if (userOperationsToSignsToSign.length === 1) {
			const u = userOperationsToSignsToSign[0];
			return SafeAccount.getUserOperationEip712Hash_V9(u.userOperation, u.chainId, {
				validAfter: u.validAfter,
				validUntil: u.validUntil,
				safe4337ModuleAddress:
					overrides.safe4337ModuleAddress ??
					SafeMultiChainSigAccountV1.DEFAULT_SAFE_4337_MODULE_ADDRESS,
				entrypointAddress: overrides.entrypointAddress,
			});
		}
		const data = SafeMultiChainSigAccountV1.getMultiChainSingleSignatureUserOperationsEip712Data(
			userOperationsToSignsToSign,
			overrides,
		);
		return TypedDataEncoder.hash(data.domain, data.types, data.messageValue);
	}

	/**
	 * Get the EIP-712 typed data components for a multi-chain Merkle tree root.
	 * Returns the domain, types, and message value needed for signing or hashing.
	 *
	 * Throws for length=1: the on-chain depth=0 path verifies against the per-op
	 * SafeOp digest, not a Merkle wrapper, so the wrapper typed data would be
	 * misleading. Use {@link SafeMultiChainSigAccountV1.getUserOperationEip712Data}
	 * (or {@link SafeMultiChainSigAccountV1.getUserOperationEip712Hash}) for
	 * single-op signing: those multichain-class overrides default
	 * `safe4337ModuleAddress` to `DEFAULT_SAFE_4337_MODULE_ADDRESS`. The parent
	 * `SafeAccount.getUserOperationEip712Data_V9` / `getUserOperationEip712Hash_V9`
	 * helpers default to a different module and would hash against the wrong
	 * verifying contract unless `overrides.safe4337ModuleAddress` is supplied
	 * explicitly.
	 *
	 * @param userOperationsToSignsToSign - list of UserOperations with their target chain IDs
	 * @param overrides - optional overrides for the Safe 4337 module address
	 * @returns an object with domain, types, and messageValue for EIP-712 signing
	 */
	public static getMultiChainSingleSignatureUserOperationsEip712Data(
		userOperationsToSign: UserOperationToSign[],
		overrides: {
			safe4337ModuleAddress?: string;
			entrypointAddress?: string;
		} = {},
	): {
		domain: MultiChainSignatureMerkleTreeRootTypedDataDomain;
		types: Record<string, { name: string; type: string }[]>;
		messageValue: MultiChainSignatureMerkleTreeRootTypedMessageValue;
	} {
		if (userOperationsToSign.length < 2) {
			throw new RangeError(
				"getMultiChainSingleSignatureUserOperationsEip712Data requires >= 2 userOperations. " +
					"For a single UserOperation, use SafeMultiChainSigAccountV1.getUserOperationEip712Data " +
					"or SafeMultiChainSigAccountV1.getUserOperationEip712Hash (these multichain-class overrides " +
					"default safe4337ModuleAddress to DEFAULT_SAFE_4337_MODULE_ADDRESS, the multi-chain module). " +
					"The on-chain depth=0 path verifies against the per-op SafeOp digest, not a Merkle wrapper. " +
					"If calling the parent SafeAccount.getUserOperationEip712Data_V9 / getUserOperationEip712Hash_V9 " +
					"helpers directly, you must pass overrides.safe4337ModuleAddress = " +
					"SafeMultiChainSigAccountV1.DEFAULT_SAFE_4337_MODULE_ADDRESS explicitly so signatures hash " +
					"the correct verifying contract.",
			);
		}
		const safe4337ModuleAddress =
			overrides.safe4337ModuleAddress ??
			SafeMultiChainSigAccountV1.DEFAULT_SAFE_4337_MODULE_ADDRESS;

		const userOperationsHashes: string[] = [];

		userOperationsToSign.forEach((userOperationsToSign, _index) => {
			const userOperationHash = SafeAccount.getUserOperationEip712Hash_V9(
				userOperationsToSign.userOperation,
				userOperationsToSign.chainId,
				{
					validAfter: userOperationsToSign.validAfter,
					validUntil: userOperationsToSign.validUntil,
					safe4337ModuleAddress,
					entrypointAddress: overrides.entrypointAddress,
				},
			);
			userOperationsHashes.push(userOperationHash);
		});
		const [root, _proofs] = generateMerkleProofs(userOperationsHashes);
		return {
			domain: { verifyingContract: safe4337ModuleAddress },
			types: EIP712_MULTI_CHAIN_OPERATIONS_TYPE,
			messageValue: { merkleTreeRoot: root },
		};
	}

	/**
	 * format a list of eip712 signatures to a list of multi chain useroperations signatures
	 * @param signerSignaturePairs - a list of a pair of a signer and it's signature
	 * @param overrides - overrides for the default values
	 * @returns signature
	 */
	public static formatSignaturesToUseroperationsSignatures(
		userOperationsToSign: UserOperationToSignWithOverrides[],
		signerSignaturePairs: SignerSignaturePair[],
	): string[] {
		if (userOperationsToSign.length < 1) {
			throw new RangeError("There should be at least one userOperationsToSign");
		}
		const defaultWebAuthnOverrides: WebAuthnSignatureOverrides = {
			eip7212WebAuthnPrecompileVerifier: SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_PRECOMPILE,
			eip7212WebAuthnContractVerifier: SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_CONTRACT_VERIFIER,
			webAuthnSignerFactory: SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_SIGNER_FACTORY,
			webAuthnSignerSingleton: SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_SIGNER_SINGLETON,
			webAuthnSignerProxyCreationCode:
				SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_SIGNER_PROXY_CREATION_CODE,
			webAuthnSharedSigner: SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_SHARED_SIGNER,
		};
		const defaultOptions: SafeSignatureOptions = {
			safe4337ModuleAddress: SafeMultiChainSigAccountV1.DEFAULT_SAFE_4337_MODULE_ADDRESS,
		};
		if (userOperationsToSign.length === 1) {
			return [
				SafeAccount.formatSignaturesToUseroperationSignature(signerSignaturePairs, {
					...defaultOptions,
					...defaultWebAuthnOverrides,
					...userOperationsToSign[0].options,
					...userOperationsToSign[0].webAuthnSignatureOverrides,
					validAfter: userOperationsToSign[0].validAfter,
					validUntil: userOperationsToSign[0].validUntil,
					isMultiChainSignature: true,
				}),
			];
		}
		const userOperationsHashes: string[] = [];
		// Resolve validity windows once per op so leaf hashing and signature
		// formatting agree. Options take precedence over the top-level fields
		// when set; falling through to the top-level avoids encoding 0/0 in
		// the SafeOp digest while the formatter encoded a non-zero window
		// (or vice versa).
		const resolvedValidity = userOperationsToSign.map((userOperationToSign) => ({
			validAfter: userOperationToSign.options?.validAfter ?? userOperationToSign.validAfter,
			validUntil: userOperationToSign.options?.validUntil ?? userOperationToSign.validUntil,
		}));
		userOperationsToSign.forEach((userOperationToSign, index) => {
			const userOperationHash = SafeAccount.getUserOperationEip712Hash_V9(
				userOperationToSign.userOperation,
				userOperationToSign.chainId,
				{
					validAfter: resolvedValidity[index].validAfter,
					validUntil: resolvedValidity[index].validUntil,
					safe4337ModuleAddress:
						userOperationToSign.options?.safe4337ModuleAddress ??
						defaultOptions.safe4337ModuleAddress,
				},
			);
			userOperationsHashes.push(userOperationHash);
		});
		const [_root, proofs] = generateMerkleProofs(userOperationsHashes);
		const userOpSignatures: string[] = [];
		userOperationsToSign.forEach((userOperationToSign, index) => {
			userOpSignatures.push(
				SafeAccount.formatSignaturesToUseroperationSignature(signerSignaturePairs, {
					...defaultOptions,
					...defaultWebAuthnOverrides,
					...userOperationToSign.options,
					...userOperationToSign.webAuthnSignatureOverrides,
					validAfter: resolvedValidity[index].validAfter,
					validUntil: resolvedValidity[index].validUntil,
					isMultiChainSignature: true,
					multiChainMerkleProof: proofs[index],
				}),
			);
		});
		return userOpSignatures;
	}

	public static createWebAuthnSignerVerifierAddress(
		x: bigint,
		y: bigint,
		overrides: {
			eip7212WebAuthnPrecompileVerifier?: string;
			eip7212WebAuthnContractVerifier?: string;
			webAuthnSignerFactory?: string;
			webAuthnSignerSingleton?: string;
			webAuthnSignerProxyCreationCode?: string;
		} = {},
	): string {
		return SafeAccount.createWebAuthnSignerVerifierAddress(x, y, {
			...overrides,
			eip7212WebAuthnPrecompileVerifier:
				overrides.eip7212WebAuthnPrecompileVerifier ??
				SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_PRECOMPILE,
			eip7212WebAuthnContractVerifier:
				overrides.eip7212WebAuthnContractVerifier ??
				SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_CONTRACT_VERIFIER,
			webAuthnSignerFactory:
				overrides.webAuthnSignerFactory ??
				SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_SIGNER_FACTORY,
			webAuthnSignerSingleton:
				overrides.webAuthnSignerSingleton ??
				SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_SIGNER_SINGLETON,
			webAuthnSignerProxyCreationCode:
				overrides.webAuthnSignerProxyCreationCode ??
				SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_SIGNER_PROXY_CREATION_CODE,
		});
	}

	public static createDeployWebAuthnVerifierMetaTransaction(
		x: bigint,
		y: bigint,
		overrides: {
			eip7212WebAuthnPrecompileVerifier?: string;
			eip7212WebAuthnContractVerifier?: string;
			webAuthnSignerFactory?: string;
		} = {},
	): MetaTransaction {
		return SafeAccount.createDeployWebAuthnVerifierMetaTransaction(x, y, {
			...overrides,
			eip7212WebAuthnPrecompileVerifier:
				overrides.eip7212WebAuthnPrecompileVerifier ??
				SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_PRECOMPILE,
			eip7212WebAuthnContractVerifier:
				overrides.eip7212WebAuthnContractVerifier ??
				SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_CONTRACT_VERIFIER,
			webAuthnSignerFactory:
				overrides.webAuthnSignerFactory ??
				SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_SIGNER_FACTORY,
		});
	}

	public static createDummySignerSignaturePairForExpectedSigners(
		expectedSigners: Signer[],
		webAuthnSignatureOverrides: WebAuthnSignatureOverrides = {},
	): SignerSignaturePair[] {
		return SafeAccount.createDummySignerSignaturePairForExpectedSigners(expectedSigners, {
			...webAuthnSignatureOverrides,
			eip7212WebAuthnPrecompileVerifier:
				webAuthnSignatureOverrides.eip7212WebAuthnPrecompileVerifier ??
				SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_PRECOMPILE,
			eip7212WebAuthnContractVerifier:
				webAuthnSignatureOverrides.eip7212WebAuthnContractVerifier ??
				SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_CONTRACT_VERIFIER,
			webAuthnSignerFactory:
				webAuthnSignatureOverrides.webAuthnSignerFactory ??
				SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_SIGNER_FACTORY,
			webAuthnSignerSingleton:
				webAuthnSignatureOverrides.webAuthnSignerSingleton ??
				SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_SIGNER_SINGLETON,
			webAuthnSignerProxyCreationCode:
				webAuthnSignatureOverrides.webAuthnSignerProxyCreationCode ??
				SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_SIGNER_PROXY_CREATION_CODE,
			webAuthnSharedSigner:
				webAuthnSignatureOverrides.webAuthnSharedSigner ??
				SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_SHARED_SIGNER,
		});
	}

	public static async verifyWebAuthnSignatureForMessageHash(
		nodeRpcUrl: string,
		signer: WebauthnPublicKey,
		messageHash: string,
		signature: string,
		overrides: {
			eip7212WebAuthnPrecompileVerifier?: string;
			eip7212WebAuthnContractVerifier?: string;
			webAuthnSignerSingleton?: string;
		} = {},
	): Promise<boolean> {
		return SafeAccount.verifyWebAuthnSignatureForMessageHash(
			nodeRpcUrl,
			signer,
			messageHash,
			signature,
			{
				...overrides,
				eip7212WebAuthnPrecompileVerifier:
					overrides.eip7212WebAuthnPrecompileVerifier ??
					SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_PRECOMPILE,
				eip7212WebAuthnContractVerifier:
					overrides.eip7212WebAuthnContractVerifier ??
					SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_CONTRACT_VERIFIER,
				webAuthnSignerSingleton:
					overrides.webAuthnSignerSingleton ??
					SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_SIGNER_SINGLETON,
			},
		);
	}
}
