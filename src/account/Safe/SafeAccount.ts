import {
	ZeroAddress,
	AbiCoder,
	keccak256,
	solidityPacked,
	solidityPackedKeccak256,
	BytesLike,
	Wallet,
	TypedDataEncoder
} from "ethers";
import { SmartAccount } from "../SmartAccount";
import { BundlerJsonRpcError, JsonRpcError, Operation, UserOperation } from "../../types";
import { fetchAccountNonce, createCallData, fetchGasPrice } from "../../utils";
import { UserOperationDummyValues} from "../../constants";
import { SafeAccountFactory } from "../../factory/SafeAccountFactory";
import { CreateUserOperationOverrides, InitCodeOverrides, MetaTransaction, SafeModuleExecutorFunctionSelector } from "./types";
import { encodeMultiSendCallData } from "./multisend";
import { Bundler } from "src/Bundler";
import { SendUseroperationResponse } from "../SendUseroperationResponse";


export class SafeAccount extends SmartAccount {
	static readonly DEFAULT_ENTRYPOINT_ADDRESS = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789"
	static readonly DEFAULT_SAFE_4337_MODULE_ADDRESS = "0xD556564bAcF6FEAC2E26ff70695f8250Cea8C29E"
	static readonly DEFAULT_SINGLETON_ADDRESS = "0x41675C099F32341bf84BFc5382aF534df5C7461a"
	static readonly DEFAULT_ADD_MODULE_LIB_ADDRESS = "0xea2B4251c7C1cDFFc04D35d990AF6Fd0309928B3"
	static readonly DEFAULT_MULTISEND_CONTRACT_ADDRESS = "0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526"

	static readonly proxyByteCode: BytesLike = "0x608060405234801561001057600080fd5b506040516101e63803806101e68339818101604052602081101561003357600080fd5b8101908080519060200190929190505050600073ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff1614156100ca576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004018080602001828103825260228152602001806101c46022913960400191505060405180910390fd5b806000806101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff1602179055505060ab806101196000396000f3fe608060405273ffffffffffffffffffffffffffffffffffffffff600054167fa619486e0000000000000000000000000000000000000000000000000000000060003514156050578060005260206000f35b3660008037600080366000845af43d6000803e60008114156070573d6000fd5b3d6000f3fea264697066735822122003d1488ee65e08fa41e58e888a9865554c535f2c77126a82cb4c0f917f31441364736f6c63430007060033496e76616c69642073696e676c65746f6e20616464726573732070726f7669646564";
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

	static readonly DEFAULT_EXECUTOR_FUCNTION_SELECTOR = SafeModuleExecutorFunctionSelector.executeUserOpWithErrorString
	static readonly executorFunctionInputAbi: string[] = [
		"address", //to
		"uint256", //value
		"bytes", //data
		"uint8", //operation
	];

	readonly entrypointAddress: string;
	readonly safe4337ModuleAddress: string;

	constructor(
		accountAddress:string, 
		entrypointAddress:string = SafeAccount.DEFAULT_ENTRYPOINT_ADDRESS,
		safe4337ModuleAddress:string = SafeAccount.DEFAULT_SAFE_4337_MODULE_ADDRESS,
	){
		super(accountAddress)
		this.entrypointAddress = entrypointAddress
		this.safe4337ModuleAddress = safe4337ModuleAddress
	}

	public static createAccountAddressAndInitCode(
		owners: string[],
		overrides:InitCodeOverrides = {},
	):[string, BytesLike] {
		if(owners.length < 1){
			throw RangeError("There should be at least one owner")
		}

		const threshold = overrides.threshold ?? 1
		const c2Nonce = overrides.c2Nonce as bigint ?? 0n
		const singletonAddress = overrides.singletonAddress ?? SafeAccount.DEFAULT_SINGLETON_ADDRESS
		const safe4337ModuleAddress = 
			overrides.safe4337ModuleAddress ?? SafeAccount.DEFAULT_SAFE_4337_MODULE_ADDRESS
		const addModuleLibAddress = overrides.addModuleLibAddress ?? SafeAccount.DEFAULT_ADD_MODULE_LIB_ADDRESS

		let safeAccountFactory: SafeAccountFactory = new SafeAccountFactory()
		if(overrides.safeAccountFactoryAddress != null){
			safeAccountFactory = new SafeAccountFactory(
				overrides.safeAccountFactoryAddress
			)
		}

		const initializerCallData  = SafeAccount.createInitializerCallData(
			owners,
			threshold,
			safe4337ModuleAddress,
			addModuleLibAddress,
		)

		const sender = this.createProxyAddress(
			initializerCallData,
			c2Nonce,
			safeAccountFactory.address,
			singletonAddress
		)

		const initCode = SafeAccount.createInitCode(
			owners,
			threshold,
			c2Nonce,
			singletonAddress,
			safeAccountFactory,
			safe4337ModuleAddress,
			addModuleLibAddress,
		)

		return [sender, initCode]
	}

