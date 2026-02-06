import {
	AbiCoder,
	keccak256,
	solidityPacked,
	solidityPackedKeccak256,
	Wallet,
	TypedDataEncoder,
} from "ethers";
import { SmartAccount } from "../SmartAccount";
import {
	MetaTransaction,
	Operation,
	StateOverrideSet,
	UserOperation,
} from "../../types";
import {
	fetchAccountNonce,
	createCallData,
	fetchGasPrice,
	getFunctionSelector,
} from "../../utils";
import { UserOperationDummyValues, ZeroAddress } from "../../constants";
import { SafeAccountFactory } from "../../factory/SafeAccountFactory";
import {
	CreateUserOperationOverrides,
	InitCodeOverrides,
	SafeModuleExecutorFunctionSelector,
	SafeUserOperationTypedDataDomain,
	SafeUserOperationTypedDataValues,
} from "./types";
import { decodeMultiSendCallData, encodeMultiSendCallData } from "./multisend";
import { Bundler } from "src/Bundler";
import { SendUseroperationResponse } from "../SendUseroperationResponse";
import { AbstractionKitError } from "src/errors";

/**
 * Safe smart account implementation for EntryPoint v0.6.
 * Provides methods to create, sign, and send ERC-4337 UserOperations
 * using Safe's modular smart account architecture.
 *
 * @example
 * // Create a new account (not yet deployed on-chain)
 * const smartAccount = SafeAccountV0_2_0.initializeNewAccount([ownerAddress]);
 *
 * // Or connect to an existing deployed account
 * const smartAccount = new SafeAccountV0_2_0(existingAccountAddress);
 */
export class SafeAccountV0_2_0 extends SmartAccount {
	static readonly DEFAULT_ENTRYPOINT_ADDRESS =
		"0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";
	static readonly DEFAULT_SAFE_4337_MODULE_ADDRESS =
		"0xa581c4A4DB7175302464fF3C06380BC3270b4037";
	static readonly DEFAULT_SINGLETON_ADDRESS =
		"0x29fcB43b46531BcA003ddC8FCB67FFE91900C762";
	static readonly DEFAULT_ADD_MODULE_LIB_ADDRESS =
		"0x8EcD4ec46D4D2a6B64fE960B3D64e8B94B2234eb";
	static readonly DEFAULT_MULTISEND_CONTRACT_ADDRESS =
		"0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526";

	static readonly proxyByteCode: string =
		"0x608060405234801561001057600080fd5b506040516101e63803806101e68339818101604052602081101561003357600080fd5b8101908080519060200190929190505050600073ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff1614156100ca576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004018080602001828103825260228152602001806101c46022913960400191505060405180910390fd5b806000806101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff1602179055505060ab806101196000396000f3fe608060405273ffffffffffffffffffffffffffffffffffffffff600054167fa619486e0000000000000000000000000000000000000000000000000000000060003514156050578060005260206000f35b3660008037600080366000845af43d6000803e60008114156070573d6000fd5b3d6000f3fea264697066735822122003d1488ee65e08fa41e58e888a9865554c535f2c77126a82cb4c0f917f31441364736f6c63430007060033496e76616c69642073696e676c65746f6e20616464726573732070726f7669646564";
	static readonly initializerFunctionSelector: string = "0xb63e800d";
	static readonly initializerFunctionInputAbi: string[] = [
		"address[]",
		"uint256",
		"address",
		"bytes",
		"address",
		"address",
		"uint256",
		"address",
	];

	static readonly DEFAULT_EXECUTOR_FUCNTION_SELECTOR =
		SafeModuleExecutorFunctionSelector.executeUserOpWithErrorString;
	static readonly executorFunctionInputAbi: string[] = [
		"address", //to
		"uint256", //value
		"bytes", //data
		"uint8", //operation
	];

	static readonly EIP712_SAFE_OPERATION_TYPE = {
		SafeOp: [
			{ type: "address", name: "safe" },
			{ type: "uint256", name: "nonce" },
			{ type: "bytes", name: "initCode" },
			{ type: "bytes", name: "callData" },
			{ type: "uint256", name: "callGasLimit" },
			{ type: "uint256", name: "verificationGasLimit" },
			{ type: "uint256", name: "preVerificationGas" },
			{ type: "uint256", name: "maxFeePerGas" },
			{ type: "uint256", name: "maxPriorityFeePerGas" },
			{ type: "bytes", name: "paymasterAndData" },
			{ type: "uint48", name: "validAfter" },
			{ type: "uint48", name: "validUntil" },
			{ type: "address", name: "entryPoint" },
		],
	};

	/** The EntryPoint contract address this account targets */
	readonly entrypointAddress: string;
	/** The Safe 4337 module address used for signature verification */
	readonly safe4337ModuleAddress: string;
	private initCode: string | null;

