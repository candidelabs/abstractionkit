import { AbiCoder, Wallet } from "ethers";
import { Bundler } from "src/Bundler";
import { BaseUserOperationDummyValues, ENTRYPOINT_V8, ENTRYPOINT_V9 } from "src/constants";
import { AbstractionKitError } from "src/errors";
import { invokeSigner, pickScheme } from "src/signer/negotiate";
import type { Signer as AkSigner, SignContext, SigningScheme } from "src/signer/types";
import type {
	GasOption,
	JsonRpcResult,
	PolygonChain,
	StateOverrideSet,
	UserOperationV8,
	UserOperationV9,
} from "src/types";
import {
	type Authorization7702Hex,
	bigintToHex,
	createAndSignEip7702RawTransaction,
	createRevokeDelegationAuthorization,
} from "src/utils7702";
import {
	createCallData,
	createUserOperationHash,
	fetchAccountNonce,
	getDelegatedAddress,
	getFunctionSelector,
	handlefetchGasPrice,
	sendJsonRpcRequest,
} from "../../utils";
import { SendUseroperationResponse } from "../SendUseroperationResponse";
import { SmartAccount } from "../SmartAccount";

/**
 * A minimal transaction object for EIP-7702 simple accounts.
 * Represents a single call with a target address, ETH value, and calldata.
 */
export interface SimpleMetaTransaction {
	/** Target contract or EOA address */
	to: string;
	/** Amount of native token (in wei) to send with the call */
	value: bigint;
	/** ABI-encoded calldata, or "0x" for plain ETH transfers */
	data: string;
}

/**
 * Optional overrides for UserOperation fields when calling
 * {@link BaseSimple7702Account.baseCreateUserOperation}.
 * Any field left undefined will be auto-determined (nonce fetched from RPC,
 * gas limits estimated via bundler, gas prices fetched from the network).
 */
export interface CreateUserOperationOverrides {
	/** set the nonce instead of quering the current nonce from the rpc node */
	nonce?: bigint;
	/** set the callData instead of using the encoding of the provided Metatransactions*/
	callData?: string;
	/** set the callGasLimit instead of estimating gas using the bundler*/
	callGasLimit?: bigint;
	/** set the verificationGasLimit instead of estimating gas using the bundler*/
	verificationGasLimit?: bigint;
	/** set the preVerificationGas instead of estimating gas using the bundler*/
	preVerificationGas?: bigint;
	/** set the maxFeePerGas instead of quering the current gas price from the rpc node */
	maxFeePerGas?: bigint;
	/** set the maxPriorityFeePerGas instead of quering the current gas price from the rpc node */
	maxPriorityFeePerGas?: bigint;

	/** set the callGasLimitPercentageMultiplier instead of estimating gas using the bundler*/
	callGasLimitPercentageMultiplier?: number;
	/** set the verificationGasLimitPercentageMultiplier instead of estimating gas using the bundler*/
	verificationGasLimitPercentageMultiplier?: number;
	/** set the preVerificationGasPercentageMultiplier instead of estimating gas using the bundler*/
	preVerificationGasPercentageMultiplier?: number;
	/** set the maxFeePerGasPercentageMultiplier instead of quering the current gas price from the rpc node */
	maxFeePerGasPercentageMultiplier?: number;
	/** set the maxPriorityFeePerGasPercentageMultiplier instead of quering the current gas price from the rpc node */
	maxPriorityFeePerGasPercentageMultiplier?: number;

	/** pass some state overrides for gas estimation"*/
	state_override_set?: StateOverrideSet;

	/** Override the dummy signature used during gas estimation */
	dummySignature?: string;

	/** Gas price level preference (e.g., slow, medium, fast) */
	gasLevel?: GasOption;
	/** Polygon chain identifier for fetching gas prices from Polygon Gas Station */
	polygonGasStation?: PolygonChain;

	/**
	 * EIP-7702 authorization fields. When provided, the UserOperation
	 * will include an authorization tuple that delegates the EOA to
	 * the account's delegatee contract. If address/nonce are omitted,
	 * defaults are used (delegateeAddress and fetched from RPC respectively).
	 */
	eip7702Auth?: {
		chainId: bigint;
		address?: string;
		nonce?: bigint;
		yParity?: string;
		r?: string;
		s?: string;
	};

	parallelPaymasterInitValues?: {
		/** set the paymaster contract address */
		paymaster: string;
		/** set the paymaster verification gas limit */
		paymasterVerificationGasLimit: bigint;
		/** set the paymaster post-operation gas limit */
		paymasterPostOpGasLimit: bigint;
		/** set the paymaster data, only valid value is 0x22e325a297439656 */
		paymasterData: string;
	};
}

