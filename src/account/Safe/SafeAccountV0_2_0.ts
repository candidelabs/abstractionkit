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

	readonly entrypointAddress: string;
	readonly safe4337ModuleAddress: string;
	private initCode: string | null;

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
	 * To create and initialize a SafeAccountV0_2_0 object from its
	 * initial owners
	 * @remarks
	 * initializeNewAccount only needed when the smart account
	 * have not been deployed yet and the account address is unknown.
	 * @param owners - list of account owners addresses
	 * @param overrides - override values to change the initialization default values
	 * @returns a SafeAccountV0_2_0 object
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
	 * calculate account addressfrom initial owners
	 * @param owners - list of account owners addresses
	 * @param overrides - override values to change the initialization default values
	 * @returns account address
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
	 * calculate account address and initcode from owners
	 * @param owners - list of account owners addresses
	 * @param overrides - override values to change the initialization default values
	 * @returns account address and initcode
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
	 * create account initcode
	 * @param owners - list of account owners addresses
	 * @param threshold - for owners signatures
	 * @param c2Nonce - create2 nonce
	 * @param singletonAddress - Safe singleton address
	 * @param safeAccountFactory - SafeAccountFactory object
	 * @param safe4337ModuleAddress - Safe 4337 module address
	 * @param addModuleLibAddress - addModuleLib Address
	 * @returns initcode
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
	 * encode calldata for a single MetaTransaction to be executed by Safe account
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
	 * encode calldata for a list of MetaTransactions to be executed by Safe account
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
	 * encode calldata to be executed by Safe account
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
	 * decode calldata to [to, value, data, operation]
	 * @returns to, value, data, operation
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
	 * a non static wrapper function for  prependTokenPaymasterApproveToCallDataStatic
	 * which adds a token approve call to the call data for a token paymaster
	 * @returns callData
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
	 * adds a token approve call to the call data for a token paymaster
	 * @returns callData
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
	 * estimate gas limits for a useroperation
	 * @param userOperation - useroperation to estimate gas for
	 * @param bundlerRpc - bundler rpc for gas estimation
	 * @param state_override_set - state override values to set during gs estimation
	 * @param numberOfSigners - number of sigers
	 * @returns promise with [preVerificationGas, verificationGasLimit, callGasLimit]
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
			BigInt(estimation.verificationGasLimit) + BigInt(numberOfSigners) * 20_000n;
		const callGasLimit = BigInt(estimation.callGasLimit);

		return [preVerificationGas, verificationGasLimit, callGasLimit];
	}

	/**
	 * createUserOperation will determine the nonce, fetch the gas prices,
	 * estimate gas limits and return a useroperation to be signed.
	 * you can override all these values using the overrides parameter.
	 * @param transactions - metatransaction list to be encoded
	 * @param providerRpc - node rpc to fetch account nonce and gas prices
	 * @param bundlerRpc - bundler rpc for gas estimation
	 * @param overrids - overrides values to change default values
	 * @returns promise with useroperation
	 */
	public async createUserOperation(
		transactions: MetaTransaction[],
		providerRpc?: string,
		bundlerRpc?: string,
		overrids: CreateUserOperationOverrides = {},
	): Promise<UserOperation> {
		if (transactions.length < 1) {
			throw RangeError("There should be at least one transaction");
		}

		let nonce = 0n as bigint;

		if (overrids.nonce == null) {
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
			nonce = overrids.nonce;
		}

		let initCode = overrids.initCode ?? this.initCode;

		if (initCode == null || nonce > 0n) {
			initCode = "0x";
		}

		if (nonce < 0n) {
			throw RangeError("nonce can't be negative");
		}

		let callData = "0x" as string;
		if (overrids.callData == null) {
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
			callData = overrids.callData;
		}

		let maxFeePerGas = UserOperationDummyValues.maxFeePerGas;
		let maxPriorityFeePerGas = UserOperationDummyValues.maxPriorityFeePerGas;
		if (
			overrids.maxFeePerGas == null ||
			overrids.maxPriorityFeePerGas == null
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
			typeof overrids.maxFeePerGas === "bigint" &&
			overrids.maxFeePerGas < 0n
		) {
			throw RangeError("maxFeePerGas overrid can't be negative");
		}

		if (
			typeof overrids.maxPriorityFeePerGas === "bigint" &&
			overrids.maxPriorityFeePerGas < 0n
		) {
			throw RangeError("maxPriorityFeePerGas overrid can't be negative");
		}

		maxFeePerGas =
			overrids.maxFeePerGas ??
			maxFeePerGas *
				BigInt(
					Math.floor(
						((overrids.maxFeePerGasPercentageMultiplier ?? 0) + 100) / 100,
					),
				);
		maxPriorityFeePerGas =
			overrids.maxPriorityFeePerGas ??
			maxPriorityFeePerGas *
				BigInt(
					Math.floor(
						((overrids.maxPriorityFeePerGasPercentageMultiplier ?? 0) + 100) /
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
			overrids.preVerificationGas == null ||
			overrids.verificationGasLimit == null ||
			overrids.callGasLimit == null
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
						overrids.state_override_set,
						overrids.numberOfSigners,
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
			typeof overrids.preVerificationGas === "bigint" &&
			overrids.preVerificationGas < 0n
		) {
			throw RangeError("preVerificationGas overrid can't be negative");
		}

		if (
			typeof overrids.verificationGasLimit === "bigint" &&
			overrids.verificationGasLimit < 0n
		) {
			throw RangeError("verificationGasLimit overrid can't be negative");
		}

		if (
			typeof overrids.callGasLimit === "bigint" &&
			overrids.callGasLimit < 0n
		) {
			throw RangeError("callGasLimit overrid can't be negative");
		}
		userOperation.preVerificationGas =
			overrids.preVerificationGas ??
			preVerificationGas *
				BigInt(
					Math.floor(
						((overrids.preVerificationGasPercentageMultiplier ?? 0) + 100) /
							100,
					),
				);

		userOperation.verificationGasLimit =
			overrids.verificationGasLimit ??
			verificationGasLimit *
				BigInt(
					Math.floor(
						((overrids.verificationGasLimitPercentageMultiplier ?? 0) + 100) /
							100,
					),
				);

		userOperation.callGasLimit =
			overrids.callGasLimit ??
			callGasLimit *
				BigInt(
					Math.floor(
						((overrids.callGasLimitPercentageMultiplier ?? 0) + 100) / 100,
					),
				);

		return userOperation;
	}

	/**
	 * create a useroperation signature
	 * @param useroperation - useroperation to sign
	 * @param privateKeys - for the signers
	 * @param chainId - target chain id
	 * @param validAfter - timestamp the signature will be valid after
	 * @param validUntil - timestamp the signature will be valid until
	 * @returns signature
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
	 * formate a list of eip712 signatures to a useroperation signature
	 * @param signersAddresses - signers public addresses
	 * @param signatures - list of eip712 signatures
	 * @param validAfter - timestamp the signature will be valid after
	 * @param validUntil - timestamp the signature will be valid until
	 * @returns signature
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
	 * formate an eip712 signature to a useroperation signature
	 * @param signature - an eip712 signature
	 * @param validAfter - timestamp the signature will be valid after
	 * @param validUntil - timestamp the signature will be valid until
	 * @returns signature
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
	 * sends a useroperation to a bundler rpc
	 * @param userOperation - useroperation to send
	 * @param bundlerRpc - bundler rpc to send useroperation
	 * @returns promise with SendUseroperationResponse
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