	/**
	 * Create a SafeAccountV0_2_0 instance for an existing deployed account.
	 * For new (undeployed) accounts, use the static `initializeNewAccount` method instead.
	 *
	 * @param accountAddress - The on-chain address of the Safe account
	 * @param safe4337ModuleAddress - The Safe 4337 module address (defaults to the canonical address)
	 * @param entrypointAddress - The EntryPoint v0.6 contract address (defaults to the canonical address)
	 *
	 * @example
	 * const account = new SafeAccountV0_2_0("0xYourSafeAddress");
	 */
	constructor(
		accountAddress: string,
		safe4337ModuleAddress: string = SafeAccountV0_2_0.DEFAULT_SAFE_4337_MODULE_ADDRESS,
		entrypointAddress: string = SafeAccountV0_2_0.DEFAULT_ENTRYPOINT_ADDRESS,
	) {
		super(accountAddress);
		this.entrypointAddress = entrypointAddress;
		this.safe4337ModuleAddress = safe4337ModuleAddress;
		this.initCode = null;
	}
	/**
	 * Create and initialize a new SafeAccountV0_2_0 from its initial owner addresses.
	 * The account address is deterministically computed but the account is not yet deployed on-chain.
	 * The first UserOperation sent from this account will deploy it automatically via initCode.
	 *
	 * @param owners - Array of owner addresses (at least one required)
	 * @param overrides - Override default initialization values (threshold, factory address, etc.)
	 * @returns A SafeAccountV0_2_0 instance with initCode set for deployment
	 *
	 * @example
	 * const smartAccount = SafeAccountV0_2_0.initializeNewAccount(["0xOwnerAddress"]);
	 * console.log("Account address:", smartAccount.accountAddress);
	 */
	public static initializeNewAccount(
		owners: string[],
		overrides: InitCodeOverrides = {},
	): SafeAccountV0_2_0 {
		const [accountAddress, initCode] =
			SafeAccountV0_2_0.createAccountAddressAndInitCode(owners, overrides);
		const safe = new SafeAccountV0_2_0(accountAddress);
		safe.initCode = initCode;
		return safe;
	}

	/**
	 * Calculate the counterfactual account address from the initial owner addresses.
	 * Does not deploy the account; use `initializeNewAccount` to get a deployable instance.
	 *
	 * @param owners - Array of owner addresses (at least one required)
	 * @param overrides - Override default initialization values (threshold, factory address, etc.)
	 * @returns The deterministic account address
	 *
	 * @example
	 * const address = SafeAccountV0_2_0.createAccountAddress(["0xOwnerAddress"]);
	 */
	public static createAccountAddress(
		owners: string[],
		overrides: InitCodeOverrides = {},
	): string {
		const [address, ] = SafeAccountV0_2_0.createAccountAddressAndInitCode(
			owners,
			overrides,
		);
		return address;
	}

	/**
	 * Calculate both the counterfactual account address and the initCode from owner addresses.
	 * The initCode is the factory address + calldata needed to deploy the account on first use.
	 *
	 * @param owners - Array of owner addresses (at least one required)
	 * @param overrides - Override default initialization values (threshold, factory address, etc.)
	 * @returns A tuple of [accountAddress, initCode]
	 * @throws RangeError if owners array is empty
	 */
	public static createAccountAddressAndInitCode(
		owners: string[],
		overrides: InitCodeOverrides = {},
	): [string, string] {
		if (owners.length < 1) {
			throw RangeError("There should be at least one owner");
		}

		const threshold = overrides.threshold ?? 1;
		const c2Nonce = (overrides.c2Nonce as bigint) ?? 0n;
		const singletonAddress =
			overrides.singletonAddress ?? SafeAccountV0_2_0.DEFAULT_SINGLETON_ADDRESS;
		const safe4337ModuleAddress =
			overrides.safe4337ModuleAddress ??
			SafeAccountV0_2_0.DEFAULT_SAFE_4337_MODULE_ADDRESS;
		const addModuleLibAddress =
			overrides.addModuleLibAddress ??
			SafeAccountV0_2_0.DEFAULT_ADD_MODULE_LIB_ADDRESS;

		let safeAccountFactory: SafeAccountFactory = new SafeAccountFactory();
		if (overrides.safeAccountFactoryAddress != null) {
			safeAccountFactory = new SafeAccountFactory(
				overrides.safeAccountFactoryAddress,
			);
		}

		const initializerCallData = SafeAccountV0_2_0.createInitializerCallData(
			owners,
			threshold,
			safe4337ModuleAddress,
			addModuleLibAddress,
		);

		const sender = this.createProxyAddress(
			initializerCallData,
			c2Nonce,
			safeAccountFactory.address,
			singletonAddress,
		);

		const generatorFunctionInputParameters = [
			singletonAddress,
			initializerCallData,
			c2Nonce,
		];

		const initCode = safeAccountFactory.getFactoryGeneratorFunctionCallData(
			generatorFunctionInputParameters,
		);

		return [sender, initCode];
	}