/**
 * Abstract base class for EIP-7702 simple smart accounts.
 * Provides shared logic for creating, signing, and sending UserOperations
 * using the SimpleAccount execute/executeBatch interface. Subclasses
 * (e.g., {@link Simple7702Account}, {@link Simple7702AccountV09}) bind
 * a specific EntryPoint version and delegatee address.
 */
export class BaseSimple7702Account extends SmartAccount {
	/** Function selector for `execute(address,uint256,bytes)` */
	static readonly executorFunctionSelector = "0xb61d27f6"; //execute
	/** ABI parameter types for the single-call `execute` function */
	static readonly executorFunctionInputAbi: string[] = [
		"address", //dest
		"uint256", //value
		"bytes", //func
	];
	/** Function selector for `executeBatch((address,uint256,bytes)[])` */
	static readonly batchExecutorFunctionSelector = "0x34fcd5be"; //executeBatch
	/** ABI parameter types for the batch `executeBatch` function */
	static readonly batchExecutorFunctionInputAbi = ["(address,uint256,bytes)[]"];
	/** Dummy ECDSA signature used during gas estimation */
	static readonly dummySignature =
		"0xd2614025fc173b86704caf37b2fb447f7618101a0d31f5f304c777024cef38a060a29ee43fcf0c46f9107d4f670b8a85c2c017a1fe9e4af891f24f0be6ba5d671c";

	/** The EntryPoint contract address this account targets */
	readonly entrypointAddress: string;
	/** The EIP-7702 delegatee (implementation) contract address */
	readonly delegateeAddress: string;

	/**
	 * @param accountAddress - The EOA address that will be delegated via EIP-7702
	 * @param entrypointAddress - The EntryPoint contract address
	 * @param delegateeAddress - The EIP-7702 delegatee (implementation) contract address
	 */
	constructor(accountAddress: string, entrypointAddress: string, delegateeAddress: string) {
		super(accountAddress);
		this.entrypointAddress = entrypointAddress;
		this.delegateeAddress = delegateeAddress;
	}

	/**
	 * Check if this EOA is delegated to the expected delegatee address via EIP-7702.
	 * Returns `true` only when delegated to `this.delegateeAddress`.
	 * Use `getDelegatedAddress()` directly to get the raw delegatee address.
	 *
	 * @param providerRpc - Ethereum JSON-RPC node URL
	 * @returns `true` if delegated to the expected address, `false` otherwise
	 */
	public async isDelegatedToThisAccount(providerRpc: string): Promise<boolean> {
		const address = await getDelegatedAddress(this.accountAddress, providerRpc);
		if (address === null) return false;
		return address.toLowerCase() === this.delegateeAddress.toLowerCase();
	}