	public static createInitializerCallData(
		owners: string[],
		threshold: number,
		safe4337ModuleAddress: string = SafeAccount.DEFAULT_SAFE_4337_MODULE_ADDRESS,
		addModuleLibAddress: string = SafeAccount.DEFAULT_ADD_MODULE_LIB_ADDRESS,
	):BytesLike {
		if(owners.length < 1){
			throw RangeError("There should be at least one owner")
		}

		if(threshold < 1){
			throw RangeError("threshold should be at least one")
		}

		if(threshold > owners.length){
			throw RangeError("threshold can't be larger than number of owners")
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
			SafeAccount.initializerFunctionSelector,
			SafeAccount.initializerFunctionInputAbi,
			initializerFunctionInputParameters,
		);
	}

	public static createInitCode(
		owners: string[],
		threshold: number = 1,
		c2Nonce: bigint = 0n,
		singletonAddress: string = SafeAccount.DEFAULT_SINGLETON_ADDRESS,
		safeAccountFactory: SafeAccountFactory = new SafeAccountFactory(),
		safe4337ModuleAddress: string = SafeAccount.DEFAULT_SAFE_4337_MODULE_ADDRESS,
		addModuleLibAddress: string = SafeAccount.DEFAULT_ADD_MODULE_LIB_ADDRESS,
	): BytesLike {
		if(owners.length < 1){
			throw RangeError("There should be at least one owner")
		}

		if(threshold < 1){
			throw RangeError("threshold should be at least one")
		}

		if(threshold > owners.length){
			throw RangeError("threshold can't be larger than number of owners")
		}

		if(c2Nonce < 0n){
			throw RangeError("c2Nonce can't be negative")
		}

		const initializerCallData  = SafeAccount.createInitializerCallData(
			owners,
			threshold,
			safe4337ModuleAddress,
			addModuleLibAddress,
		)

		const generatorFunctionInputParameters = [
			singletonAddress,
			initializerCallData,
			c2Nonce,
		];

		const factoryGeneratorFunctionCallData =
			safeAccountFactory.getFactoryGeneratorFunctionCallData(
				generatorFunctionInputParameters,
		);

		return factoryGeneratorFunctionCallData
	}

	public static createProxyAddress(
		initializerCallData: BytesLike,
		c2Nonce: bigint,
		safeFactoryAddress: string,
		singletonAddress: string,
	): string {
		if(c2Nonce < 0n){
			throw RangeError("c2Nonce can't be negative")
		}

		const abiCoder = AbiCoder.defaultAbiCoder();
		const salt = keccak256(solidityPacked(
			["bytes32","uint256"], 
			[keccak256(initializerCallData),c2Nonce]));
		const initData = abiCoder.encode(
			["uint256"],
			[singletonAddress],
		);

		const initHash = keccak256(
			solidityPacked(["bytes", "bytes"], [this.proxyByteCode, initData]),
		);

		const proxyAdd = solidityPackedKeccak256(
			["bytes1", "address", "bytes32", "bytes32"],
			["0xff", safeFactoryAddress, salt, initHash],
		).slice(-40);
		return "0x" + proxyAdd;
	}

	public static createAccountCallDataSingleTransaction(
		tx: MetaTransaction,
	): BytesLike {
		const value = tx.value ?? 0
		const data = tx.data ?? "0x"
		const operation = tx.operation ?? Operation.Call
		const executorFunctionCallData = SafeAccount.createAccountCallData(
			tx.to,
			value,
			data,
			operation,
		);
		return executorFunctionCallData;
	}