	private static createInitializerCallData(
		owners: string[],
		threshold: number,
		safe4337ModuleAddress: string = SafeAccountV0_2_0.DEFAULT_SAFE_4337_MODULE_ADDRESS,
		addModuleLibAddress: string = SafeAccountV0_2_0.DEFAULT_ADD_MODULE_LIB_ADDRESS,
	): string {
		if (owners.length < 1) {
			throw RangeError("There should be at least one owner");
		}

		if (threshold < 1) {
			throw RangeError("threshold should be at least one");
		}

		if (threshold > owners.length) {
			throw RangeError("threshold can't be larger than number of owners");
		}

		const enable4337ModuleCallData = createCallData(
			"0x8d0dc49f", //enableModules
			["address[]"],
			[[safe4337ModuleAddress]],
		);

		const initializerFunctionInputParameters = [
			owners, //_owners
			threshold, //_threshold
			addModuleLibAddress, //to Contract address for optional delegate call during initialization
			enable4337ModuleCallData, //Data payload for optional delegate call during initialization
			safe4337ModuleAddress, //fallbackHandler Handler for fallback calls to this contract
			ZeroAddress, //paymentToken (Safe specific, can be ignored)
			0, //payment (Safe specific, can be ignored)
			ZeroAddress, //paymentReceiver (Safe specific, can be ignored)
		];

		return createCallData(
			SafeAccountV0_2_0.initializerFunctionSelector,
			SafeAccountV0_2_0.initializerFunctionInputAbi,
			initializerFunctionInputParameters,
		);
	}

	/**
	 * Create the initCode for deploying a new Safe account via the factory.
	 *
	 * @param owners - Array of owner addresses (at least one required)
	 * @param threshold - Number of owner signatures required (default: 1)
	 * @param c2Nonce - CREATE2 salt nonce for generating different addresses from the same owners (default: 0n)
	 * @param singletonAddress - Safe singleton contract address
	 * @param safeAccountFactory - SafeAccountFactory instance
	 * @param safe4337ModuleAddress - Safe 4337 module address
	 * @param addModuleLibAddress - AddModuleLib address
	 * @returns The initCode string (factory address + encoded calldata)
	 * @throws RangeError if owners is empty, threshold < 1, threshold > owners.length, or c2Nonce < 0
	 */
	public static createInitCode(
		owners: string[],
		threshold: number = 1,
		c2Nonce: bigint = 0n,
		singletonAddress: string = SafeAccountV0_2_0.DEFAULT_SINGLETON_ADDRESS,
		safeAccountFactory: SafeAccountFactory = new SafeAccountFactory(),
		safe4337ModuleAddress: string = SafeAccountV0_2_0.DEFAULT_SAFE_4337_MODULE_ADDRESS,
		addModuleLibAddress: string = SafeAccountV0_2_0.DEFAULT_ADD_MODULE_LIB_ADDRESS,
	): string {
		if (owners.length < 1) {
			throw RangeError("There should be at least one owner");
		}

		if (threshold < 1) {
			throw RangeError("threshold should be at least one");
		}

		if (threshold > owners.length) {
			throw RangeError("threshold can't be larger than number of owners");
		}

		if (c2Nonce < 0n) {
			throw RangeError("c2Nonce can't be negative");
		}

		const initializerCallData = SafeAccountV0_2_0.createInitializerCallData(
			owners,
			threshold,
			safe4337ModuleAddress,
			addModuleLibAddress,
		);

		const generatorFunctionInputParameters = [
			singletonAddress,
			initializerCallData,
			c2Nonce,
		];

		const factoryGeneratorFunctionCallData =
			safeAccountFactory.getFactoryGeneratorFunctionCallData(
				generatorFunctionInputParameters,
			);

		return factoryGeneratorFunctionCallData;
	}

	/**
	 * Compute the deterministic proxy (account) address from the initializer calldata,
	 * CREATE2 nonce, factory address, and singleton address.
	 *
	 * @param initializerCallData - ABI-encoded initializer calldata
	 * @param c2Nonce - CREATE2 salt nonce
	 * @param safeFactoryAddress - Safe proxy factory address
	 * @param singletonAddress - Safe singleton contract address
	 * @returns The deterministic proxy address
	 * @throws RangeError if c2Nonce is negative
	 */
	public static createProxyAddress(
		initializerCallData: string,
		c2Nonce: bigint,
		safeFactoryAddress: string,
		singletonAddress: string,
	): string {
		if (c2Nonce < 0n) {
			throw RangeError("c2Nonce can't be negative");
		}

		const abiCoder = AbiCoder.defaultAbiCoder();
		const salt = keccak256(
			solidityPacked(
				["bytes32", "uint256"],
				[keccak256(initializerCallData), c2Nonce],
			),
		);
		const initData = abiCoder.encode(["uint256"], [singletonAddress]);

		const initHash = keccak256(
			solidityPacked(["bytes", "bytes"], [this.proxyByteCode, initData]),
		);

		const proxyAdd = solidityPackedKeccak256(
			["bytes1", "address", "bytes32", "bytes32"],
			["0xff", safeFactoryAddress, salt, initHash],
		).slice(-40);
		return "0x" + proxyAdd;
	}