	/**
	 * Create a signed raw EIP-7702 transaction that revokes the delegation,
	 * restoring the EOA to a normal account. The transaction is type 0x04
	 * with a zero-address authorization.
	 *
	 * Cannot be done via UserOp — the authorization_list is processed before
	 * execution, removing the account's code mid-transaction.
	 *
	 * Authorization nonce defaults to txNonce + 1 because EIP-7702 increments
	 * the sender's transaction nonce before processing the authorization list.
	 *
	 * @param eoaPrivateKey - The EOA's private key (signs both auth and tx)
	 * @param providerRpc - JSON-RPC endpoint for nonce, gas price, chain ID
	 * @param overrides - Optional overrides for transaction fields
	 * @returns Signed raw transaction hex, ready for `eth_sendRawTransaction`
	 */
	public async createRevokeDelegationTransaction(
		eoaPrivateKey: string,
		providerRpc: string,
		overrides: {
			nonce?: bigint;
			authorizationNonce?: bigint;
			maxFeePerGas?: bigint;
			maxPriorityFeePerGas?: bigint;
			gasLimit?: bigint;
			chainId?: bigint;
		} = {},
	): Promise<string> {
		// Verify delegation state before revoking
		const delegatedTo = await getDelegatedAddress(this.accountAddress, providerRpc);
		if (delegatedTo === null) {
			throw new AbstractionKitError("BAD_DATA", "Account is not delegated — nothing to revoke");
		}
		if (delegatedTo.toLowerCase() !== this.delegateeAddress.toLowerCase()) {
			throw new AbstractionKitError(
				"BAD_DATA",
				"Account is delegated to a different address (" +
					delegatedTo +
					"), not " +
					this.delegateeAddress +
					" — use the correct account class to revoke",
			);
		}

		const results: {
			nonce?: bigint;
			maxFeePerGas?: bigint;
			maxPriorityFeePerGas?: bigint;
			chainId?: bigint;
		} = {};

		// Build parallel fetch list
		const ops: Promise<void>[] = [];

		if (overrides.nonce == null) {
			ops.push(
				sendJsonRpcRequest(providerRpc, "eth_getTransactionCount", [
					this.accountAddress,
					"latest",
				]).then((v) => {
					results.nonce = BigInt(v as string);
				}),
			);
		}

		if (overrides.maxFeePerGas == null || overrides.maxPriorityFeePerGas == null) {
			ops.push(
				handlefetchGasPrice(providerRpc, undefined).then(([fee, tip]) => {
					results.maxFeePerGas = fee;
					results.maxPriorityFeePerGas = tip;
				}),
			);
		}

		if (overrides.chainId == null) {
			ops.push(
				sendJsonRpcRequest(providerRpc, "eth_chainId", []).then((v) => {
					results.chainId = BigInt(v as string);
				}),
			);
		}

		if (ops.length > 0) await Promise.all(ops);

		const txNonce = overrides.nonce ?? results.nonce ?? 0n;
		const maxFeePerGas = overrides.maxFeePerGas ?? results.maxFeePerGas ?? 0n;
		const maxPriorityFeePerGas =
			overrides.maxPriorityFeePerGas ?? results.maxPriorityFeePerGas ?? 0n;
		const chainId = overrides.chainId ?? results.chainId ?? 0n;

		// Authorization nonce = txNonce + 1 by default
		// (tx nonce is incremented before authorization processing in EIP-7702)
		const authNonce = overrides.authorizationNonce ?? txNonce + 1n;

		// Create undelegation authorization (returns Authorization7702Hex)
		const authHex = createRevokeDelegationAuthorization(chainId, authNonce, eoaPrivateKey);

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
	 * Encode calldata for a single `execute(address,uint256,bytes)` call.
	 * @param to - Target contract or EOA address
	 * @param value - Amount of native token (in wei) to transfer
	 * @param data - ABI-encoded calldata for the target
	 * @returns Encoded calldata for the execute function
	 */
	public static createAccountCallData(to: string, value: bigint, data: string): string {
		const executorFunctionInputParameters = [to, value, data];
		const callData = createCallData(
			BaseSimple7702Account.executorFunctionSelector,
			BaseSimple7702Account.executorFunctionInputAbi,
			executorFunctionInputParameters,
		);
		return callData;
	}

	/**
	 * Encode calldata for a single {@link SimpleMetaTransaction} using `execute`.
	 * @param metaTransaction - The transaction to encode
	 * @returns Encoded calldata for the execute function
	 */
	public static createAccountCallDataSingleTransaction(
		metaTransaction: SimpleMetaTransaction,
	): string {
		const value = metaTransaction.value ?? 0;
		const data = metaTransaction.data ?? "0x";
		const executorFunctionCallData = BaseSimple7702Account.createAccountCallData(
			metaTransaction.to,
			value,
			data,
		);
		return executorFunctionCallData;
	}

	/**
	 * Encode calldata for a batch of {@link SimpleMetaTransaction}s using `executeBatch`.
	 * @param transactions - Array of transactions to batch
	 * @returns Encoded calldata for the executeBatch function
	 */
	public static createAccountCallDataBatchTransactions(
		transactions: SimpleMetaTransaction[],
	): string {
		const encodedTransactions = [
			transactions.map((transaction) => [transaction.to, transaction.value, transaction.data]),
		];
		const callData = createCallData(
			BaseSimple7702Account.batchExecutorFunctionSelector,
			BaseSimple7702Account.batchExecutorFunctionInputAbi,
			encodedTransactions,
		);
		return callData;
	}

	/**
	 * Build an unsigned UserOperation from one or more transactions.
	 * Determines nonce, fetches gas prices, estimates gas limits, and
	 * optionally includes EIP-7702 authorization. All auto-determined
	 * values can be overridden.
	 * @param transactions - One or more transactions to encode into callData
	 * @param providerRpc - JSON-RPC endpoint for nonce and gas price queries
	 * @param bundlerRpc - Bundler RPC endpoint for gas estimation
	 * @param overrides - Optional overrides for gas, nonce, and EIP-7702 auth fields
	 * @returns A promise resolving to an unsigned UserOperation (v8 or v9)
	 */
	protected async baseCreateUserOperation(
		transactions: SimpleMetaTransaction[],
		providerRpc?: string,
		bundlerRpc?: string,
		overrides: CreateUserOperationOverrides = {},
	): Promise<UserOperationV8 | UserOperationV9> {
		if (transactions.length < 1) {
			throw new RangeError("There should be at least one transaction");
		}
		let nonce: bigint | null = null;
		let nonceOp: Promise<bigint> | null = null;

		if (overrides.nonce == null) {
			if (providerRpc != null) {
				nonceOp = fetchAccountNonce(providerRpc, this.entrypointAddress, this.accountAddress);
			} else {
				throw new AbstractionKitError(
					"BAD_DATA",
					"providerRpc cant't be null if nonce is not overriden",
				);
			}
		} else {
			nonce = overrides.nonce;
		}

		if (typeof overrides.maxFeePerGas === "bigint" && overrides.maxFeePerGas < 0n) {
			throw new RangeError("maxFeePerGas override can't be negative");
		}

		if (typeof overrides.maxPriorityFeePerGas === "bigint" && overrides.maxPriorityFeePerGas < 0n) {
			throw new RangeError("maxPriorityFeePerGas override can't be negative");
		}
		let maxFeePerGas = BaseUserOperationDummyValues.maxFeePerGas;
		let maxPriorityFeePerGas = BaseUserOperationDummyValues.maxPriorityFeePerGas;

		let gasPriceOp: Promise<[bigint, bigint]> | null = null;
		if (overrides.maxFeePerGas == null || overrides.maxPriorityFeePerGas == null) {
			gasPriceOp = handlefetchGasPrice(
				providerRpc,
				overrides.polygonGasStation,
				overrides.gasLevel,
			);
		}

		let eip7702AuthChainId: bigint | null = null;
		let eip7702AuthAddress: string | null = null;
		let eip7702AuthNonce: bigint | null = null;
		let skipEip7702Auth = false;

		if (overrides.eip7702Auth != null) {
			eip7702AuthChainId = overrides.eip7702Auth.chainId;
			eip7702AuthAddress = overrides.eip7702Auth.address ?? this.delegateeAddress;
			eip7702AuthNonce = overrides.eip7702Auth.nonce ?? null;
		}

		// When eip7702Auth is provided, check delegation status in parallel.
		// Best-effort: if the check fails, proceed as if not delegated.
		let delegationCheckOp: Promise<string | null> | null = null;
		if (overrides.eip7702Auth != null && providerRpc != null) {
			delegationCheckOp = getDelegatedAddress(this.accountAddress, providerRpc).catch(() => null);
		}

		if (overrides.eip7702Auth != null && eip7702AuthNonce == null) {
			//check for eip7702AuthNonce
			let eip7702AuthNonceOp: Promise<JsonRpcResult>;
			if (providerRpc != null) {
				eip7702AuthNonceOp = sendJsonRpcRequest(providerRpc, "eth_getTransactionCount", [
					this.accountAddress,
					"latest",
				]);
			} else {
				throw new AbstractionKitError(
					"BAD_DATA",
					"providerRpc cant't be null if eoaDelegatorNonce " + "is not overriden",
				);
			}

			// Build array of all parallel operations
			const ops: Promise<unknown>[] = [eip7702AuthNonceOp];
			if (nonceOp != null) ops.push(nonceOp);
			if (gasPriceOp != null) ops.push(gasPriceOp);
			if (delegationCheckOp != null) ops.push(delegationCheckOp);

			const values = await Promise.all(ops);
			let idx = 0;
			eip7702AuthNonce = BigInt(values[idx++] as string);
			if (nonceOp != null) nonce = values[idx++] as bigint;
			if (gasPriceOp != null)
				[maxFeePerGas, maxPriorityFeePerGas] = values[idx++] as [bigint, bigint];
			if (delegationCheckOp != null) {
				const delegatedTo = values[idx++] as string | null;
				if (
					delegatedTo != null &&
					delegatedTo.toLowerCase() === (eip7702AuthAddress as string).toLowerCase()
				) {
					skipEip7702Auth = true;
				}
			}
		} else if (overrides.eip7702Auth != null) {
			// eip7702AuthNonce was provided, but still need delegation check + other ops
			const ops: Promise<unknown>[] = [];
			if (nonceOp != null) ops.push(nonceOp);
			if (gasPriceOp != null) ops.push(gasPriceOp);
			if (delegationCheckOp != null) ops.push(delegationCheckOp);

			if (ops.length > 0) {
				const values = await Promise.all(ops);
				let idx = 0;
				if (nonceOp != null) nonce = values[idx++] as bigint;
				if (gasPriceOp != null)
					[maxFeePerGas, maxPriorityFeePerGas] = values[idx++] as [bigint, bigint];
				if (delegationCheckOp != null) {
					const delegatedTo = values[idx++] as string | null;
					if (
						delegatedTo != null &&
						delegatedTo.toLowerCase() === (eip7702AuthAddress as string).toLowerCase()
					) {
						skipEip7702Auth = true;
					}
				}
			}
		} else {
			//don't check for eip7702AuthNonce
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
		maxFeePerGas =
			overrides.maxFeePerGas ??
			BigInt(
				Math.floor(
					Number(maxFeePerGas) * (((overrides.maxFeePerGasPercentageMultiplier ?? 0) + 100) / 100),
				),
			);
		maxPriorityFeePerGas =
			overrides.maxPriorityFeePerGas ??
			BigInt(
				Math.floor(
					Number(maxPriorityFeePerGas) *
						(((overrides.maxPriorityFeePerGasPercentageMultiplier ?? 0) + 100) / 100),
				),
			);
		if (nonce == null) {
			throw new RangeError("failed to determine nonce");
		} else if (nonce < 0n) {
			throw new RangeError("nonce can't be negative");
		}

		let callData = "0x" as string;
		if (overrides.callData == null) {
			if (transactions.length === 1) {
				callData = BaseSimple7702Account.createAccountCallDataSingleTransaction(transactions[0]);
			} else {
				callData = BaseSimple7702Account.createAccountCallDataBatchTransactions(transactions);
			}
		} else {
			callData = overrides.callData;
		}

		let userOperation: UserOperationV8 | UserOperationV9;
		if (overrides.eip7702Auth != null && !skipEip7702Auth) {
			const yParity = overrides.eip7702Auth.yParity ?? "0x0";
			if (yParity !== "0x0" && yParity !== "0x00" && yParity !== "0x1" && yParity !== "0x01") {
				throw new AbstractionKitError(
					"BAD_DATA",
					"invalide yParity value for eoaDelegatorSignature. " + "must be '0x0' or '0x1'",
				);
			}

			const authorization: Authorization7702Hex = {
				chainId: bigintToHex(eip7702AuthChainId as bigint),
				address: eip7702AuthAddress as string,
				nonce: bigintToHex(eip7702AuthNonce as bigint),
				yParity: yParity,
				r:
					overrides.eip7702Auth.r ??
					"0x4277ba564d2c138823415df0ec8e8f97f30825056d54ec5128a8b29ec2dd81b2",
				s:
					overrides.eip7702Auth.s ??
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
				paymaster: null,
				paymasterVerificationGasLimit: null,
				paymasterPostOpGasLimit: null,
				paymasterData: null,
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
				paymaster: null,
				paymasterVerificationGasLimit: null,
				paymasterPostOpGasLimit: null,
				paymasterData: null,
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
			const parallelPaymasterInitValues = overrides.parallelPaymasterInitValues;
			if (parallelPaymasterInitValues != null) {
				if (this.entrypointAddress !== ENTRYPOINT_V9) {
					throw new RangeError("parallelPaymasterInitValues only works with ep v0.9");
				}
				userOperation.paymaster = parallelPaymasterInitValues.paymaster;
				userOperation.paymasterVerificationGasLimit =
					parallelPaymasterInitValues.paymasterVerificationGasLimit;
				userOperation.paymasterPostOpGasLimit = parallelPaymasterInitValues.paymasterPostOpGasLimit;
				userOperation.paymasterData = parallelPaymasterInitValues.paymasterData;
			}

			if (bundlerRpc != null) {
				userOperation.callGasLimit = 0n;
				userOperation.verificationGasLimit = 0n;
				userOperation.preVerificationGas = 0n;
				const inputMaxFeePerGas = userOperation.maxFeePerGas;
				const inputMaxPriorityFeePerGas = userOperation.maxPriorityFeePerGas;
				userOperation.maxFeePerGas = 0n;
				userOperation.maxPriorityFeePerGas = 0n;

				const userOperationToEstimate = { ...userOperation };

				userOperation.signature = overrides.dummySignature ?? BaseSimple7702Account.dummySignature;
				[preVerificationGas, verificationGasLimit, callGasLimit] =
					await this.baseEstimateUserOperationGas(userOperationToEstimate, bundlerRpc, {
						stateOverrideSet: overrides.state_override_set,
					});
				verificationGasLimit += 55_000n;

				userOperation.maxFeePerGas = inputMaxFeePerGas;
				userOperation.maxPriorityFeePerGas = inputMaxPriorityFeePerGas;
			} else {
				throw new AbstractionKitError(
					"BAD_DATA",
					"bundlerRpc cant't be null if preVerificationGas," +
						"verificationGasLimit and callGasLimit are not overriden",
				);
			}
		}
		if (typeof overrides.preVerificationGas === "bigint" && overrides.preVerificationGas < 0n) {
			throw new RangeError("preVerificationGas override can't be negative");
		}

		if (typeof overrides.verificationGasLimit === "bigint" && overrides.verificationGasLimit < 0n) {
			throw new RangeError("verificationGasLimit override can't be negative");
		}

		if (typeof overrides.callGasLimit === "bigint" && overrides.callGasLimit < 0n) {
			throw new RangeError("callGasLimit override can't be negative");
		}

		userOperation.preVerificationGas =
			overrides.preVerificationGas ??
			BigInt(
				Math.floor(
					Number(preVerificationGas) *
						(((overrides.preVerificationGasPercentageMultiplier ?? 0) + 100) / 100),
				),
			);

		userOperation.verificationGasLimit =
			overrides.verificationGasLimit ??
			BigInt(
				Math.floor(
					Number(verificationGasLimit) *
						(((overrides.verificationGasLimitPercentageMultiplier ?? 0) + 100) / 100),
				),
			);

		userOperation.callGasLimit =
			overrides.callGasLimit ??
			BigInt(
				Math.floor(
					Number(callGasLimit) * (((overrides.callGasLimitPercentageMultiplier ?? 0) + 100) / 100),
				),
			);

		return userOperation;
	}

	/**
	 * Estimate gas limits for a UserOperation via the bundler.
	 * @param userOperation - The UserOperation to estimate gas for
	 * @param bundlerRpc - Bundler RPC endpoint for gas estimation
	 * @param overrides - Optional overrides
	 * @param overrides.stateOverrideSet - State overrides to apply during estimation
	 * @param overrides.dummySignature - Custom dummy ECDSA signature for estimation
	 * @returns A promise resolving to `[preVerificationGas, verificationGasLimit, callGasLimit]`
	 */
	protected async baseEstimateUserOperationGas(
		userOperation: UserOperationV8 | UserOperationV9,
		bundlerRpc: string,
		overrides: {
			stateOverrideSet?: StateOverrideSet;
			dummySignature?: string;
		} = {},
	): Promise<[bigint, bigint, bigint]> {
		userOperation.signature = overrides.dummySignature ?? BaseSimple7702Account.dummySignature;

		const bundler = new Bundler(bundlerRpc);

		const inputMaxFeePerGas = userOperation.maxFeePerGas;
		const inputMaxPriorityFeePerGas = userOperation.maxPriorityFeePerGas;
		userOperation.maxFeePerGas = 0n;
		userOperation.maxPriorityFeePerGas = 0n;
		const estimation = await bundler.estimateUserOperationGas(
			userOperation,
			this.entrypointAddress,
			overrides.stateOverrideSet,
		);
		userOperation.maxFeePerGas = inputMaxFeePerGas;
		userOperation.maxPriorityFeePerGas = inputMaxPriorityFeePerGas;

		const preVerificationGas = BigInt(estimation.preVerificationGas);

		const verificationGasLimit = BigInt(estimation.verificationGasLimit);

		const callGasLimit = BigInt(estimation.callGasLimit);

		return [preVerificationGas, verificationGasLimit, callGasLimit];
	}

	/**
	 * Sign a UserOperation with an EOA private key.
	 * Computes the UserOperation hash and produces an ECDSA signature.
	 * @param useroperation - The UserOperation to sign
	 * @param privateKey - Hex-encoded private key of the EOA signer
	 * @param chainId - Target chain ID
	 * @returns Hex-encoded ECDSA signature
	 */
	protected baseSignUserOperation(
		useroperation: UserOperationV8 | UserOperationV9,
		privateKey: string,
		chainId: bigint,
	): string {
		const userOperationHash = createUserOperationHash(
			useroperation,
			this.entrypointAddress,
			chainId,
		);

		const wallet = new Wallet(privateKey);
		return wallet.signingKey.sign(userOperationHash).serialized;
	}

	/**
	 * Schemes Simple7702 accepts from a Signer. Only raw-hash ECDSA, since
	 * the delegatee verifies a plain signature over the userOp hash.
	 */
	public static readonly ACCEPTED_SIGNING_SCHEMES: readonly SigningScheme[] = ["hash"];

	/**
	 * Sign a UserOperation with an {@link AkSigner}. Signer must implement
	 * `signHash`, since Simple7702 only verifies raw ECDSA over the userOp
	 * hash. JSON-RPC wallets and anything that only provides `signTypedData`
	 * fail offline with a specific error.
	 */
	protected async baseSignUserOperationWithSigner<T extends UserOperationV8 | UserOperationV9>(
		useroperation: T,
		signer: AkSigner,
		chainId: bigint,
	): Promise<string> {
		const scheme = pickScheme(signer, BaseSimple7702Account.ACCEPTED_SIGNING_SCHEMES, {
			accountName: "Simple7702 (raw ECDSA over userOpHash)",
			signerIndex: 0,
		});
		const hash = createUserOperationHash(
			useroperation,
			this.entrypointAddress,
			chainId,
		) as `0x${string}`;
		const context: SignContext<T> = {
			userOperation: useroperation,
			chainId,
			entryPoint: this.entrypointAddress,
		};
		return invokeSigner(signer, scheme, { hash, context });
	}

	/**
	 * Submit a signed UserOperation to a bundler for on-chain inclusion.
	 * @param userOperation - The signed UserOperation to submit
	 * @param bundlerRpc - Bundler RPC endpoint
	 * @returns A {@link SendUseroperationResponse} that can be used to wait for inclusion
	 */
	protected async baseSendUserOperation(
		userOperation: UserOperationV8 | UserOperationV9,
		bundlerRpc: string,
	): Promise<SendUseroperationResponse> {
		const bundler = new Bundler(bundlerRpc);
		const sendUserOperationRes = await bundler.sendUserOperation(
			userOperation,
			this.entrypointAddress,
		);

		return new SendUseroperationResponse(sendUserOperationRes, bundler, this.entrypointAddress);
	}

	/**
	 * Prepend a token `approve` call to existing calldata for a token paymaster.
	 * Instance wrapper for {@link BaseSimple7702Account.prependTokenPaymasterApproveToCallDataStatic}.
	 * @param callData - Existing encoded calldata (execute or executeBatch)
	 * @param tokenAddress - ERC-20 token contract to approve
	 * @param paymasterAddress - Paymaster address to approve as spender
	 * @param approveAmount - Token amount to approve
	 * @returns Re-encoded calldata with the approve transaction prepended as a batch
	 */
	public prependTokenPaymasterApproveToCallData(
		callData: string,
		tokenAddress: string,
		paymasterAddress: string,
		approveAmount: bigint,
	): string {
		return BaseSimple7702Account.prependTokenPaymasterApproveToCallDataStatic(
			callData,
			tokenAddress,
			paymasterAddress,
			approveAmount,
		);
	}

	/**
	 * Prepend a token `approve` call to existing calldata for a token paymaster.
	 * Decodes the existing calldata, prepends an ERC-20 approve transaction,
	 * and re-encodes as a batch via `executeBatch`.
	 * @param callData - Existing encoded calldata (execute or executeBatch)
	 * @param tokenAddress - ERC-20 token contract to approve
	 * @param paymasterAddress - Paymaster address to approve as spender
	 * @param approveAmount - Token amount to approve
	 * @returns Re-encoded calldata with the approve transaction prepended as a batch
	 */
	public static prependTokenPaymasterApproveToCallDataStatic(
		callData: string,
		tokenAddress: string,
		paymasterAddress: string,
		approveAmount: bigint,
	): string {
		const approveFunctionSignature = "approve(address,uint256)";
		const approveFunctionSelector = getFunctionSelector(approveFunctionSignature);
		const approveCallData = createCallData(
			approveFunctionSelector,
			["address", "uint256"],
			[paymasterAddress, approveAmount],
		);
		const approveMetatransaction: SimpleMetaTransaction = {
			to: tokenAddress,
			value: 0n,
			data: approveCallData,
		};

		const abiCoder = AbiCoder.defaultAbiCoder();
		let decodedMetaTransactions: SimpleMetaTransaction[];
		if (callData.startsWith(BaseSimple7702Account.batchExecutorFunctionSelector)) {
			const decodedParamsArray = abiCoder.decode(
				BaseSimple7702Account.batchExecutorFunctionInputAbi,
				`0x${callData.slice(10)}`,
			)[0] as [];
			decodedMetaTransactions = decodedParamsArray.map((decodedParams) => ({
				to: decodedParams[0] as string,
				value: BigInt(decodedParams[1] as string),
				data:
					typeof decodedParams[2] !== "string"
						? new TextDecoder().decode(decodedParams[2])
						: decodedParams[2],
			}));
		} else if (callData.startsWith(BaseSimple7702Account.executorFunctionSelector)) {
			const decodedParams = abiCoder.decode(
				BaseSimple7702Account.executorFunctionInputAbi,
				`0x${callData.slice(10)}`,
			);
			decodedMetaTransactions = [
				{
					to: decodedParams[0] as string,
					value: BigInt(decodedParams[1] as string),
					data:
						typeof decodedParams[2] !== "string"
							? new TextDecoder().decode(decodedParams[2])
							: decodedParams[2],
				},
			];
		} else {
			throw new AbstractionKitError(
				"BAD_DATA",
				"Invalid calldata, should start with " +
					BaseSimple7702Account.batchExecutorFunctionSelector +
					" or " +
					BaseSimple7702Account.executorFunctionSelector,
				{
					context: {
						callData: callData,
					},
				},
			);
		}
		decodedMetaTransactions.unshift(approveMetatransaction);
		return BaseSimple7702Account.createAccountCallDataBatchTransactions(decodedMetaTransactions);
	}
}

/**
 * EIP-7702 simple smart account targeting EntryPoint v0.8
 * (`0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108`).
 * Wraps {@link BaseSimple7702Account} with concrete types for
 * {@link UserOperationV8} and sensible defaults for the delegatee address.
 */
export class Simple7702Account extends BaseSimple7702Account {
	static readonly DEFAULT_DELEGATEE_ADDRESS = "0xe6Cae83BdE06E4c305530e199D7217f42808555B";

	/**
	 * @param accountAddress - The EOA address that will be delegated via EIP-7702
	 * @param overrides - Optional overrides for entrypoint and delegatee addresses
	 * @param overrides.entrypointAddress - Custom EntryPoint address (defaults to EntryPoint v0.8)
	 * @param overrides.delegateeAddress - Custom delegatee contract address
	 */
	constructor(
		accountAddress: string,
		overrides: {
			entrypointAddress?: string;
			delegateeAddress?: string;
		} = {},
	) {
		super(
			accountAddress,
			overrides.entrypointAddress ?? ENTRYPOINT_V8,
			overrides.delegateeAddress ?? Simple7702Account.DEFAULT_DELEGATEE_ADDRESS,
		);
	}

	/**
	 * Create a {@link UserOperationV8} for EntryPoint v0.8.
	 * Determines nonce, fetches gas prices, estimates gas limits, and returns
	 * an unsigned UserOperation. All auto-determined values can be overridden.
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
		overrides: CreateUserOperationOverrides = {},
	): Promise<UserOperationV8> {
		return this.baseCreateUserOperation(transactions, providerRpc, bundlerRpc, overrides);
	}

	/**
	 * Estimate gas limits for a {@link UserOperationV8}.
	 * @param userOperation - The UserOperation to estimate gas for
	 * @param bundlerRpc - Bundler RPC endpoint for gas estimation
	 * @param overrides - Optional overrides
	 * @param overrides.stateOverrideSet - State overrides to apply during estimation
	 * @param overrides.dummySignature - Custom dummy signature for estimation
	 * @returns A promise resolving to `[preVerificationGas, verificationGasLimit, callGasLimit]`
	 */
	public async estimateUserOperationGas(
		userOperation: UserOperationV8,
		bundlerRpc: string,
		overrides: {
			stateOverrideSet?: StateOverrideSet;
			dummySignature?: string;
		} = {},
	): Promise<[bigint, bigint, bigint]> {
		return this.baseEstimateUserOperationGas(userOperation, bundlerRpc, overrides);
	}

	/**
	 * Sign a {@link UserOperationV8} with an EOA private key.
	 * Computes the UserOperation hash and produces an ECDSA signature.
	 * @param useroperation - The UserOperation to sign
	 * @param privateKey - Hex-encoded private key of the EOA signer
	 * @param chainId - Target chain ID
	 * @returns Hex-encoded ECDSA signature
	 */
	public signUserOperation(
		useroperation: UserOperationV8,
		privateKey: string,
		chainId: bigint,
	): string {
		return this.baseSignUserOperation(useroperation, privateKey, chainId);
	}

	/**
	 * Sign a {@link UserOperationV8} using an {@link ExternalSigner}.
	 * Simple7702 only accepts raw-hash ECDSA; signers without `signHash`
	 * fail offline with an actionable error.
	 *
	 * For signing with a raw private-key string, use the sync
	 * {@link signUserOperation} method, or wrap explicitly with
	 * `fromPrivateKey(pk)`.
	 */
	public async signUserOperationWithSigner(
		useroperation: UserOperationV8,
		signer: AkSigner,
		chainId: bigint,
	): Promise<string> {
		return this.baseSignUserOperationWithSigner(useroperation, signer, chainId);
	}

	/**
	 * Send a signed {@link UserOperationV8} to a bundler for on-chain inclusion.
	 * @param userOperation - The signed UserOperation to submit
	 * @param bundlerRpc - Bundler RPC endpoint
	 * @returns A {@link SendUseroperationResponse} that can be used to wait for inclusion
	 */
	public async sendUserOperation(
		userOperation: UserOperationV8,
		bundlerRpc: string,
	): Promise<SendUseroperationResponse> {
		return this.baseSendUserOperation(userOperation, bundlerRpc);
	}
}