	public static createAccountCallDataBatchTransactions(
		metaTransactions: MetaTransaction[],
		multisendContractAddress: string = SafeAccount.DEFAULT_MULTISEND_CONTRACT_ADDRESS
	): BytesLike {
		if(metaTransactions.length < 1){
			throw RangeError("There should be at least one metaTransaction")
		}

		const multiData = encodeMultiSendCallData(metaTransactions);

		const mutisendSelector = "0x8d80ff0a";
		const multiSendCallData =  createCallData(
			mutisendSelector,
			["bytes"],
			[multiData]
			);

		const executorFunctionCallData = SafeAccount.createAccountCallData(
			multisendContractAddress,
			0n,
			multiSendCallData,
			Operation.Delegate,
		);

		return executorFunctionCallData;
	}

	public static createAccountCallData(
		to: string,
		value: bigint,
		data: BytesLike,
		operation: Operation,
		safeModuleExecutorFunctionSelector: SafeModuleExecutorFunctionSelector = SafeAccount.DEFAULT_EXECUTOR_FUCNTION_SELECTOR
	): BytesLike {
		const executorFunctionInputParameters = [
			to,
			value,
			data,
			operation,
		]
		const callData = createCallData(
			safeModuleExecutorFunctionSelector,
			SafeAccount.executorFunctionInputAbi,
			executorFunctionInputParameters,
		)
		return callData
	}

	public static async estimateUserOperationGas(
		user_operation:UserOperation,
		entrypointAddress: string,
		bundlerRpc:string
	):Promise<[bigint,bigint,bigint] | BundlerJsonRpcError>{
		user_operation.signature = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
		const bundler = new Bundler(bundlerRpc)
		const estimation = await bundler.estimateUserOperationGas(
			user_operation,
			entrypointAddress
		)
		if("code" in estimation){
			return estimation;
		}

		const preVerificationGas = BigInt(estimation.preVerificationGas)
		const verificationGasLimit = BigInt(estimation.verificationGasLimit) + 5000n
		const callGasLimit = BigInt(estimation.callGasLimit)

		return [preVerificationGas, verificationGasLimit, callGasLimit]
	}

	public signUserOperation(
		useroperation: UserOperation,
		privateKeys: string[],
		chainId: bigint,
		validAfter: bigint = 0n,
		validUntil: bigint = 0n,
	): string {
		if(privateKeys.length < 1){
			throw RangeError("There should be at least one privateKey")
		}
		if(chainId < 0n){
			throw RangeError("chainId can't be negative")
		}
		if(validAfter < 0n){
			throw RangeError("validAfter can't be negative")
		}
		if(validUntil < 0n){
			throw RangeError("validUntil can't be negative")
		}

		const SafeUserOperation = {
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
			entryPoint: this.entrypointAddress
		}
		const EIP712_SAFE_OPERATION_TYPE = {
			SafeOp: [
				{ type: 'address', name: 'safe' },
				{ type: 'uint256', name: 'nonce' },
				{ type: 'bytes', name: 'initCode' },
				{ type: 'bytes', name: 'callData' },
				{ type: 'uint256', name: 'callGasLimit' },
				{ type: 'uint256', name: 'verificationGasLimit' },
				{ type: 'uint256', name: 'preVerificationGas' },
				{ type: 'uint256', name: 'maxFeePerGas' },
				{ type: 'uint256', name: 'maxPriorityFeePerGas' },
				{ type: 'bytes', name: 'paymasterAndData' },
				{ type: 'uint48', name: 'validAfter' },
				{ type: 'uint48', name: 'validUntil' },
				{ type: 'address', name: 'entryPoint' },
			],
		}
		let sig = "";
		for (const privateKey of privateKeys){
			const signer = new Wallet(privateKey)
			const signerSignature = signer.signingKey.sign(
				TypedDataEncoder.hash(
					{ 
						chainId, 
						verifyingContract: this.safe4337ModuleAddress 
					},
					EIP712_SAFE_OPERATION_TYPE, 
					SafeUserOperation
				)
			).serialized

			sig = sig + signerSignature
		}

		return solidityPacked(
			["uint48", "uint48", "bytes"],
			[validAfter, validUntil, sig],
		);
	}