	/**
	 * Encode calldata for a single MetaTransaction to be executed by the Safe account.
	 *
	 * @param metaTransaction - The transaction to encode
	 * @returns ABI-encoded calldata for the Safe executor function
	 */
	public static createAccountCallDataSingleTransaction(
		metaTransaction: MetaTransaction,
	): string {
		const value = metaTransaction.value ?? 0;
		const data = metaTransaction.data ?? "0x";
		const operation = metaTransaction.operation ?? Operation.Call;
		const executorFunctionCallData = SafeAccountV0_2_0.createAccountCallData(
			metaTransaction.to,
			value,
			data,
			operation,
		);
		return executorFunctionCallData;
	}

	/**
	 * Encode calldata for a batch of MetaTransactions using the MultiSend contract.
	 *
	 * @param metaTransactions - Array of transactions to batch (at least one required)
	 * @param multisendContractAddress - MultiSend contract address (defaults to canonical address)
	 * @returns ABI-encoded calldata that delegatecalls MultiSend
	 * @throws RangeError if metaTransactions array is empty
	 */
	public static createAccountCallDataBatchTransactions(
		metaTransactions: MetaTransaction[],
		multisendContractAddress: string = SafeAccountV0_2_0.DEFAULT_MULTISEND_CONTRACT_ADDRESS,
	): string {
		if (metaTransactions.length < 1) {
			throw RangeError("There should be at least one metaTransaction");
		}

		const multiData = encodeMultiSendCallData(metaTransactions);

		const mutisendSelector = "0x8d80ff0a";
		const multiSendCallData = createCallData(
			mutisendSelector,
			["bytes"],
			[multiData],
		);

		const executorFunctionCallData = SafeAccountV0_2_0.createAccountCallData(
			multisendContractAddress,
			0n,
			multiSendCallData,
			Operation.Delegate,
		);

		return executorFunctionCallData;
	}

	/**
	 * Encode calldata for the Safe executor function (executeUserOpWithErrorString or executeUserOp).
	 *
	 * @param to - Target address
	 * @param value - Native token value in wei
	 * @param data - ABI-encoded calldata for the target
	 * @param operation - Call (0) or Delegate (1)
	 * @param safeModuleExecutorFunctionSelector - Executor function selector (defaults to executeUserOpWithErrorString)
	 * @returns ABI-encoded calldata for the executor function
	 */
	public static createAccountCallData(
		to: string,
		value: bigint,
		data: string,
		operation: Operation,
		safeModuleExecutorFunctionSelector: SafeModuleExecutorFunctionSelector = SafeAccountV0_2_0.DEFAULT_EXECUTOR_FUCNTION_SELECTOR,
	): string {
		const executorFunctionInputParameters = [to, value, data, operation];
		const callData = createCallData(
			safeModuleExecutorFunctionSelector,
			SafeAccountV0_2_0.executorFunctionInputAbi,
			executorFunctionInputParameters,
		);
		return callData;
	}

	/**
	 * Decode Safe executor calldata back into its components.
	 *
	 * @param callData - The ABI-encoded executor calldata to decode
	 * @returns A tuple of [to, value, data, operation]
	 * @throws AbstractionKitError with code "BAD_DATA" if calldata does not start with a valid executor selector
	 */
	public static decodeAccountCallData(
		callData: string,
	): [string, bigint, string, number] {
		if (
			callData.startsWith(
				SafeModuleExecutorFunctionSelector.executeUserOpWithErrorString,
			) ||
			callData.startsWith(SafeModuleExecutorFunctionSelector.executeUserOp)
		) {
			const abiCoder = AbiCoder.defaultAbiCoder();
			const params = "0x" + callData.slice(10);
			const decodedParams = abiCoder.decode(
				[
					"address", //to
					"uint256", //value
					"bytes", //data
					"uint8", //operation"
				],
				params,
			);
			return [
				decodedParams[0] as string,
				BigInt(decodedParams[1] as string),
				decodedParams[2] as string,
				Number(decodedParams[3]),
			];
		} else {
			throw new AbstractionKitError(
				"BAD_DATA",
				"Invalid calldata, should start with " +
					SafeModuleExecutorFunctionSelector.executeUserOpWithErrorString +
					" or " +
					SafeModuleExecutorFunctionSelector.executeUserOp,
				{
					context: {
						callData: callData,
					},
				},
			);
		}
	}

