import {
	Wallet,
	TypedDataEncoder,
	AbiCoder,
	solidityPacked,
	solidityPackedKeccak256,
	ethers,
	keccak256,
} from "ethers";
import { SafeAccount } from "./SafeAccount";
import {
	MetaTransaction,
	Operation,
	StateOverrideSet,
	UserOperation,
} from "../../types";
import {
	createCallData,
	fetchAccountNonce,
	fetchGasPrice,
} from "../../utils";
import { UserOperationDummyValues, ZeroAddress } from "../../constants";
import {
	CreateUserOperationOverrides,
	DummySignature,
	InitCodeOverrides,
	Signer,
	SafeUserOperationTypedDataDomain,
	SafeUserOperationTypedDataValues,
	SignerSignaturePair,
	WebauthSignatureData,
} from "./types";
import { Bundler } from "src/Bundler";
import { AbstractionKitError } from "src/errors";
import { SafeAccountFactory } from "src/factory/SafeAccountFactory";
import { encodeMultiSendCallData } from "./multisend";

export class SafeAccountWebAuth extends SafeAccount {
	static readonly DEFAULT_WEB_AUTHN_SIGNATURE_VALIDATOR_SINGLETON: string = "0xcA66C5A0eEAb0Fe74F343bb4A539042c68aE45F9"
	static readonly DEFAULT_WEB_AUTHN_SIGNER_FACTORY: string = "0xEae2AD611c0e8E14604B8cc611a89d5e9d138B49"
	static readonly DEFAULT_WEB_AUTHN_VERIFIER: string = "0xCAc51aDF726E4b269645a7fD6a43296A1Ff53e8d"
	static readonly DEFAULT_SIGNATURE_VALIDATOR = "0x21E4747C7215fe6E343376034F08261bBD9ac497"
	static readonly DEFAULT_WEB_AUTHN_SIGNER_CREATION_CODE = "0x608060405234801561001057600080fd5b5060405161017238038061017283398101604081905261002f916100b9565b6001600160a01b0381166100945760405162461bcd60e51b815260206004820152602260248201527f496e76616c69642073696e676c65746f6e20616464726573732070726f766964604482015261195960f21b606482015260840160405180910390fd5b600080546001600160a01b0319166001600160a01b03929092169190911790556100e9565b6000602082840312156100cb57600080fd5b81516001600160a01b03811681146100e257600080fd5b9392505050565b607b806100f76000396000f3fe608060405260008054632cf35bc960e11b8235016027576001600160f41b0381168252602082f35b3682833781823684845af490503d82833e806040573d82fd5b503d81f3fea264697066735822122062f4785a59897477a798d8218290ac5cf89f803649d66b453fa58689dd461e3164736f6c63430008140033"
	
	private isInitWebAuthn: boolean;
	private x: bigint = 0n;
	private y: bigint = 0n;

	constructor(
		accountAddress: string,
		safe4337ModuleAddress: string = SafeAccountWebAuth.DEFAULT_SAFE_4337_MODULE_ADDRESS,
		entrypointAddress: string = SafeAccountWebAuth.DEFAULT_ENTRYPOINT_ADDRESS,
	) {
		super(accountAddress, safe4337ModuleAddress, entrypointAddress);
		this.isInitWebAuthn = false
	}

	/**
	 * To create and initialize a SafeAccount object from its
	 * initial owners
	 * @remarks
	 * initializeNewAccount only needed when the smart account
	 * have not been deployed yet and the account address is unknown.
	 * @param owners - list of account owners addresses
	 * @param overrides - override values to change the initialization default values
	 * @returns a SafeAccount object
	 */
	public static initializeNewAccount(
		owners: Signer[],
		overrides: InitCodeOverrides = {},
	): SafeAccountWebAuth {
		
		let isInitWebAuthn = false;
		let x = 0n;
		let y = 0n;
		for(const owner of owners){
			if(typeof(owner) != "string"){
				isInitWebAuthn = true;
				x = owner.x;
				y = owner.y;
			}
		}
		
		const [accountAddress, initCode] =
		SafeAccountWebAuth.createAccountAddressAndInitCode(owners, overrides);
		const safe = new SafeAccountWebAuth(accountAddress);
		safe.initCode = initCode;
		safe.isInitWebAuthn = isInitWebAuthn;
		safe.x = x;
		safe.y = y;
		
		return safe;
	}
	
