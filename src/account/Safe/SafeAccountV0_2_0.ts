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
import { BundlerJsonRpcError, JsonRpcError, Operation, StateOverrideSet, UserOperation } from "../../types";
import { fetchAccountNonce, createCallData, fetchGasPrice } from "../../utils";
import { UserOperationDummyValues} from "../../constants";
import { SafeAccountFactory } from "../../factory/SafeAccountFactory";
import { CreateUserOperationOverrides, InitCodeOverrides, MetaTransaction, SafeModuleExecutorFunctionSelector } from "./types";
import { encodeMultiSendCallData } from "./multisend";
import { Bundler } from "src/Bundler";
import { SendUseroperationResponse } from "../SendUseroperationResponse";


export class SafeAccountV0_2_0 extends SmartAccount {
	static readonly DEFAULT_ENTRYPOINT_ADDRESS = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789"
	static readonly DEFAULT_SAFE_4337_MODULE_ADDRESS = "0xa581c4A4DB7175302464fF3C06380BC3270b4037"
	static readonly DEFAULT_SINGLETON_ADDRESS = "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762"
	static readonly DEFAULT_ADD_MODULE_LIB_ADDRESS = "0x8EcD4ec46D4D2a6B64fE960B3D64e8B94B2234eb"
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
	private initCode: BytesLike|null;

	constructor(
		accountAddress:string, 
		safe4337ModuleAddress:string = SafeAccountV0_2_0.DEFAULT_SAFE_4337_MODULE_ADDRESS,
		entrypointAddress:string = SafeAccountV0_2_0.DEFAULT_ENTRYPOINT_ADDRESS,
	){
		super(accountAddress)
		this.entrypointAddress = entrypointAddress
		this.safe4337ModuleAddress = safe4337ModuleAddress
		this.initCode = null
	}
	/**
	 * To create and initialize a SafeAccountV0_2_0 object from its
	 * initial owners
	 * @note
	 * initializeNewAccount only needed when the smart account
	 * have not been deployed yet and the account address is unknown.
	 * @param owners list of account owners
	 * @param overrides to change the initialization default values
	 * @returns a SafeAccountV0_2_0 object
	 */
	public static initializeNewAccount(
		owners: string[],
		overrides:InitCodeOverrides = {},
	):SafeAccountV0_2_0 {
		const [accountAddress, initCode] = SafeAccountV0_2_0.createAccountAddressAndInitCode(
			owners, overrides
		)
		const safe = new SafeAccountV0_2_0(accountAddress)
		safe.initCode = initCode
		return safe
	}