	/**
	 * Prepend a token approval call to existing calldata for use with a token paymaster.
	 * Instance method wrapper around the static `prependTokenPaymasterApproveToCallDataStatic`.
	 *
	 * @param callData - The existing executor calldata to prepend the approval to
	 * @param tokenAddress - The ERC-20 token contract address to approve
	 * @param paymasterAddress - The paymaster contract address to approve spending for
	 * @param approveAmount - The amount of tokens to approve
	 * @param multisendContractAddress - MultiSend contract address (defaults to canonical address)
	 * @returns New calldata with the token approval prepended via MultiSend
	 */
	public prependTokenPaymasterApproveToCallData(
		callData: string,
		tokenAddress: string,
		paymasterAddress: string,
		approveAmount: bigint,
		multisendContractAddress: string = SafeAccountV0_2_0.DEFAULT_MULTISEND_CONTRACT_ADDRESS,
	): string {
		return SafeAccountV0_2_0.prependTokenPaymasterApproveToCallDataStatic(
			callData,
			tokenAddress,
			paymasterAddress,
			approveAmount,
			multisendContractAddress,
		);
	}

	/**
	 * Prepend a token approval call to existing calldata for use with a token paymaster.
	 * If the existing calldata is already a MultiSend batch, the approval is added to the batch.
	 * If it's a single transaction, both are wrapped in a new MultiSend batch.
	 *
	 * @param callData - The existing executor calldata to prepend the approval to
	 * @param tokenAddress - The ERC-20 token contract address to approve
	 * @param paymasterAddress - The paymaster contract address to approve spending for
	 * @param approveAmount - The amount of tokens to approve
	 * @param multisendContractAddress - MultiSend contract address (defaults to canonical address)
	 * @returns New calldata with the token approval prepended via MultiSend
	 */
	public static prependTokenPaymasterApproveToCallDataStatic(
		callData: string,
		tokenAddress: string,
		paymasterAddress: string,
		approveAmount: bigint,
		multisendContractAddress: string = SafeAccountV0_2_0.DEFAULT_MULTISEND_CONTRACT_ADDRESS,
	): string {
		const [to, value, accountCallData, operation] =
			SafeAccountV0_2_0.decodeAccountCallData(callData);
		let accountCallDataString = "";
		if (typeof accountCallData !== "string") {
			accountCallDataString = new TextDecoder().decode(accountCallData);
		} else {
			accountCallDataString = accountCallData;
		}

		const approveFunctionSignature = "approve(address,uint256)";
		const approveFunctionSelector = getFunctionSelector(
			approveFunctionSignature,
		);
		const approveCallData = createCallData(
			approveFunctionSelector,
			["address", "uint256"],
			[paymasterAddress, approveAmount],
		);
		const approveMetatransaction: MetaTransaction = {
			to: tokenAddress,
			value: 0n,
			data: approveCallData,
			operation: Operation.Call,
		};
		const encodedApproveMetatransaction = encodeMultiSendCallData([
			approveMetatransaction,
		]);

		let multiSendCallDataParams = "";
		const mutisendSelector = "0x8d80ff0a";
		if (accountCallDataString.startsWith(mutisendSelector)) {
			//multisend
			const decodedCalldata = decodeMultiSendCallData(accountCallDataString);
			multiSendCallDataParams =
				decodedCalldata + encodedApproveMetatransaction.slice(2);
		} else {
			const callDataMetaTransaction: MetaTransaction = {
				to: to,
				value: value,
				data: accountCallData,
				operation: operation,
			};
			const encodedCallDataMetaTransaction = encodeMultiSendCallData([
				callDataMetaTransaction,
			]);
			multiSendCallDataParams =
				encodedCallDataMetaTransaction + encodedApproveMetatransaction.slice(2);
		}
		const multiSendCallData = createCallData(
			mutisendSelector,
			["bytes"],
			[multiSendCallDataParams],
		);

		const executorFunctionCallData = SafeAccountV0_2_0.createAccountCallData(
			multisendContractAddress,
			0n,
			multiSendCallData,
			Operation.Delegate,
		);

		return executorFunctionCallData;
	}