	public async createUserOperation(
		transactions: MetaTransaction[],
		providerRpc:string,
		bundlerRpc: string,
		overrids:CreateUserOperationOverrides= {},
	): Promise<UserOperation | JsonRpcError | BundlerJsonRpcError>{
		if(transactions.length < 1){
			throw RangeError("There should be at least one transaction")
		}

		let nonce = 0n as bigint;
		
		if(overrids.nonce == null){
			const fetchResult = await fetchAccountNonce(
				providerRpc,
				this.entrypointAddress,
				this.accountAddress,
			)
			if(typeof(fetchResult) === "bigint"){
				nonce = fetchResult
			}else{
				return fetchResult
			}
		}else{
			nonce = overrids.nonce
		}

		const initCode = overrids.initCode?? "0x"

		if(nonce < 0n){
			throw RangeError("nonce can't be negative")
		}

		if(initCode != "0x" && nonce > 0n){
			throw RangeError("initCode is only allowed when the nonce is zero for the first transaction when the safe account is not deployed yet")
		}

		let callData = "0x" as BytesLike
		if(overrids.callData == null){
			if(transactions.length  == 1){
				callData = SafeAccount.createAccountCallDataSingleTransaction(
					transactions[0]
				)
			}else{
				callData = SafeAccount.createAccountCallDataBatchTransactions(
					transactions
				)
			}
		}else{
			callData = overrids.callData
		}

		let maxFeePerGas = UserOperationDummyValues.maxFeePerGas
		let maxPriorityFeePerGas = UserOperationDummyValues.maxPriorityFeePerGas
		if(overrids.maxFeePerGas == null || overrids.maxPriorityFeePerGas == null){
			[
				maxFeePerGas,
				maxPriorityFeePerGas
			] = await fetchGasPrice(providerRpc)
		}
		if(typeof(overrids.maxFeePerGas) === "bigint" && overrids.maxFeePerGas < 0n){
			throw RangeError("maxFeePerGas overrid can't be negative")
		}

		if(typeof(overrids.maxPriorityFeePerGas) === "bigint" && overrids.maxPriorityFeePerGas < 0n){
			throw RangeError("maxPriorityFeePerGas overrid can't be negative")
		}

		maxFeePerGas =  overrids.maxFeePerGas ?? maxFeePerGas
		maxPriorityFeePerGas = overrids.maxPriorityFeePerGas ?? maxPriorityFeePerGas
		
		const user_operation :UserOperation={
			...UserOperationDummyValues,
			sender:this.accountAddress,
			nonce: nonce,
			initCode: initCode,
			callData:callData,
			maxFeePerGas:maxFeePerGas,
			maxPriorityFeePerGas:maxPriorityFeePerGas,
		}

		let preVerificationGas = UserOperationDummyValues.preVerificationGas
		let verificationGasLimit = UserOperationDummyValues.verificationGasLimit
		let callGasLimit = UserOperationDummyValues.callGasLimit
		if(
			overrids.preVerificationGas == null ||
			overrids.verificationGasLimit == null ||
			overrids.callGasLimit == null
		){
			const estimateRes = await SafeAccount.estimateUserOperationGas(
				user_operation,
				this.entrypointAddress,
				bundlerRpc, 
			)
			if("code" in estimateRes){
				return estimateRes;
			}else{
				[
					preVerificationGas,
					verificationGasLimit,
					callGasLimit
				] = estimateRes
			}
		}
		if(typeof(overrids.preVerificationGas) === "bigint" && overrids.preVerificationGas < 0n){
			throw RangeError("preVerificationGas overrid can't be negative")
		}

		if(typeof(overrids.verificationGasLimit) === "bigint" && overrids.verificationGasLimit < 0n){
			throw RangeError("verificationGasLimit overrid can't be negative")
		}

		if(typeof(overrids.callGasLimit) === "bigint" && overrids.callGasLimit < 0n){
			throw RangeError("callGasLimit overrid can't be negative")
		}
		user_operation.preVerificationGas = overrids.preVerificationGas ?? preVerificationGas
		user_operation.verificationGasLimit = overrids.verificationGasLimit ?? verificationGasLimit
		user_operation.callGasLimit = overrids.callGasLimit ?? callGasLimit

		return user_operation;
	}

	public async sendUserOperation(
		user_operation: UserOperation,
		bundlerRpc: string
	):Promise<SendUseroperationResponse | BundlerJsonRpcError>{
		const bundler = new Bundler(bundlerRpc)
		const sendUserOperationRes = await bundler.sendUserOperation(
			user_operation, 
			this.entrypointAddress
		)
		if (typeof(sendUserOperationRes) !== "string") {
			return sendUserOperationRes
		}
		return new SendUseroperationResponse(
			sendUserOperationRes,
			bundler,
			this.entrypointAddress
		)
	}
}