	/**
	 * calculate account address and initcode from owners
	 * @param owners list of account owners
	 * @param overrides to change the default values
	 * @returns 
	 */
	public static createAccountAddressAndInitCode(
		owners: string[],
		overrides:InitCodeOverrides = {},
	):[string, BytesLike] {
		if(owners.length < 1){
			throw RangeError("There should be at least one owner")
		}

		const threshold = overrides.threshold ?? 1
		const c2Nonce = overrides.c2Nonce as bigint ?? 0n
		const singletonAddress = overrides.singletonAddress ?? SafeAccountV0_2_0.DEFAULT_SINGLETON_ADDRESS
		const safe4337ModuleAddress = 
			overrides.safe4337ModuleAddress ?? SafeAccountV0_2_0.DEFAULT_SAFE_4337_MODULE_ADDRESS
		const addModuleLibAddress = overrides.addModuleLibAddress ?? SafeAccountV0_2_0.DEFAULT_ADD_MODULE_LIB_ADDRESS

		let safeAccountFactory: SafeAccountFactory = new SafeAccountFactory()
		if(overrides.safeAccountFactoryAddress != null){
			safeAccountFactory = new SafeAccountFactory(
				overrides.safeAccountFactoryAddress
			)
		}

		const initializerCallData  = SafeAccountV0_2_0.createInitializerCallData(
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

		const initCode = SafeAccountV0_2_0.createInitCode(
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

	private static createInitializerCallData(
		owners: string[],
		threshold: number,
		safe4337ModuleAddress: string = SafeAccountV0_2_0.DEFAULT_SAFE_4337_MODULE_ADDRESS,
		addModuleLibAddress: string = SafeAccountV0_2_0.DEFAULT_ADD_MODULE_LIB_ADDRESS,
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
			SafeAccountV0_2_0.initializerFunctionSelector,
			SafeAccountV0_2_0.initializerFunctionInputAbi,
			initializerFunctionInputParameters,
		);
	}

	/**
	 * create account initcode
	 * @param owners list of account owners
	 * @param threshold for owners signatures
	 * @param c2Nonce create2 nonce
	 * @param singletonAddress Safe singleton address
	 * @param safeAccountFactory SafeAccountFactory object
	 * @param safe4337ModuleAddress Safe 4337 module address
	 * @param addModuleLibAddress addModuleLib Address
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

		const initializerCallData  = SafeAccountV0_2_0.createInitializerCallData(
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

	/**
	 * encode calldata for a single MetaTransaction to be executed by Safe account
	 */
	public static createAccountCallDataSingleTransaction(
		metaTransaction: MetaTransaction,
	): BytesLike {
		const value = metaTransaction.value ?? 0
		const data = metaTransaction.data ?? "0x"
		const operation = metaTransaction.operation ?? Operation.Call
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
		multisendContractAddress: string = SafeAccountV0_2_0.DEFAULT_MULTISEND_CONTRACT_ADDRESS
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
		data: BytesLike,
		operation: Operation,
		safeModuleExecutorFunctionSelector: SafeModuleExecutorFunctionSelector = SafeAccountV0_2_0.DEFAULT_EXECUTOR_FUCNTION_SELECTOR
	): BytesLike {
		const executorFunctionInputParameters = [
			to,
			value,
			data,
			operation,
		]
		const callData = createCallData(
			safeModuleExecutorFunctionSelector,
			SafeAccountV0_2_0.executorFunctionInputAbi,
			executorFunctionInputParameters,
		)
		return callData
	}

	/**
	 * estimate gas limits for a useroperation
	 * @param user_operation 
	 * @param entrypointAddress 
	 * @param bundlerRpc 
	 * @param state_override_set 
	 * @param numberOfOwners 
	 * @returns [preVerificationGas, verificationGasLimit, callGasLimit]
	 */
	public static async estimateUserOperationGas(
		user_operation:UserOperation,
		entrypointAddress: string,
		bundlerRpc:string,
		state_override_set?: StateOverrideSet,
		numberOfOwners: number=1,
	):Promise<[bigint,bigint,bigint] | BundlerJsonRpcError>{
		if(numberOfOwners < 0n){
			throw RangeError("numberOfOwners can't be negative")
		}

		let signatures = "";
		for (let i = 0; i < numberOfOwners; i++) {
			signatures = signatures + "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
		}
		user_operation.signature = "0xffffffffffffffffffffffff" + signatures
		const bundler = new Bundler(bundlerRpc)
		const estimation = await bundler.estimateUserOperationGas(
			user_operation,
			entrypointAddress,
			state_override_set
		)
		if("code" in estimation){
			return estimation;
		}

		const preVerificationGas = BigInt(estimation.preVerificationGas)
		const verificationGasLimit = BigInt(estimation.verificationGasLimit) + 5000n
		const callGasLimit = BigInt(estimation.callGasLimit)

		return [preVerificationGas, verificationGasLimit, callGasLimit]
	}

	/**
	 * createUserOperation will determine the nonce, fetch the gas prices,
	 * estimate gas limits and return a useroperation to be signed.
	 * you can override all these values using the overrides parameter.
	 * @param transactions 
	 * @param providerRpc 
	 * @param bundlerRpc 
	 * @param overrids 
	 * @returns a useroperation or an error object
	 */
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

		let initCode = overrids.initCode?? this.initCode

		if(initCode == null || nonce > 0n){
			initCode = "0x"
		}

		if(nonce < 0n){
			throw RangeError("nonce can't be negative")
		}

		let callData = "0x" as BytesLike
		if(overrids.callData == null){
			if(transactions.length  == 1){
				callData = SafeAccountV0_2_0.createAccountCallDataSingleTransaction(
					transactions[0]
				)
			}else{
				callData = SafeAccountV0_2_0.createAccountCallDataBatchTransactions(
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
			const estimateRes = await SafeAccountV0_2_0.estimateUserOperationGas(
				user_operation,
				this.entrypointAddress,
				bundlerRpc,
				overrids.state_override_set,
				overrids.numberOfOwners
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

	/**
	 * create a useroperation signature
	 * @param useroperation 
	 * @param privateKeys for the owners to sign
	 * @param chainId 
	 * @param validAfter 
	 * @param validUntil 
	 * @returns signature
	 */
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

	/**
	 * sends a useroperation to a bundler rpc
	 * @param user_operation 
	 * @param bundlerRpc 
	 * @returns SendUseroperationResponse or BundlerJsonRpcError
	 */
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