	/**
	 * Estimate gas limits for a UserOperation using the bundler.
	 * Adds a dummy signature for accurate estimation and accounts for per-signer overhead.
	 *
	 * @param userOperation - The UserOperation to estimate gas for
	 * @param bundlerRpc - Bundler RPC URL
	 * @param state_override_set - Optional state overrides for gas estimation
	 * @param numberOfSigners - Number of signers (affects dummy signature size and verification gas)
	 * @returns A tuple of [preVerificationGas, verificationGasLimit, callGasLimit]
	 * @throws RangeError if numberOfSigners < 1
	 */
	public async estimateUserOperationGas(
		userOperation: UserOperation,
		bundlerRpc: string,
		state_override_set?: StateOverrideSet,
		numberOfSigners: number = 1,
	): Promise<[bigint, bigint, bigint]> {
		if (numberOfSigners < 1n) {
			throw RangeError("numberOfSigners can't be less than 1");
		}

		let signatures = "";
		for (let i = 0; i < numberOfSigners; i++) {
			signatures =
				signatures +
				"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
		}
		userOperation.signature = "0xffffffffffffffffffffffff" + signatures;
		const bundler = new Bundler(bundlerRpc);

        const inputMaxFeePerGas = userOperation.maxFeePerGas
        const inputMaxPriorityFeePerGas = userOperation.maxPriorityFeePerGas
        userOperation.maxFeePerGas = 0n
        userOperation.maxPriorityFeePerGas = 0n

		const estimation = await bundler.estimateUserOperationGas(
			userOperation,
			this.entrypointAddress,
			state_override_set,
		);
        userOperation.maxFeePerGas = inputMaxFeePerGas
        userOperation.maxPriorityFeePerGas = inputMaxPriorityFeePerGas

		const preVerificationGas = BigInt(estimation.preVerificationGas);
		const verificationGasLimit =
			BigInt(estimation.verificationGasLimit) +
            (BigInt(numberOfSigners) * 30_000n);
		const callGasLimit = BigInt(estimation.callGasLimit);

		return [preVerificationGas, verificationGasLimit, callGasLimit];
	}