	/**
	 * calculate account addressfrom initial owners
	 * @param owners - list of account owners addresses
	 * @param overrides - override values to change the initialization default values
	 * @returns account address
	 */
	public static createAccountAddress(
		owners: Signer[],
		overrides: InitCodeOverrides = {},
	): string {
		const [address, ] = SafeAccountWebAuth.createAccountAddressAndInitCode(
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
		owners: Signer[],
		overrides: InitCodeOverrides = {},
	): [string, string] {
		if (owners.length < 1) {
			throw RangeError("There should be at least one owner");
		}

		const threshold = overrides.threshold ?? 1;
		const c2Nonce = (overrides.c2Nonce as bigint) ?? 0n;
		const singletonAddress =
			overrides.singletonAddress ?? SafeAccount.DEFAULT_SINGLETON_ADDRESS;
		const safe4337ModuleAddress =
			overrides.safe4337ModuleAddress ??
			SafeAccount.DEFAULT_SAFE_4337_MODULE_ADDRESS;
		const addModuleLibAddress =
			overrides.addModuleLibAddress ??
			SafeAccount.DEFAULT_ADD_MODULE_LIB_ADDRESS;

		let safeAccountFactory: SafeAccountFactory = new SafeAccountFactory();
		if (overrides.safeAccountFactoryAddress != null) {
			safeAccountFactory = new SafeAccountFactory(
				overrides.safeAccountFactoryAddress,
			);
		}

		const initializerCallData = SafeAccountWebAuth.createInitializerCallData(
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

	protected static createInitializerCallData(
		owners: Signer[],
		threshold: number,
		safe4337ModuleAddress: string = SafeAccount.DEFAULT_SAFE_4337_MODULE_ADDRESS,
		addModuleLibAddress: string = SafeAccount.DEFAULT_ADD_MODULE_LIB_ADDRESS,
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

		const addModuleLibCallData: MetaTransaction = {
			to: addModuleLibAddress,
			value: 0n,
			data: enable4337ModuleCallData,
			operation: Operation.Delegate,
		};
		const txs = [];
		txs.push(addModuleLibCallData);
		const modOwners = [];


		let numOfWebAuthOwners = 0
		for(const owner of owners){
			if(typeof(owner) != "string"){
				if (numOfWebAuthOwners > 0) {
					throw RangeError("Only one WebAuthn owner can be set during initialization");
				}
				const addWebauthSigner = createCallData(
					"0xf9c6055b", //setSigner
					["uint256", "uint256"],
					[owner.x,owner.y],
				);

				const setSignerCallData: MetaTransaction = {
					to: SafeAccountWebAuth.DEFAULT_WEB_AUTHN_SIGNATURE_VALIDATOR_SINGLETON,
					value: 0n,
					data: addWebauthSigner,
					operation: Operation.Delegate,
				};
				txs.push(setSignerCallData);
				modOwners.push(SafeAccountWebAuth.DEFAULT_WEB_AUTHN_SIGNATURE_VALIDATOR_SINGLETON);
				numOfWebAuthOwners++
			}else{
				modOwners.push(owner);
			}
		}

		const encodedInit = encodeMultiSendCallData(txs);

		const mutisendSelector = "0x8d80ff0a";
		const multiSendCallData = createCallData(
			mutisendSelector,
			["bytes"],
			[encodedInit],
		);

		const initializerFunctionInputParameters = [
			modOwners,
			threshold,
			SafeAccountWebAuth.DEFAULT_MULTISEND_CONTRACT_ADDRESS, //to Contract address for optional delegate call during initialization
			multiSendCallData, //Data payload for optional delegate call during initialization
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
		owners: Signer[],
		threshold: number = 1,
		c2Nonce: bigint = 0n,
		singletonAddress: string = SafeAccount.DEFAULT_SINGLETON_ADDRESS,
		safeAccountFactory: SafeAccountFactory = new SafeAccountFactory(),
		safe4337ModuleAddress: string = SafeAccount.DEFAULT_SAFE_4337_MODULE_ADDRESS,
		addModuleLibAddress: string = SafeAccount.DEFAULT_ADD_MODULE_LIB_ADDRESS,
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

		const initializerCallData = SafeAccountWebAuth.createInitializerCallData(
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
	 * a non static wrapper function for  prependTokenPaymasterApproveToCallDataStatic
	 * which adds a token approve call to the call data for a token paymaster
	 * @returns callData
	 */
	public prependTokenPaymasterApproveToCallData(
		callData: string,
		tokenAddress: string,
		paymasterAddress: string,
		approveAmount: bigint,
		multisendContractAddress: string = SafeAccountWebAuth.DEFAULT_MULTISEND_CONTRACT_ADDRESS,
	): string {
		return SafeAccountWebAuth.prependTokenPaymasterApproveToCallDataStatic(
			callData,
			tokenAddress,
			paymasterAddress,
			approveAmount,
			multisendContractAddress,
		);
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
		dummySignatures: DummySignature[]|null = null,
	): Promise<[bigint, bigint, bigint]> {
		if (numberOfSigners < 1n) {
			throw RangeError("numberOfSigners can't be less than 1");
		}
		

		if(dummySignatures != null && numberOfSigners != dummySignatures.length){
			throw RangeError("dummySignatures list should has the length of numberOfSigners");
		}

		let signatures = "";
		for (let i = 0; i < numberOfSigners; i++) {
			let dummySignature = ""
			if(dummySignatures == null){
				dummySignature = DummySignature.eoa
			}else{
				dummySignature = dummySignatures[i]
			}
			signatures = signatures + dummySignatures
		}
		
		userOperation.signature = "0xffffffffffffffffffffffffffffffffffffffffffffffff" + signatures;

		const bundler = new Bundler(bundlerRpc);
		const estimation = await bundler.estimateUserOperationGas(
			userOperation,
			this.entrypointAddress,
			state_override_set,
		);

		const preVerificationGas = BigInt(estimation.preVerificationGas);
		const verificationGasLimit =
			BigInt(estimation.verificationGasLimit) + BigInt(numberOfSigners) * 5000n;
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
		}else if(this.isInitWebAuthn){
			const initializer = createCallData(
				"0x080fbebf", //setup
				["uint256", "uint256", "address"],
				[this.x,this.y,SafeAccountWebAuth.DEFAULT_WEB_AUTHN_VERIFIER],
			);

			const createDeterministicWebAuthnVerifierOwnerCallData = createCallData(
				"0x1688f0b9", //createProxyWithNonce
				[
					"address", 	//_singleton
					"bytes",  	//initializer
					"uint256", 	//saltNonce
				],
				[
					SafeAccountWebAuth.DEFAULT_SIGNATURE_VALIDATOR,
					initializer,
					0,
				]
			);

			const createDeterministicWebAuthnVerifierOwner :MetaTransaction ={
				to: SafeAccountWebAuth.DEFAULT_WEB_AUTHN_SIGNER_FACTORY,
				value: 0n,
				data: createDeterministicWebAuthnVerifierOwnerCallData,
			}

			const DeterministicWebAuthnVerifierAddress = SafeAccountWebAuth.createWebAuthnSignerVerifierAddress(
				this.x,
				this.y,
			)

			const swapSingletonWithDeterministicWebAuthnVerifierOwnerCallData = createCallData(
				"0xe318b52b", //swapOwner
				[
					"address", //prevOwner
					"address", //oldOwner
					"address"  //newOwner
				],
				[
					"0x0000000000000000000000000000000000000001", //SENTINEL_OWNERS
					SafeAccountWebAuth.DEFAULT_WEB_AUTHN_SIGNATURE_VALIDATOR_SINGLETON,
					DeterministicWebAuthnVerifierAddress
				]
			);

			const swapSingletonWithDeterministicWebAuthnVerifierOwner :MetaTransaction ={
				to: this.accountAddress,
				value: 0n,
				data: swapSingletonWithDeterministicWebAuthnVerifierOwnerCallData,
			}

			const removeWebAuthnSignerFromStorage :MetaTransaction ={
				to: SafeAccountWebAuth.DEFAULT_WEB_AUTHN_SIGNATURE_VALIDATOR_SINGLETON,
				value: 0n,
				data: "0x578c7a83", //removeSigner
				operation: Operation.Delegate
			}
		
			transactions = [
				createDeterministicWebAuthnVerifierOwner,
				swapSingletonWithDeterministicWebAuthnVerifierOwner, 
				removeWebAuthnSignerFromStorage,
			].concat(transactions)
		}

		if (nonce < 0n) {
			throw RangeError("nonce can't be negative");
		}

		let callData = "0x" as string;
		if (overrids.callData == null) {
			if (transactions.length == 1) {
				callData = SafeAccountWebAuth.createAccountCallDataSingleTransaction(
					transactions[0],
				);
			} else {
				callData =
					SafeAccountWebAuth.createAccountCallDataBatchTransactions(
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
            (
                maxFeePerGas *
                BigInt((overrids.maxFeePerGasPercentageMultiplier ?? 0) + 100)
            )/100n;

		maxPriorityFeePerGas =
			overrids.maxPriorityFeePerGas ??
            (
                maxPriorityFeePerGas *
                BigInt((overrids.maxPriorityFeePerGasPercentageMultiplier ?? 0) + 100)
            )/100n;

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
				[preVerificationGas, verificationGasLimit, callGasLimit] =
					await this.estimateUserOperationGas(
						userOperation,
						bundlerRpc,
						overrids.state_override_set,
						overrids.numberOfSigners,
						overrids.dummySignatures,
					);
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
            (
                preVerificationGas *
                BigInt((overrids.preVerificationGasPercentageMultiplier ?? 0) + 100)
            )/100n;

		userOperation.verificationGasLimit =
			overrids.verificationGasLimit ??
            (
                verificationGasLimit *
                BigInt((overrids.verificationGasLimitPercentageMultiplier ?? 0) + 100)
            )/100n;
			
		userOperation.callGasLimit =
			overrids.callGasLimit ??
            (
                callGasLimit *
                BigInt((overrids.callGasLimitPercentageMultiplier ?? 0) + 100)
            )/100n;
		
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
			const SignerSignaturePair = wallet.signingKey.sign(
				TypedDataEncoder.hash(
					domain,
					SafeAccountWebAuth.EIP712_SAFE_OPERATION_TYPE,
					SafeUserOperation,
				),
			).serialized;
			signersAddresses.push(wallet.address);
			signatures.push(SignerSignaturePair);
		}

		return SafeAccountWebAuth.formatEip712SignaturesToUseroperationSignature(
			signersAddresses,
			signatures,
			validAfter,
			validUntil,
		);
	}

	public static createWebAuthnSignerVerifierAddress(
		x: bigint,
		y: bigint,
	): string {
		const c2Nonce = 0;
		const initializerCallData = createCallData(
			"0x080fbebf", //setup
			["uint256", "uint256", "address"],
			[x,y,SafeAccountWebAuth.DEFAULT_WEB_AUTHN_VERIFIER],
		);

		const abiCoder = AbiCoder.defaultAbiCoder();
		const salt = keccak256(
			solidityPacked(
				["bytes32", "uint256"],
				[keccak256(initializerCallData), c2Nonce],
			),
		);
		const initData = abiCoder.encode(
			["uint256"], 
			[SafeAccountWebAuth.DEFAULT_SIGNATURE_VALIDATOR]
		);

		const initHash = keccak256(
			solidityPacked(["bytes", "bytes"], [SafeAccountWebAuth.DEFAULT_WEB_AUTHN_SIGNER_CREATION_CODE, initData]),
		);

		const proxyAdd = solidityPackedKeccak256(
			["bytes1", "address", "bytes32", "bytes32"],
			["0xff", SafeAccountWebAuth.DEFAULT_WEB_AUTHN_SIGNER_FACTORY, salt, initHash],
		).slice(-40);

		return "0x" + proxyAdd;
	}

	/**
	 * formate a list of eip712 signatures to a useroperation signature
	 * @param signersAddresses - signers public addresses
	 * @param signatures - list of eip712 signatures
	 * @param validAfter - timestamp the signature will be valid after
	 * @param validUntil - timestamp the signature will be valid until
	 * @returns signature
	 */
	public static formatSignaturesToUseroperationSignature(
		signatures: SignerSignaturePair[],
		isInit:boolean| null = null,
		validAfter: bigint = 0n,
		validUntil: bigint = 0n,
	): string {
		const formatedSignature = SafeAccountWebAuth.buildSignatures(
			signatures, 
			isInit
		)

		return solidityPacked(
			["uint48", "uint48", "bytes"],
			[validAfter, validUntil, formatedSignature],
		);
	}
	
	public static getLowerCaseAddress(signer:Signer):string{
		if(typeof(signer) == "string"){
			return signer.toLowerCase()
		}else{
			return SafeAccountWebAuth.createWebAuthnSignerVerifierAddress(
				signer.x,
				signer.y,
			)
		}
	}

	public static  sortSignatures(signatures: SignerSignaturePair[]){
		signatures.sort((left, right) => SafeAccountWebAuth.getLowerCaseAddress(left.signer).localeCompare(SafeAccountWebAuth.getLowerCaseAddress(right.signer)))
	}

	public static buildSignatures(signatures: SignerSignaturePair[], isInit:boolean| null = null): string{
		SafeAccountWebAuth.sortSignatures(signatures)
		const start = 65 * signatures.length
		const { segments } = signatures.reduce(
		  ({ segments, offset }, { signer, signature, isContractSignature }) => {
			isContractSignature = isContractSignature || (typeof(signer) != "string")
			if(isContractSignature){
				if(typeof(signer) == "string"){
					return {
						segments: [...segments, ethers.solidityPacked(['uint256', 'uint256', 'uint8'], [signer, start + offset, 0])],
						offset: offset + 32 + ethers.dataLength(signature),
					}
				}else{
					if(isInit == null){
						throw RangeError("Must define isInit parameter when using WebAuthn");
					}
					if(isInit){
						signer = SafeAccountWebAuth.DEFAULT_WEB_AUTHN_SIGNATURE_VALIDATOR_SINGLETON
					}else{
						signer = SafeAccountWebAuth.createWebAuthnSignerVerifierAddress(
							signer.x,
							signer.y
						)
					}
					return {
						segments: [...segments, ethers.solidityPacked(['uint256', 'uint256', 'uint8'], [signer, start + offset, 0])],
						offset: offset + 32 + ethers.dataLength(signature),
					}
				}
			}else{
				return {
					segments: [...segments, ethers.solidityPacked(['bytes'], [signature])],
					offset: 0,
				}
			}
		  },
		  { segments: [] as string[], offset: 0 },
		)
		return ethers.concat([
		  ...segments,
		  ...signatures.map(({ signature }) => ethers.solidityPacked(['uint256', 'bytes'], [ethers.dataLength(signature), signature])),
		])
	  }

	public static createWebAuthnSignature(signatureData:WebauthSignatureData):string{
		return ethers.AbiCoder.defaultAbiCoder().encode(
			['bytes', 'bytes', 'uint256[2]'],
			[
				new Uint8Array(signatureData.authenticatorData),
				signatureData.clientDataFields,
				signatureData.rs,
			],
		)	
	}

}