	/**
	 * Create a complete UserOperation ready for signing.
	 * Automatically determines the nonce, fetches gas prices, estimates gas limits,
	 * and encodes the transactions into calldata. All values can be overridden.
	 *
	 * @param transactions - Array of MetaTransactions to execute (at least one required)
	 * @param providerRpc - Ethereum JSON-RPC node URL (required unless nonce and gas prices are overridden)
	 * @param bundlerRpc - Bundler RPC URL (required unless all gas limits are overridden)
	 * @param overrides - Override any auto-determined values (nonce, gas limits, gas prices, calldata, etc.)
	 * @returns The unsigned UserOperation ready to be signed
	 * @throws RangeError if transactions is empty or overridden values are negative
	 * @throws AbstractionKitError with code "BAD_DATA" if required RPC URLs are null when needed
	 *
	 * @example
	 * const userOp = await smartAccount.createUserOperation(
	 *   [{ to: recipientAddress, value: 1000000000000000n, data: "0x" }],
	 *   nodeRpcUrl,
	 *   bundlerRpcUrl,
	 * );
	 */
	public async createUserOperation(
		transactions: MetaTransaction[],
		providerRpc?: string,
		bundlerRpc?: string,
		overrides: CreateUserOperationOverrides = {},
	): Promise<UserOperation> {
		if (transactions.length < 1) {
			throw RangeError("There should be at least one transaction");
		}

		let nonce = 0n as bigint;

		if (overrides.nonce == null) {
			if (providerRpc != null) {
				nonce = await fetchAccountNonce(
					providerRpc,
					this.entrypointAddress,
					this.accountAddress,
				);
			} else {
				throw new AbstractionKitError(
					"BAD_DATA",
					"providerRpc cant't be null if nonce is not overriden",
				);
			}
		} else {
			nonce = overrides.nonce;
		}

		let initCode = overrides.initCode ?? this.initCode;

		if (initCode == null || nonce > 0n) {
			initCode = "0x";
		}

		if (nonce < 0n) {
			throw RangeError("nonce can't be negative");
		}

		let callData = "0x" as string;
		if (overrides.callData == null) {
			if (transactions.length == 1) {
				callData = SafeAccountV0_2_0.createAccountCallDataSingleTransaction(
					transactions[0],
				);
			} else {
				callData =
					SafeAccountV0_2_0.createAccountCallDataBatchTransactions(
						transactions,
					);
			}
		} else {
			callData = overrides.callData;
		}

		let maxFeePerGas = UserOperationDummyValues.maxFeePerGas;
		let maxPriorityFeePerGas = UserOperationDummyValues.maxPriorityFeePerGas;
		if (
			overrides.maxFeePerGas == null ||
			overrides.maxPriorityFeePerGas == null
		) {
			if (providerRpc != null) {
				[maxFeePerGas, maxPriorityFeePerGas] = await fetchGasPrice(providerRpc);
                if(maxFeePerGas == 0n){
                    maxFeePerGas = 1n;
                }
                if(maxPriorityFeePerGas == 0n){
                    maxPriorityFeePerGas = 1n;
                }
			} else {
				throw new AbstractionKitError(
					"BAD_DATA",
					"providerRpc cant't be null if maxFeePerGas and maxPriorityFeePerGas are not overriden",
				);
			}
		}
		if (
			typeof overrides.maxFeePerGas === "bigint" &&
			overrides.maxFeePerGas < 0n
		) {
			throw RangeError("maxFeePerGas overrid can't be negative");
		}

		if (
			typeof overrides.maxPriorityFeePerGas === "bigint" &&
			overrides.maxPriorityFeePerGas < 0n
		) {
			throw RangeError("maxPriorityFeePerGas overrid can't be negative");
		}

		maxFeePerGas =
			overrides.maxFeePerGas ??
			maxFeePerGas *
				BigInt(
					Math.floor(
						((overrides.maxFeePerGasPercentageMultiplier ?? 0) + 100) / 100,
					),
				);
		maxPriorityFeePerGas =
			overrides.maxPriorityFeePerGas ??
			maxPriorityFeePerGas *
				BigInt(
					Math.floor(
						((overrides.maxPriorityFeePerGasPercentageMultiplier ?? 0) + 100) /
							100,
					),
				);

		const userOperation: UserOperation = {
			...UserOperationDummyValues,
			sender: this.accountAddress,
			nonce: nonce,
			initCode: initCode,
			callData: callData,
			maxFeePerGas: maxFeePerGas,
			maxPriorityFeePerGas: maxPriorityFeePerGas,
		};

		let preVerificationGas = UserOperationDummyValues.preVerificationGas;
		let verificationGasLimit = UserOperationDummyValues.verificationGasLimit;
		let callGasLimit = UserOperationDummyValues.callGasLimit;
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

				[preVerificationGas, verificationGasLimit, callGasLimit] =
					await this.estimateUserOperationGas(
						userOperation,
						bundlerRpc,
						overrides.state_override_set,
						overrides.numberOfSigners,
					);

				userOperation.maxFeePerGas = inputMaxFeePerGas
				userOperation.maxPriorityFeePerGas = inputMaxPriorityFeePerGas
			} else {
				throw new AbstractionKitError(
					"BAD_DATA",
					"bundlerRpc cant't be null if preVerificationGas,verificationGasLimit and callGasLimit are not overriden",
				);
			}
		}
		if (
			typeof overrides.preVerificationGas === "bigint" &&
			overrides.preVerificationGas < 0n
		) {
			throw RangeError("preVerificationGas overrid can't be negative");
		}

		if (
			typeof overrides.verificationGasLimit === "bigint" &&
			overrides.verificationGasLimit < 0n
		) {
			throw RangeError("verificationGasLimit overrid can't be negative");
		}

		if (
			typeof overrides.callGasLimit === "bigint" &&
			overrides.callGasLimit < 0n
		) {
			throw RangeError("callGasLimit overrid can't be negative");
		}
		userOperation.preVerificationGas =
			overrides.preVerificationGas ??
			preVerificationGas *
				BigInt(
					Math.floor(
						((overrides.preVerificationGasPercentageMultiplier ?? 0) + 100) /
							100,
					),
				);

		userOperation.verificationGasLimit =
			overrides.verificationGasLimit ??
			verificationGasLimit *
				BigInt(
					Math.floor(
						((overrides.verificationGasLimitPercentageMultiplier ?? 0) + 100) /
							100,
					),
				);

		userOperation.callGasLimit =
			overrides.callGasLimit ??
			callGasLimit *
				BigInt(
					Math.floor(
						((overrides.callGasLimitPercentageMultiplier ?? 0) + 100) / 100,
					),
				);

		return userOperation;
	}

	/**
	 * Sign a UserOperation using one or more private keys via EIP-712 typed data signing.
	 * Signatures are sorted by signer address and concatenated.
	 *
	 * @param useroperation - The UserOperation to sign
	 * @param privateKeys - Array of private keys for the signers
	 * @param chainId - The target chain ID
	 * @param validAfter - Unix timestamp after which the signature is valid (0 = no restriction)
	 * @param validUntil - Unix timestamp after which the signature expires (0 = no restriction)
	 * @returns The formatted signature string ready to set on the UserOperation
	 *
	 * @example
	 * const signature = smartAccount.signUserOperation(userOp, [privateKey], 11155111n);
	 * userOp.signature = signature;
	 */
	public signUserOperation(
		useroperation: UserOperation,
		privateKeys: string[],
		chainId: bigint,
		validAfter: bigint = 0n,
		validUntil: bigint = 0n,
	): string {
		if (privateKeys.length < 1) {
			throw RangeError("There should be at least one privateKey");
		}
		if (chainId < 0n) {
			throw RangeError("chainId can't be negative");
		}
		if (validAfter < 0n) {
			throw RangeError("validAfter can't be negative");
		}
		if (validUntil < 0n) {
			throw RangeError("validUntil can't be negative");
		}

		const SafeUserOperation: SafeUserOperationTypedDataValues = {
			safe: useroperation.sender,
			nonce: useroperation.nonce,
			initCode: useroperation.initCode,
			callData: useroperation.callData,
			callGasLimit: useroperation.callGasLimit,
			verificationGasLimit: useroperation.verificationGasLimit,
			preVerificationGas: useroperation.preVerificationGas,
			maxFeePerGas: useroperation.maxFeePerGas,
			maxPriorityFeePerGas: useroperation.maxPriorityFeePerGas,
			paymasterAndData: useroperation.paymasterAndData,
			validAfter: validAfter,
			validUntil: validUntil,
			entryPoint: this.entrypointAddress,
		};

		const domain: SafeUserOperationTypedDataDomain = {
			chainId,
			verifyingContract: this.safe4337ModuleAddress,
		};

		const signersAddresses = [];
		const signatures = [];
		for (const privateKey of privateKeys) {
			const wallet = new Wallet(privateKey);
			const signerSignature = wallet.signingKey.sign(
				TypedDataEncoder.hash(
					domain,
					SafeAccountV0_2_0.EIP712_SAFE_OPERATION_TYPE,
					SafeUserOperation,
				),
			).serialized;
			signersAddresses.push(wallet.address);
			signatures.push(signerSignature);
		}

		return SafeAccountV0_2_0.formatEip712SignaturesToUseroperationSignature(
			signersAddresses,
			signatures,
			validAfter,
			validUntil,
		);
	}

	/**
	 * Format multiple EIP-712 signatures into a single UserOperation signature.
	 * Signatures are sorted by signer address (ascending) and concatenated,
	 * then wrapped with validAfter/validUntil timestamps.
	 *
	 * @param signersAddresses - Array of signer public addresses (must match signatures array length)
	 * @param signatures - Array of EIP-712 signatures (hex strings)
	 * @param validAfter - Unix timestamp after which the signature is valid (0 = no restriction)
	 * @param validUntil - Unix timestamp after which the signature expires (0 = no restriction)
	 * @returns The formatted UserOperation signature string
	 * @throws RangeError if signersAddresses and signatures arrays have different lengths
	 *
	 * @example
	 * const signature = SafeAccountV0_2_0.formatEip712SignaturesToUseroperationSignature(
	 *   [signerAddress],
	 *   [eip712Signature],
	 * );
	 * userOp.signature = signature;
	 */
	public static formatEip712SignaturesToUseroperationSignature(
		signersAddresses: string[],
		signatures: string[],
		validAfter: bigint = 0n,
		validUntil: bigint = 0n,
	): string {
		if (signersAddresses.length != signatures.length) {
			throw RangeError(
				"signersAddresses and signatures arrays should be the same length",
			);
		}
		const signersSignatures: Map<string, string> = new Map();

		signersAddresses.forEach((signer, index) => {
			signersSignatures.set(signer.toLocaleLowerCase(), signatures[index]);
		});
		const sortedSignersSignatures = new Map(
			Array.from(signersSignatures).sort(),
		);
		const formatedSignature =
			"0x" +
			Array.from(sortedSignersSignatures.values()).reduce(
				(accumulator, currentValue) => accumulator + currentValue.slice(2),
				"",
			);

		return SafeAccountV0_2_0.formatEip712SingleSignatureToUseroperationSignature(
			formatedSignature,
			validAfter,
			validUntil,
		);
	}

	/**
	 * Format a single EIP-712 signature into a UserOperation signature
	 * by prepending validAfter and validUntil timestamps.
	 *
	 * @param signature - A single EIP-712 signature (hex string)
	 * @param validAfter - Unix timestamp after which the signature is valid (0 = no restriction)
	 * @param validUntil - Unix timestamp after which the signature expires (0 = no restriction)
	 * @returns The formatted UserOperation signature string
	 * @throws RangeError if validAfter or validUntil are negative
	 */
	public static formatEip712SingleSignatureToUseroperationSignature(
		signature: string,
		validAfter: bigint = 0n,
		validUntil: bigint = 0n,
	): string {
		if (validAfter < 0n) {
			throw RangeError("validAfter can't be negative");
		}
		if (validUntil < 0n) {
			throw RangeError("validUntil can't be negative");
		}

		return solidityPacked(
			["uint48", "uint48", "bytes"],
			[validAfter, validUntil, signature],
		);
	}

	/**
	 * Submit a signed UserOperation to a bundler for on-chain inclusion.
	 *
	 * @param userOperation - The signed UserOperation to send
	 * @param bundlerRpc - Bundler RPC URL
	 * @returns A SendUseroperationResponse that can be used to poll for the receipt
	 * @throws AbstractionKitError with code "BUNDLER_ERROR" if the submission fails
	 *
	 * @example
	 * const response = await smartAccount.sendUserOperation(userOp, bundlerRpcUrl);
	 * const receipt = await response.included();
	 */
	public async sendUserOperation(
		userOperation: UserOperation,
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
}
