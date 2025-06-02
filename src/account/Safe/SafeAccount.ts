import {
	Wallet,
	AbiCoder,
	TypedDataEncoder,
	keccak256,
	solidityPacked,
	solidityPackedKeccak256,
	ethers,
    getAddress
} from "ethers";
import { SmartAccount } from "../SmartAccount";
import {
	BaseUserOperationDummyValues,
	ZeroAddress,
	Safe_L2_V1_4_1,
	ENTRYPOINT_V6,
	ENTRYPOINT_V7,
	EIP712_SAFE_OPERATION_V7_TYPE,
	EIP712_SAFE_OPERATION_V6_TYPE,
} from "../../constants";
import {
	MetaTransaction,
	Operation,
	StateOverrideSet,
	BaseUserOperation,
	UserOperationV6,
	UserOperationV7,
    GasOption,
    PolygonChain,
    OnChainIdentifierParamsType,
    TenderlySimulationResult,
} from "../../types";
import {
	createCallData,
	getFunctionSelector,
	fetchAccountNonce,
	sendEthCallRequest,
	sendEthGetCodeRequest,
    handlefetchGasPrice,
} from "../../utils";

import {
    simulateSenderCallDataWithTenderly,
    simulateSenderCallDataWithTenderlyAndCreateShareLink
} from "../../utilsTenderly";

import {
	CreateBaseUserOperationOverrides,
	Signer,
	SafeUserOperationTypedDataDomain,
	SafeUserOperationV6TypedMessageValue,
	SafeUserOperationV7TypedMessageValue,
	SignerSignaturePair,
	WebauthnSignatureData,
	SafeModuleExecutorFunctionSelector,
	EOADummySignerSignaturePair,
	WebAuthnSignatureOverrides,
	BaseInitOverrides,
    WebauthnDummySignerSignaturePair,
    WebauthnPublicKey,
} from "./types";
import { decodeMultiSendCallData, encodeMultiSendCallData } from "./multisend";
import { AbstractionKitError, ensureError } from "src/errors";
import { Bundler } from "src/Bundler";
import { SendUseroperationResponse } from "../SendUseroperationResponse";
import { SafeAccountFactory } from "src/factory/SafeAccountFactory";

export class SafeAccount extends SmartAccount {
	static readonly DEFAULT_SAFE_SINGLETON = Safe_L2_V1_4_1;

	static readonly DEFAULT_WEB_AUTHN_SHARED_SIGNER: string =
		"0xfD90FAd33ee8b58f32c00aceEad1358e4AFC23f9";
	static readonly DEFAULT_WEB_AUTHN_SIGNER_SINGLETON: string =
		"0x270D7E4a57E6322f336261f3EaE2BADe72E68d72";
	static readonly DEFAULT_WEB_AUTHN_SIGNER_FACTORY: string =
		"0xF7488fFbe67327ac9f37D5F722d83Fc900852Fbf";
	static readonly DEFAULT_WEB_AUTHN_FCLP256_VERIFIER: string =
		"0x445a0683e494ea0c5AF3E83c5159fBE47Cf9e765";
	static readonly DEFAULT_WEB_AUTHN_PRECOMPILE: string =
		"0x0000000000000000000000000000000000000000"; //zero address means no precompile
	static readonly DEFAULT_WEB_AUTHN_SIGNER_PROXY_CREATION_CODE =
		"0x61010060405234801561001157600080fd5b506040516101ee3803806101ee83398101604081905261003091610058565b6001600160a01b0390931660805260a09190915260c0526001600160b01b031660e0526100bc565b6000806000806080858703121561006e57600080fd5b84516001600160a01b038116811461008557600080fd5b60208601516040870151606088015192965090945092506001600160b01b03811681146100b157600080fd5b939692955090935050565b60805160a05160c05160e05160ff6100ef60003960006008015260006031015260006059015260006080015260ff6000f3fe608060408190527f00000000000000000000000000000000000000000000000000000000000000003660b681018290527f000000000000000000000000000000000000000000000000000000000000000060a082018190527f00000000000000000000000000000000000000000000000000000000000000008285018190527f00000000000000000000000000000000000000000000000000000000000000009490939192600082376000806056360183885af490503d6000803e8060c3573d6000fd5b503d6000f3fea2646970667358221220ddd9bb059ba7a6497d560ca97aadf4dbf0476f578378554a50d41c6bb654beae64736f6c63430008180033";

	static readonly DEFAULT_MULTISEND_CONTRACT_ADDRESS =
		"0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526";

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

	protected isInitWebAuthn: boolean;
	protected x: bigint | null = null;
	protected y: bigint | null = null;

	readonly entrypointAddress: string;
	readonly safe4337ModuleAddress: string;
	protected factoryAddress: string | null;
	protected factoryData: string | null;

    readonly onChainIdentifier: string | null;

	constructor(
		accountAddress: string,
		safe4337ModuleAddress: string,
		entrypointAddress: string,
        overrides: {
            onChainIdentifierParams?: OnChainIdentifierParamsType;
            onChainIdentifier?: string;
        } = {}
	) {
		super(accountAddress);
		this.entrypointAddress = entrypointAddress;
		this.safe4337ModuleAddress = safe4337ModuleAddress;
		this.factoryAddress = null;
		this.factoryData = null;

		this.isInitWebAuthn = false;
        
        if(
            overrides.onChainIdentifierParams != null &&
            overrides.onChainIdentifier != null
        ){
			throw RangeError(
                "can't override both onChainIdentifier and onChainIdentifierParams"
            );
        }else if(overrides.onChainIdentifierParams != null){
            this.onChainIdentifier = generateOnChainIdentifier(
                overrides.onChainIdentifierParams.project,
                overrides.onChainIdentifierParams.platform,
                overrides.onChainIdentifierParams.tool,
                overrides.onChainIdentifierParams.toolVersion,
            );
        }else if(overrides.onChainIdentifier != null){
            let onChainIdentifier = overrides.onChainIdentifier;
            if (onChainIdentifier.startsWith("0x")){
                onChainIdentifier = onChainIdentifier.slice(2);
            }
            if(onChainIdentifier.length != 64){
                throw RangeError("onChainIdentifier length must be 64.");
            }
            this.onChainIdentifier = onChainIdentifier;
        }else{
            this.onChainIdentifier = null;
        }
	}

	/**
	 * calculate proxy/account address using initilizer call data
	 * @param initializerCallData from createBaseInitializerCallData
	 * @param overrides - overrides for the default values
	 * @param overrides.c2Nonce - create2 nonce to generate different sender addresses from the same owners
	 * defaults to zero
	 * @param overrides.safeFactoryAddress - safeFactoryAddress, defaults to
	 * SafeAccountFactory.DEFAULT_FACTORY_ADDRESS
	 * @param overrides.singletonInitHash - a hash that includes the singleton address and thr proxy bytecode
	 * keccak256(solidityPacked(["bytes", "bytes"], [proxyByteCode, abiCoder.encode(["uint256"], [singletonAddress])]))
	 * defaults to SafeAccount.DEFAULT_SAFE_SINGLETON.singletonInitHash
	 * @returns proxy/account address
	 */
	public static createProxyAddress(
		initializerCallData: string,
		overrides: {
			c2Nonce?: bigint;
			safeFactoryAddress?: string;
			singletonInitHash?: string;
		} = {},
	): string {
		const c2Nonce = overrides.c2Nonce ?? 0n;
		if (c2Nonce < 0n) {
			throw RangeError("c2Nonce can't be negative");
		}
		const safeFactoryAddress =
			overrides.safeFactoryAddress ??
			SafeAccountFactory.DEFAULT_FACTORY_ADDRESS;
		const singletonInitHash =
			overrides.singletonInitHash ??
			SafeAccount.DEFAULT_SAFE_SINGLETON.singletonInitHash;
		const salt = keccak256(
			solidityPacked(
				["bytes32", "uint256"],
				[keccak256(initializerCallData), c2Nonce],
			),
		);

		const proxyAdd = solidityPackedKeccak256(
			["bytes1", "address", "bytes32", "bytes32"],
			["0xff", safeFactoryAddress, salt, singletonInitHash],
		).slice(-40);

		return getAddress("0x" + proxyAdd);//to checksummed
	}

	/**
	 * encode calldata for a single MetaTransaction to be executed by Safe account
	 * @param metaTransaction - metaTransaction to create calldata for
	 * @param overrides - overrides for the default values
	 * @param overrides.safeModuleExecutorFunctionSelector - select the
	 * executor function, either "executeUserOpWithErrorString" or "executeUserOp"
	 * defaults to "executeUserOpWithErrorString"
	 * @returns calldata
	 */
	public static createAccountCallDataSingleTransaction(
		metaTransaction: MetaTransaction,
		overrides: {
			safeModuleExecutorFunctionSelector?: SafeModuleExecutorFunctionSelector;
		} = {},
	): string {
		const value = metaTransaction.value ?? 0;
		const data = metaTransaction.data ?? "0x";
		const operation = metaTransaction.operation ?? Operation.Call;
		const safeModuleExecutorFunctionSelector =
			overrides.safeModuleExecutorFunctionSelector ??
			SafeAccount.DEFAULT_EXECUTOR_FUCNTION_SELECTOR;
		const executorFunctionCallData = SafeAccount.createAccountCallData(
			metaTransaction.to,
			value,
			data,
			operation,
			{
				safeModuleExecutorFunctionSelector,
			},
		);
		return executorFunctionCallData;
	}

	/**
	 * encode calldata for a list of MetaTransactions to be executed by Safe account
	 * @param metaTransaction - metaTransaction to create calldata for
	 * @param overrides - overrides for the default values
	 * @param overrides.safeModuleExecutorFunctionSelector - select the
	 * executor function, either "executeUserOpWithErrorString" or "executeUserOp"
	 * defaults to "executeUserOpWithErrorString"
	 * @param overrides.multisendContractAddress - defaults to
	 * SafeAccount.DEFAULT_MULTISEND_CONTRACT_ADDRESS
	 * @returns calldata
	 */
	public static createAccountCallDataBatchTransactions(
		metaTransactions: MetaTransaction[],
		overrides: {
			safeModuleExecutorFunctionSelector?: SafeModuleExecutorFunctionSelector;
			multisendContractAddress?: string;
		} = {},
	): string {
		if (metaTransactions.length < 1) {
			throw RangeError("There should be at least one metaTransaction");
		}
		const safeModuleExecutorFunctionSelector =
			overrides.safeModuleExecutorFunctionSelector ??
			SafeAccount.DEFAULT_EXECUTOR_FUCNTION_SELECTOR;
		const multisendContractAddress =
			overrides.multisendContractAddress ??
			SafeAccount.DEFAULT_MULTISEND_CONTRACT_ADDRESS;

		const multiData = encodeMultiSendCallData(metaTransactions);

		const mutisendSelector = "0x8d80ff0a";
		const multiSendCallData = createCallData(
			mutisendSelector,
			["bytes"],
			[multiData],
		);

		const executorFunctionCallData = SafeAccount.createAccountCallData(
			multisendContractAddress,
			0n,
			multiSendCallData,
			Operation.Delegate,
			{
				safeModuleExecutorFunctionSelector,
			},
		);

		return executorFunctionCallData;
	}

	/**
	 * encode calldata to be executed by Safe account
	 * @param to - target address
	 * @param value - amount of natic token to transafer to target address
	 * @param data - calldata
	 * @param operation - either call or delegate call
	 * @param overrides - overrides for the default values
	 * @param overrides.safeModuleExecutorFunctionSelector - select the
	 * executor function, either "executeUserOpWithErrorString" or "executeUserOp"
	 * defaults to "executeUserOpWithErrorString"
	 * @returns callData
	 */
	public static createAccountCallData(
		to: string,
		value: bigint,
		data: string,
		operation: Operation,
		overrides: {
			safeModuleExecutorFunctionSelector?: SafeModuleExecutorFunctionSelector;
		} = {},
	): string {
		const safeModuleExecutorFunctionSelector =
			overrides.safeModuleExecutorFunctionSelector ??
			SafeAccount.DEFAULT_EXECUTOR_FUCNTION_SELECTOR;
		const executorFunctionInputParameters = [to, value, data, operation];
		const callData = createCallData(
			safeModuleExecutorFunctionSelector,
			SafeAccount.executorFunctionInputAbi,
			executorFunctionInputParameters,
		);
		return callData;
	}

	/**
	 * decode calldata to a Metatransaction
	 * @param callData - calldata to decode
	 * @returns [MetaTransaction, SafeModuleExecutorFunctionSelector]
	 */
	public static decodeAccountCallData(
		callData: string,
	): [MetaTransaction, SafeModuleExecutorFunctionSelector] {
		let safeModuleExecutorFunctionSelector: SafeModuleExecutorFunctionSelector | null =
			null;
		if (
			callData.startsWith(
				SafeModuleExecutorFunctionSelector.executeUserOpWithErrorString,
			)
		) {
			safeModuleExecutorFunctionSelector =
				SafeModuleExecutorFunctionSelector.executeUserOpWithErrorString;
		} else if (
			callData.startsWith(SafeModuleExecutorFunctionSelector.executeUserOp)
		) {
			safeModuleExecutorFunctionSelector =
				SafeModuleExecutorFunctionSelector.executeUserOp;
		}
		if (safeModuleExecutorFunctionSelector != null) {
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
			let accountCallDataString;
			if (typeof decodedParams[2] !== "string") {
				accountCallDataString = new TextDecoder().decode(decodedParams[2]);
			} else {
				accountCallDataString = decodedParams[2];
			}

			return [
				{
					to: decodedParams[0] as string,
					value: BigInt(decodedParams[1] as string),
					data: accountCallDataString,
					operation: Number(decodedParams[3]),
				},
				safeModuleExecutorFunctionSelector,
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
	 * adds a token approve call to the call data for a token paymaster
	 * @param callData - calldata to be added to, if after decoding it is not
	 * a multisend transaction, it will be encoded as a multisend transaction
	 * @param tokenAddress - token to add approve for
	 * @param paymasterAddress - paymaster to add approve for
	 * @param approveAmount - amount to add approve for
	 * @param overrides - overrides for the default values
	 * @param overrides.multisendContractAddress - defaults to
	 * SafeAccount.DEFAULT_MULTISEND_CONTRACT_ADDRESS
	 * @returns callData
	 */
	public static prependTokenPaymasterApproveToCallDataStatic(
		callData: string,
		tokenAddress: string,
		paymasterAddress: string,
		approveAmount: bigint,
		overrides: {
			multisendContractAddress?: string;
		} = {},
	): string {
		const multisendContractAddress =
			overrides.multisendContractAddress ??
			SafeAccount.DEFAULT_MULTISEND_CONTRACT_ADDRESS;
		const [metaTransaction, safeModuleExecutorFunctionSelector] =
			SafeAccount.decodeAccountCallData(callData);

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
		if (metaTransaction.data.startsWith(mutisendSelector)) {
			//multisend
			const decodedCalldata = decodeMultiSendCallData(metaTransaction.data);
			multiSendCallDataParams =
				decodedCalldata + encodedApproveMetatransaction.slice(2);
		} else {
			const encodedCallDataMetaTransaction = encodeMultiSendCallData([
				metaTransaction,
			]);
			multiSendCallDataParams =
				encodedCallDataMetaTransaction + encodedApproveMetatransaction.slice(2);
		}
		const multiSendCallData = createCallData(
			mutisendSelector,
			["bytes"],
			[multiSendCallDataParams],
		);

		const executorFunctionCallData = SafeAccount.createAccountCallData(
			multisendContractAddress,
			0n,
			multiSendCallData,
			Operation.Delegate,
			{
				safeModuleExecutorFunctionSelector,
			},
		);

		return executorFunctionCallData;
	}

	/**
	 * formate a list of eip712 signatures to a useroperation signature
	 * @param signersAddresses - signers public addresses
	 * @param signatures - list of eip712 signatures
	 * @param overrides - overrides for the default values
	 * @param overrides.validAfter - timestamp the signature will be valid after
	 * @param overrides.validUntil - timestamp the signature will be valid until
	 * @returns signature
	 */
	public static formatEip712SignaturesToUseroperationSignature(
		signersAddresses: string[],
		signatures: string[],
		overrides: {
			validAfter?: bigint;
			validUntil?: bigint;
		} = {},
	): string {
		if (signersAddresses.length != signatures.length) {
			throw RangeError(
				"signersAddresses and signatures arrays should be the same length",
			);
		}
		const validAfter = overrides.validAfter ?? 0n;
		const validUntil = overrides.validUntil ?? 0n;

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

		return SafeAccount.formatEip712SingleSignatureToUseroperationSignature(
			formatedSignature,
			{
				validAfter,
				validUntil,
			},
		);
	}
    
    /**
	 * create a v0.07 or v0.06 useroperation eip712 data
	 * @param useroperation - useroperation to hash
	 * @param chainId - target chain id
	 * @param overrides - overrides for the default values
	 * @param overrides.validAfter - timestamp the signature will be valid after
	 * @param overrides.validUntil - timestamp the signature will be valid until
	 * @param overrides.entrypoint - target entrypoint
	 * @param overrides.safe4337ModuleAddress - target module address 
	 * @returns useroperation hash
	 */
	protected static getUserOperationEip712Hash(
		useroperation: UserOperationV6 | UserOperationV7,
		chainId: bigint,
		overrides: {
			validAfter?: bigint;
			validUntil?: bigint;
			entrypointAddress?: string;
			safe4337ModuleAddress?: string;
		} = {},
	): string {
		if ("initCode" in useroperation) {
			return SafeAccount.getUserOperationEip712Hash_V6(
				useroperation,
				chainId,
				overrides,
			);
		} else {
			return SafeAccount.getUserOperationEip712Hash_V7(
				useroperation,
				chainId,
				overrides,
			);
		}
	}
    
    /**
	 * create a v0.07 or v0.06 useroperation eip712 data
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
    protected static getUserOperationEip712Data(
		useroperation: UserOperationV6 | UserOperationV7,
		chainId: bigint,
		overrides?: {
			validAfter?: bigint;
			validUntil?: bigint;
			entrypointAddress?: string;
			safe4337ModuleAddress?: string;
		},
	): {
        domain: SafeUserOperationTypedDataDomain,
        types:Record<string, {name: string;type: string;}[]>,
        messageValue: SafeUserOperationV6TypedMessageValue | SafeUserOperationV6TypedMessageValue
    }  {
		if ("initCode" in useroperation) {
			const data = SafeAccount.getUserOperationEip712Data_V6(
				useroperation,
				chainId,
				overrides,
			);
            return {
                domain: data.domain,
                types: data.types,
                messageValue: data.messageValue
            }
		} else {
			const data = SafeAccount.getUserOperationEip712Data_V7(
				useroperation,
				chainId,
				overrides,
			);
            return {
                domain: data.domain,
                types: data.types,
                messageValue: data.messageValue
            }
		}
	}

    /**
	 * create a v0.06 useroperation eip712 data
	 * @param useroperation - useroperation to hash
	 * @param chainId - target chain id
	 * @param overrides - overrides for the default values
	 * @param overrides.validAfter - timestamp the signature will be valid after
	 * @param overrides.validUntil - timestamp the signature will be valid until
	 * @param overrides.entrypoint - target entrypoint
	 * defaults to ENTRYPOINT_V6
	 * @param overrides.safe4337ModuleAddress - defaults to "0xa581c4A4DB7175302464fF3C06380BC3270b4037"
	 * @returns an object containing the typed data domain, type and typed data vales
     * object needed for hashing and signing
	 */
	public static getUserOperationEip712Data_V6(
		useroperation: UserOperationV6,
		chainId: bigint,
		overrides: {
			validAfter?: bigint;
			validUntil?: bigint;
			entrypointAddress?: string;
			safe4337ModuleAddress?: string;
		} = {},
	): {
        domain: SafeUserOperationTypedDataDomain,
        types:Record<string, {name: string;type: string;}[]>,
        messageValue: SafeUserOperationV6TypedMessageValue
    } {
		const validAfter = overrides.validAfter ?? 0n;
		const validUntil = overrides.validUntil ?? 0n;

		const entrypointAddress = overrides.entrypointAddress ?? ENTRYPOINT_V6;
		const safe4337ModuleAddress =
			overrides.safe4337ModuleAddress ??
			"0xa581c4A4DB7175302464fF3C06380BC3270b4037";

		const messageValue: SafeUserOperationV6TypedMessageValue = {
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
			entryPoint: entrypointAddress,
		};

		const domain: SafeUserOperationTypedDataDomain = {
			chainId: Number(chainId),
			verifyingContract: safe4337ModuleAddress,
		};

		return {
			domain,
			types: EIP712_SAFE_OPERATION_V6_TYPE,
			messageValue,
        };
	}


	/**
	 * create a v0.06 useroperation eip712 data
	 * @param useroperation - useroperation to hash
	 * @param chainId - target chain id
	 * @param overrides - overrides for the default values
	 * @param overrides.validAfter - timestamp the signature will be valid after
	 * @param overrides.validUntil - timestamp the signature will be valid until
	 * @param overrides.entrypoint - target entrypoint
	 * defaults to ENTRYPOINT_V6
	 * @param overrides.safe4337ModuleAddress - defaults to "0xa581c4A4DB7175302464fF3C06380BC3270b4037"
	 * @returns useroperation hash
	 */
	public static getUserOperationEip712Hash_V6(
		useroperation: UserOperationV6,
		chainId: bigint,
		overrides: {
			validAfter?: bigint;
			validUntil?: bigint;
			entrypointAddress?: string;
			safe4337ModuleAddress?: string;
		} = {},
	): string {
	    const data = SafeAccount.getUserOperationEip712Data_V6(
            useroperation, chainId, overrides)	
		return TypedDataEncoder.hash(
			data.domain,
			data.types,
			data.messageValue,
		);
	}
    
    /**
	 * create a v0.07 useroperation eip712 hash
	 * @param useroperation - useroperation to hash
	 * @param chainId - target chain id
	 * @param overrides - overrides for the default values
	 * @param overrides.validAfter - timestamp the signature will be valid after
	 * @param overrides.validUntil - timestamp the signature will be valid until
	 * @param overrides.entrypoint - target entrypoint
	 * defaults to ENTRYPOINT_V7
	 * @param overrides.safe4337ModuleAddress - defaults to "0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226"
     * @returns an object containing the typed data domain, type and typed data vales
     * object needed for hashing and signing
	 */
	public static getUserOperationEip712Data_V7(
		useroperation: UserOperationV7,
		chainId: bigint,
		overrides: {
			validAfter?: bigint;
			validUntil?: bigint;
			entrypointAddress?: string;
			safe4337ModuleAddress?: string;
		} = {},
    ): {
        domain: SafeUserOperationTypedDataDomain,
        types:Record<string, {name: string;type: string;}[]>,
        messageValue: SafeUserOperationV6TypedMessageValue
    } {
		const validAfter = overrides.validAfter ?? 0n;
		const validUntil = overrides.validUntil ?? 0n;

		const entrypointAddress = overrides.entrypointAddress ?? ENTRYPOINT_V7;
		const safe4337ModuleAddress =
			overrides.safe4337ModuleAddress ??
			"0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226";

		const abiCoder = AbiCoder.defaultAbiCoder();

		let initCode = "0x";
		if (useroperation.factory != null) {
			initCode = useroperation.factory;
			if (useroperation.factoryData != null) {
				initCode += useroperation.factoryData.slice(2);
			}
		}

		let paymasterAndData = "0x";
		if (useroperation.paymaster != null) {
			paymasterAndData = useroperation.paymaster;
			if (useroperation.paymasterVerificationGasLimit != null) {
				paymasterAndData += abiCoder
					.encode(["uint128"], [useroperation.paymasterVerificationGasLimit])
					.slice(34);
			}
			if (useroperation.paymasterPostOpGasLimit != null) {
				paymasterAndData += abiCoder
					.encode(["uint128"], [useroperation.paymasterPostOpGasLimit])
					.slice(34);
			}
			if (useroperation.paymasterData != null) {
				paymasterAndData += useroperation.paymasterData.slice(2);
			}
		}
		const messageValue: SafeUserOperationV7TypedMessageValue = {
			safe: useroperation.sender,
			nonce: useroperation.nonce,
			initCode: initCode,
			callData: useroperation.callData,
			verificationGasLimit: useroperation.verificationGasLimit,
			callGasLimit: useroperation.callGasLimit,
			preVerificationGas: useroperation.preVerificationGas,
			maxPriorityFeePerGas: useroperation.maxPriorityFeePerGas,
			maxFeePerGas: useroperation.maxFeePerGas,
			paymasterAndData: paymasterAndData,
			validAfter: validAfter,
			validUntil: validUntil,
			entryPoint: entrypointAddress,
		};

		const domain: SafeUserOperationTypedDataDomain = {
			chainId: Number(chainId),
			verifyingContract: safe4337ModuleAddress,
		};
        
        return {
			domain,
			types: EIP712_SAFE_OPERATION_V7_TYPE,
			messageValue,
        };
    }

	/**
	 * create a v0.07 useroperation eip712 hash
	 * @param useroperation - useroperation to hash
	 * @param chainId - target chain id
	 * @param overrides - overrides for the default values
	 * @param overrides.validAfter - timestamp the signature will be valid after
	 * @param overrides.validUntil - timestamp the signature will be valid until
	 * @param overrides.entrypoint - target entrypoint
	 * defaults to ENTRYPOINT_V7
	 * @param overrides.safe4337ModuleAddress - defaults to "0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226"
	 * @returns useroperation hash
	 */
	public static getUserOperationEip712Hash_V7(
		useroperation: UserOperationV7,
		chainId: bigint,
		overrides: {
			validAfter?: bigint;
			validUntil?: bigint;
			entrypointAddress?: string;
			safe4337ModuleAddress?: string;
		} = {},
	): string {
        const data = SafeAccount.getUserOperationEip712Data_V7(
            useroperation, chainId, overrides)	
		return TypedDataEncoder.hash(
			data.domain,
			data.types,
			data.messageValue,
		);
	}

	/**
	 * formate an eip712 signature to a useroperation signature
	 * @param signature - an eip712 signature
	 * @param overrides - overrides for the default values
	 * @param overrides.validAfter - timestamp the signature will be valid after
	 * @param overrides.validUntil - timestamp the signature will be valid until
	 * @returns formated signature
	 */
	public static formatEip712SingleSignatureToUseroperationSignature(
		signature: string,
		overrides: {
			validAfter?: bigint;
			validUntil?: bigint;
		} = {},
	): string {
		const validAfter = overrides.validAfter ?? 0n;
		const validUntil = overrides.validUntil ?? 0n;

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
		userOperation: UserOperationV6 | UserOperationV7,
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

	/**
	 * calculate account address and initcode from owners
	 * @param owners - list of account owners addresses
	 * @param overrides - override values to change the initialization default values
	 * @returns account address ,factory address and factorydata
	 */
	protected static createAccountAddressAndFactoryAddressAndData(
		owners: Signer[],
		overrides: BaseInitOverrides,
		safe4337ModuleAddress: string,
		safeModuleSetupddress: string,
	): [string, string, string] {
		if (owners.length < 1) {
			throw RangeError("There should be at least one owner");
		}
		const initializerCallData = SafeAccount.createBaseInitializerCallData(
			owners,
			overrides.threshold ?? 1,
			safe4337ModuleAddress,
			safeModuleSetupddress,
			overrides.multisendContractAddress ??
				SafeAccount.DEFAULT_MULTISEND_CONTRACT_ADDRESS,
			overrides.webAuthnSharedSigner ??
				SafeAccount.DEFAULT_WEB_AUTHN_SHARED_SIGNER,
			overrides.eip7212WebAuthnPrecompileVerifierForSharedSigner ??
				SafeAccount.DEFAULT_WEB_AUTHN_PRECOMPILE,
			overrides.eip7212WebAuthnContractVerifierForSharedSigner ??
				SafeAccount.DEFAULT_WEB_AUTHN_FCLP256_VERIFIER,
		);

		let safeAccountFactory;
		if (overrides.safeAccountFactoryAddress != null) {
			safeAccountFactory = new SafeAccountFactory(
				overrides.safeAccountFactoryAddress,
			);
		} else {
			safeAccountFactory = new SafeAccountFactory();
		}

		const safeSingleton =
			overrides.safeAccountSingleton ?? SafeAccount.DEFAULT_SAFE_SINGLETON;
		const sender = this.createProxyAddress(initializerCallData, {
			c2Nonce: overrides.c2Nonce ?? 0n,
			safeFactoryAddress: safeAccountFactory.address,
			singletonInitHash: safeSingleton.singletonInitHash,
		});

		const generatorFunctionInputParameters = [
			safeSingleton.singletonAddress,
			initializerCallData,
			overrides.c2Nonce ?? 0n,
		];

		const factoryGeneratorFunctionCallData =
			safeAccountFactory.getFactoryGeneratorFunctionCallData(
				generatorFunctionInputParameters,
			);

		return [
			sender,
			safeAccountFactory.address,
			factoryGeneratorFunctionCallData,
		];
	}

	protected static createBaseInitializerCallData(
		owners: Signer[],
		threshold: number,
		safe4337ModuleAddress: string,
		safeModuleSetupddress: string,
		multisendContractAddress: string = SafeAccount.DEFAULT_MULTISEND_CONTRACT_ADDRESS,
		webAuthnSharedSigner = SafeAccount.DEFAULT_WEB_AUTHN_SHARED_SIGNER,
		eip7212WebAuthnPrecompileVerifierForSharedSigner: string = SafeAccount.DEFAULT_WEB_AUTHN_PRECOMPILE,
		eip7212WebAuthnContractVerifierForSharedSigner: string = SafeAccount.DEFAULT_WEB_AUTHN_FCLP256_VERIFIER,
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
		let isInitWebAuthn = false;
		let initializerFunctionInputParameters;

		const owners_str: string[] = [];
		for (const owner of owners) {
			if (typeof owner != "string") {
				isInitWebAuthn = true;
			} else {
				owners_str.push(owner);
			}
		}

		if (isInitWebAuthn) {
			const safeModuleSetupCallData: MetaTransaction = {
				to: safeModuleSetupddress,
				value: 0n,
				data: enable4337ModuleCallData,
				operation: Operation.Delegate,
			};
			const txs = [];
			txs.push(safeModuleSetupCallData);
			const modOwners = [];

			let numOfWebAuthnOwners = 0;
			for (const owner of owners) {
				if (typeof owner != "string") {
					if (numOfWebAuthnOwners > 0) {
						throw RangeError(
							"Only one WebAuthn owner can be set during initialization",
						);
					}
					const addWebauthnSigner = createCallData(
						"0x0dd9692f", //configure
						["uint256", "uint256", "uint176"],
						[
							owner.x,
							owner.y,
							"0x" +
								eip7212WebAuthnPrecompileVerifierForSharedSigner.slice(-4) +
								eip7212WebAuthnContractVerifierForSharedSigner.slice(2),
						],
					);

					const setSignerCallData: MetaTransaction = {
						to: webAuthnSharedSigner,
						value: 0n,
						data: addWebauthnSigner,
						operation: Operation.Delegate,
					};
					txs.push(setSignerCallData);
					modOwners.push(webAuthnSharedSigner);
					numOfWebAuthnOwners++;
				} else {
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

			initializerFunctionInputParameters = [
				modOwners,
				threshold,
				multisendContractAddress, //to Contract address for optional delegate call during initialization
				multiSendCallData, //Data payload for optional delegate call during initialization
				safe4337ModuleAddress, //fallbackHandler Handler for fallback calls to this contract
				ZeroAddress, //paymentToken (Safe specific, can be ignored)
				0, //payment (Safe specific, can be ignored)
				ZeroAddress, //paymentReceiver (Safe specific, can be ignored)
			];
		} else {
			initializerFunctionInputParameters = [
				owners_str, //_owners
				threshold, //_threshold
				safeModuleSetupddress, //to Contract address for optional delegate call during initialization
				enable4337ModuleCallData, //Data payload for optional delegate call during initialization
				safe4337ModuleAddress, //fallbackHandler Handler for fallback calls to this contract
				ZeroAddress, //paymentToken (Safe specific, can be ignored)
				0, //payment (Safe specific, can be ignored)
				ZeroAddress, //paymentReceiver (Safe specific, can be ignored)
			];
		}

		return createCallData(
			SafeAccount.initializerFunctionSelector,
			SafeAccount.initializerFunctionInputAbi,
			initializerFunctionInputParameters,
		);
	}

	/**
	 * create factory address and factoryData (initcode)
	 * @param owners - list of account owners signers
	 * @param overrides - overrides for the default values
	 * @returns factoryAddress and factoryData
	 */
	protected static createFactoryAddressAndData(
		owners: Signer[],
		overrides: BaseInitOverrides = {},
		safe4337ModuleAddress: string,
		safeModuleSetupddress: string,
	): [string, string] {
		if (owners.length < 1) {
			throw RangeError("There should be at least one owner");
		}
		const threshold = overrides.threshold ?? 1;
		const c2Nonce = overrides.c2Nonce ?? 0;
		if (threshold < 1) {
			throw RangeError("threshold should be at least one");
		}

		if (threshold > owners.length) {
			throw RangeError("threshold can't be larger than number of owners");
		}

		if (c2Nonce < 0n) {
			throw RangeError("c2Nonce can't be negative");
		}

		const initializerCallData = SafeAccount.createBaseInitializerCallData(
			owners,
			overrides.threshold ?? 1,
			safe4337ModuleAddress,
			safeModuleSetupddress,
			overrides.multisendContractAddress ??
				SafeAccount.DEFAULT_MULTISEND_CONTRACT_ADDRESS,
			overrides.webAuthnSharedSigner ??
				SafeAccount.DEFAULT_WEB_AUTHN_SHARED_SIGNER,
			overrides.eip7212WebAuthnPrecompileVerifierForSharedSigner ??
				SafeAccount.DEFAULT_WEB_AUTHN_PRECOMPILE,
			overrides.eip7212WebAuthnContractVerifierForSharedSigner ??
				SafeAccount.DEFAULT_WEB_AUTHN_FCLP256_VERIFIER,
		);

		let safeAccountFactory;
		if (overrides.safeAccountFactoryAddress != null) {
			safeAccountFactory = new SafeAccountFactory(
				overrides.safeAccountFactoryAddress,
			);
		} else {
			safeAccountFactory = new SafeAccountFactory();
		}

		const safeSingleton =
			overrides.safeAccountSingleton ?? SafeAccount.DEFAULT_SAFE_SINGLETON;

		const generatorFunctionInputParameters = [
			safeSingleton.singletonAddress,
			initializerCallData,
			c2Nonce,
		];

		const factoryGeneratorFunctionCallData =
			safeAccountFactory.getFactoryGeneratorFunctionCallData(
				generatorFunctionInputParameters,
			);

		return [safeAccountFactory.address, factoryGeneratorFunctionCallData];
	}

	/**
	 * a non static wrapper function for  prependTokenPaymasterApproveToCallDataStatic
	 * which adds a token approve call to the call data for a token paymaster
	 * @param callData - calldata to be added to, if after decoding it is not
	 * a multisend transaction, it will be encoded as a multisend transaction
	 * @param tokenAddress - token to add approve for
	 * @param paymasterAddress - paymaster to add approve for
	 * @param approveAmount - amount to add approve for
	 * @param overrides - overrides for the default values
	 * @param overrides.multisendContractAddress - defaults to
	 * SafeAccount.DEFAULT_MULTISEND_CONTRACT_ADDRESS
	 * @returns callData
	 */
	public prependTokenPaymasterApproveToCallData(
		callData: string,
		tokenAddress: string,
		paymasterAddress: string,
		approveAmount: bigint,
		overrides: {
			multisendContractAddress?: string;
		} = {},
	): string {
		const multisendContractAddress =
			overrides.multisendContractAddress ??
			SafeAccount.DEFAULT_MULTISEND_CONTRACT_ADDRESS;
		return SafeAccount.prependTokenPaymasterApproveToCallDataStatic(
			callData,
			tokenAddress,
			paymasterAddress,
			approveAmount,
			{
				multisendContractAddress,
			},
		);
	}

	/**
	 * estimate gas limits for a useroperation
	 * @param userOperation - useroperation to estimate gas for
	 * @param bundlerRpc - bundler rpc for gas estimation
	 * @param overrides - overrides for the default values
	 * @param overrides.stateOverrideSet - state override values to set during gs estimation
	 * @param overrides.dummySignerSignaturePairs - list of dummy signers signature pairs
	 * defaults to a single eoa signature
	 * @returns promise with [preVerificationGas, verificationGasLimit, callGasLimit]
	 */
	public async estimateUserOperationGas(
		userOperation: UserOperationV6 | UserOperationV7,
		bundlerRpc: string,
		overrides: {
			stateOverrideSet?: StateOverrideSet;
			dummySignerSignaturePairs?: SignerSignaturePair[];
            expectedSigners?: Signer[];
            webAuthnSharedSigner?: string;
            webAuthnSignerFactory?: string;
            webAuthnSignerSingleton?: string;
            eip7212WebAuthnPrecompileVerifier?: string;
            eip7212WebAuthnContractVerifier?: string;
		} = {},
	): Promise<[bigint, bigint, bigint]> {
        const validAfter = 0xffffffffffffn;
		const validUntil = 0xffffffffffffn;

		if (overrides.dummySignerSignaturePairs != null) {
            if(overrides.expectedSigners != null){
                throw RangeError(
                    "Can't use both dummySignerSignaturePairs and expectedSigners overrides.",
                );
            }
			if (overrides.dummySignerSignaturePairs.length < 1) {
				throw RangeError(
					"Number of dummy signers signature pairs can't be less than 1",
				);
			}
		    userOperation.signature =
				SafeAccount.formatSignaturesToUseroperationSignature(
					overrides.dummySignerSignaturePairs,
					{
						validAfter,
						validUntil,
					},
				);
		} else if (overrides.expectedSigners != null) {
            let initCode;

            if ("initCode" in userOperation) {
                initCode = userOperation.initCode;
            }else{
                initCode = userOperation.factory;
            }
            const isInit = initCode != null && initCode != "0x";
            
            const dummySignerSignaturePairs = SafeAccount.createDummySignerSignaturePairForExpectedSigners(
                overrides.expectedSigners,
                {
                    isInit,
                    webAuthnSharedSigner:overrides.webAuthnSharedSigner,
                    eip7212WebAuthnPrecompileVerifier:overrides.eip7212WebAuthnPrecompileVerifier,
                    eip7212WebAuthnContractVerifier:overrides.eip7212WebAuthnContractVerifier,
                    webAuthnSignerFactory:overrides.webAuthnSignerFactory,
                    webAuthnSignerSingleton:overrides.webAuthnSignerSingleton,
                    validAfter,
                    validUntil,
                }
            )
            userOperation.signature =
                SafeAccount.formatSignaturesToUseroperationSignature(
                    dummySignerSignaturePairs,
                    {
                        validAfter,
                        validUntil,
                    },
                );
		} else if (userOperation.signature.length < 3) {
            userOperation.signature =
                SafeAccount.formatSignaturesToUseroperationSignature(
                    [EOADummySignerSignaturePair],
                    {
                        validAfter,
                        validUntil,
                    },
                );
        }
        
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

		let verificationGasLimit: bigint;
		if (overrides.dummySignerSignaturePairs != null) {
			verificationGasLimit =
				BigInt(estimation.verificationGasLimit) +
				BigInt(overrides.dummySignerSignaturePairs.length) * 55_000n;
		} else {
			verificationGasLimit = BigInt(estimation.verificationGasLimit);
		}

		const callGasLimit = BigInt(estimation.callGasLimit);

		return [preVerificationGas, verificationGasLimit, callGasLimit];
	}

	/**
	 * createBaseUserOperationAndFactoryAddressAndFactoryData will
	 * determine the nonce, fetch the gas prices,
	 * estimate gas limits and return a useroperation to be signed.
	 * you can override all these values using the overrides parameter.
	 * @param transactions - metatransaction list to be encoded
	 * @param providerRpc - node rpc to fetch account nonce and gas prices
	 * @param bundlerRpc - bundler rpc for gas estimation
	 * @param overrides - overrides for the default values
	 * @returns a promise with (base useroperation, factoryAddress, factoryData)
	 */
	protected async createBaseUserOperationAndFactoryAddressAndFactoryData(
		transactions: MetaTransaction[],
		isV06: boolean,
		providerRpc?: string,
		bundlerRpc?: string,
		overrides: CreateBaseUserOperationOverrides = {},
	): Promise<[BaseUserOperation, string | null, string | null]> {
		if (transactions.length < 1) {
			throw RangeError("There should be at least one transaction");
		}
		const webAuthnSharedSigner =
			overrides.webAuthnSharedSigner ??
			SafeAccount.DEFAULT_WEB_AUTHN_SHARED_SIGNER;
		const safeModuleExecutorFunctionSelector =
			overrides.safeModuleExecutorFunctionSelector ??
			SafeAccount.DEFAULT_EXECUTOR_FUCNTION_SELECTOR;
		const multisendContractAddress =
			overrides.multisendContractAddress ??
			SafeAccount.DEFAULT_MULTISEND_CONTRACT_ADDRESS;

		let nonce:bigint | null = null;
		let nonceOp:Promise<bigint> | null = null;

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
					"providerRpc cant't be null if nonce is not overriden",
				);
			}
		} else {
			nonce = overrides.nonce;
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
        let maxFeePerGas = BaseUserOperationDummyValues.maxFeePerGas;
		let maxPriorityFeePerGas =
			BaseUserOperationDummyValues.maxPriorityFeePerGas;

        let gasPriceOp:Promise<[bigint, bigint]> | null = null;
        if (
			overrides.maxFeePerGas == null ||
			overrides.maxPriorityFeePerGas == null
		) {
            gasPriceOp = handlefetchGasPrice(
                providerRpc, overrides.polygonGasStation, overrides.gasLevel
            )
        }
        
        if(gasPriceOp != null && nonceOp != null){
            await Promise.all([nonceOp, gasPriceOp]).then((values) => {
                nonce = values[0];
                [maxFeePerGas, maxPriorityFeePerGas] = values[1]; 
            });
        }else if(gasPriceOp != null){
            [maxFeePerGas, maxPriorityFeePerGas] = await gasPriceOp; 
        }else if(nonceOp != null){
            nonce = await nonceOp;
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

        const eip7212WebAuthnPrecompileVerifier =
            overrides.eip7212WebAuthnPrecompileVerifier ??
            SafeAccount.DEFAULT_WEB_AUTHN_PRECOMPILE;
        const eip7212WebAuthnContractVerifier =
            overrides.eip7212WebAuthnContractVerifier ??
            SafeAccount.DEFAULT_WEB_AUTHN_FCLP256_VERIFIER;
        const webAuthnSignerFactory =
            overrides.webAuthnSignerFactory ??
            SafeAccount.DEFAULT_WEB_AUTHN_SIGNER_FACTORY;
        const webAuthnSignerSingleton =
            overrides.webAuthnSignerSingleton ??
            SafeAccount.DEFAULT_WEB_AUTHN_SIGNER_SINGLETON;

		let factoryAddress: string | null = this.factoryAddress;
		let factoryData: string | null = this.factoryData;
        
        if(nonce == null){
			throw RangeError("failed to determine nonce");
        }
        else if (nonce < 0n) {
			throw RangeError("nonce can't be negative");
		}
        else if (nonce > 0n) {
			factoryAddress = null;
			factoryData = null;
		} 
        else if (this.isInitWebAuthn) { //nonce = 0
			if (this.x == null || this.y == null) {
				throw RangeError(
					"Invalide account initialization with Webauthnn signer." +
						"Webauthnn signer publickey can be null!!",
				);
			}

			const createDeterministicWebAuthnVerifierOwner: MetaTransaction =
				SafeAccount.createDeployWebAuthnVerifierMetaTransaction(
					this.x,
					this.y,
					{
						eip7212WebAuthnPrecompileVerifier,
						eip7212WebAuthnContractVerifier,
						webAuthnSignerFactory,
					},
				);

			const deterministicWebAuthnVerifierAddress =
				SafeAccount.createWebAuthnSignerVerifierAddress(this.x, this.y, {
					eip7212WebAuthnPrecompileVerifier,
					eip7212WebAuthnContractVerifier,
					webAuthnSignerFactory,
					webAuthnSignerSingleton,
				});

			const swapSingletonWithDeterministicWebAuthnVerifierOwnerCallData =
				createCallData(
					"0xe318b52b", //swapOwner
					[
						"address", //prevOwner
						"address", //oldOwner
						"address", //newOwner
					],
					[
						"0x0000000000000000000000000000000000000001", //SENTINEL_OWNERS
						webAuthnSharedSigner,
						deterministicWebAuthnVerifierAddress,
					],
				);

			const swapSingletonWithDeterministicWebAuthnVerifierOwner: MetaTransaction =
				{
					to: this.accountAddress,
					value: 0n,
					data: swapSingletonWithDeterministicWebAuthnVerifierOwnerCallData,
				};

			/*const clearWebauthnSharedSignerCallData = createCallData(
				"0x0dd9692f", //configure
				["uint256", "uint256", "uint176"],
				[0, 0, 0],
			);
            
			const clearWebauthnSharedSigner: MetaTransaction = {
				to: webAuthnSharedSigner,
				value: 0n,
				data: clearWebauthnSharedSignerCallData,
				operation: Operation.Delegate,
			};*/

			transactions = [
				createDeterministicWebAuthnVerifierOwner,
				swapSingletonWithDeterministicWebAuthnVerifierOwner,
				//clearWebauthnSharedSigner,
			].concat(transactions);
		}


		let callData = "0x" as string;
		if (overrides.callData == null) {
			if (transactions.length == 1) {
				callData = SafeAccount.createAccountCallDataSingleTransaction(
					transactions[0],
					{
						safeModuleExecutorFunctionSelector,
					},
				);
			} else {
				callData = SafeAccount.createAccountCallDataBatchTransactions(
					transactions,
					{
						safeModuleExecutorFunctionSelector:
							safeModuleExecutorFunctionSelector,
						multisendContractAddress: multisendContractAddress,
					},
				);
			}
		} else {
			callData = overrides.callData;
		}

        if(this.onChainIdentifier != null){
            callData = callData + this.onChainIdentifier;
        }

		const userOperation = {
			...BaseUserOperationDummyValues,
			sender: this.accountAddress,
			nonce: nonce,
			callData: callData,
			maxFeePerGas: maxFeePerGas,
			maxPriorityFeePerGas: maxPriorityFeePerGas,
		};

		let preVerificationGas = BaseUserOperationDummyValues.preVerificationGas;
		let verificationGasLimit =
			BaseUserOperationDummyValues.verificationGasLimit;
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

				let userOperationToEstimate: UserOperationV6 | UserOperationV7;
				if (isV06) {
					let initCode = "0x";
					if (factoryAddress != null) {
						initCode = factoryAddress;

						if (factoryData != null) {
							initCode += factoryData.slice(2);
						}
					}
					userOperationToEstimate = {
						...userOperation,
						initCode: initCode,
						paymasterAndData: "0x",
					};
				} else {
					userOperationToEstimate = {
						...userOperation,
						factory: factoryAddress,
						factoryData: factoryData,
						paymaster: null,
						paymasterVerificationGasLimit: null,
						paymasterPostOpGasLimit: null,
						paymasterData: null,
					};
				}
                const validAfter = 0xffffffffffffn;
                const validUntil = 0xffffffffffffn;

				let dummySignerSignaturePairs;
				if (overrides.dummySignerSignaturePairs != null) {
                    if(overrides.expectedSigners != null){
                        throw RangeError(
							"Can't use both dummySignerSignaturePairs and expectedSigners overrides.",
						);
                    }
					if (overrides.dummySignerSignaturePairs.length < 1) {
						throw RangeError(
							"Number of dummySignerSignaturePairs can't be less than 1",
						);
					}
					dummySignerSignaturePairs = overrides.dummySignerSignaturePairs;
				} else {
                    if(overrides.expectedSigners == null){
                        dummySignerSignaturePairs = [EOADummySignerSignaturePair];
                    }else{
                        const isInit = factoryAddress != null && factoryAddress != "0x";
                        dummySignerSignaturePairs = SafeAccount.createDummySignerSignaturePairForExpectedSigners(
                            overrides.expectedSigners,
                            {
                                isInit,
                                webAuthnSharedSigner,
                                eip7212WebAuthnPrecompileVerifier,
                                eip7212WebAuthnContractVerifier,
                                webAuthnSignerFactory,
                                webAuthnSignerSingleton,
                                validAfter,
                                validUntil,
                            }
                        )
                    }
				}
				userOperation.signature =
					SafeAccount.formatSignaturesToUseroperationSignature(
						dummySignerSignaturePairs,
						{
							validAfter,
							validUntil,
							webAuthnSharedSigner,
						},
					);

				[preVerificationGas, verificationGasLimit, callGasLimit] =
					await this.estimateUserOperationGas(
						userOperationToEstimate,
						bundlerRpc,
						{
							stateOverrideSet: overrides.state_override_set,
						},
					);
				verificationGasLimit +=
					BigInt(dummySignerSignaturePairs.length) * 55_000n;

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

		return [userOperation, factoryAddress, factoryData];
	}
    
	/**
	 * create a useroperation signature
	 * @param useroperation - useroperation to sign
	 * @param privateKeys - for the signers
	 * @param chainId - target chain id
	 * @param overrides - overrides for the default values
	 * @param overrides.validAfter - timestamp the signature will be valid after
	 * @param overrides.validUntil - timestamp the signature will be valid until
	 * @returns signature
	 */
	public signUserOperation(
		useroperation: UserOperationV6 | UserOperationV7,
		privateKeys: string[],
		chainId: bigint,
		overrides: {
			validAfter?: bigint;
			validUntil?: bigint;
		} = {},
	): string {
		const validAfter = overrides.validAfter ?? 0n;
		const validUntil = overrides.validUntil ?? 0n;

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

		const userOperationEip712Hash = SafeAccount.getUserOperationEip712Hash(
			useroperation,
			chainId,
			{
				validAfter,
				validUntil,
				entrypointAddress: this.entrypointAddress,
				safe4337ModuleAddress: this.safe4337ModuleAddress,
			},
		);

		const signersAddresses = [];
		const signatures = [];
		for (const privateKey of privateKeys) {
			const wallet = new Wallet(privateKey);
			const SignerSignaturePair = wallet.signingKey.sign(
				userOperationEip712Hash,
			).serialized;
			signersAddresses.push(wallet.address);
			signatures.push(SignerSignaturePair);
		}

		return SafeAccount.formatEip712SignaturesToUseroperationSignature(
			signersAddresses,
			signatures,
			{
				validAfter,
				validUntil,
			},
		);
	}

	/**
	 * compute the deterministic address for a webauthn proxy verifier based on a
	 * webauthn public key(x, y)
	 * @param x - webauthn public key x parameter
	 * @param y - webauthn public key y parameter
	 * @param overrides - overrides for the default values
	 * @returns webauthn verifier address
	 */
	public static createWebAuthnSignerVerifierAddress(
		x: bigint,
		y: bigint,
		overrides: {
			eip7212WebAuthnPrecompileVerifier?: string;
			eip7212WebAuthnContractVerifier?: string;
			webAuthnSignerFactory?: string;
			webAuthnSignerSingleton?: string;
		} = {},
	): string {
		const eip7212WebAuthnPrecompileVerifier =
			overrides.eip7212WebAuthnPrecompileVerifier ??
			SafeAccount.DEFAULT_WEB_AUTHN_PRECOMPILE;
		const eip7212WebAuthnContractVerifier =
			overrides.eip7212WebAuthnContractVerifier ??
			SafeAccount.DEFAULT_WEB_AUTHN_FCLP256_VERIFIER;
		const webAuthnSignerFactory =
			overrides.webAuthnSignerFactory ??
			SafeAccount.DEFAULT_WEB_AUTHN_SIGNER_FACTORY;
		const webAuthnSignerSingleton =
			overrides.webAuthnSignerSingleton ??
			SafeAccount.DEFAULT_WEB_AUTHN_SIGNER_SINGLETON;

		if (
			eip7212WebAuthnPrecompileVerifier.length != 42 ||
			eip7212WebAuthnPrecompileVerifier.slice(0, 38) != ZeroAddress.slice(0, 38)
		) {
			throw RangeError(
				"Invalide precompile address. " +
					"It should have the format 0x000000000000000000000000000000000000____",
			);
		}
		const codeHash = keccak256(
			solidityPacked(
				["bytes", "uint256", "uint256", "uint256", "uint256"],
				[
					SafeAccount.DEFAULT_WEB_AUTHN_SIGNER_PROXY_CREATION_CODE,
					webAuthnSignerSingleton,
					x,
					y,
					"0x" +
						eip7212WebAuthnPrecompileVerifier.slice(-4) +
						eip7212WebAuthnContractVerifier.slice(2),
				],
			),
		);

		const proxyAdd = solidityPackedKeccak256(
			["bytes1", "address", "bytes32", "bytes32"],
			[
				"0xff",
				webAuthnSignerFactory,
				"0x0000000000000000000000000000000000000000000000000000000000000000",
				codeHash,
			],
		).slice(-40);

		return "0x" + proxyAdd;
	}

	/**
	 * formate a list of eip712 signatures to a useroperation signature
	 * @param signerSignaturePairs - a list of a pair of a signer and it's signature
	 * @param overrides - overrides for the default values
	 * @returns signature
	 */
	public static formatSignaturesToUseroperationSignature(
		signerSignaturePairs: SignerSignaturePair[],
		overrides: WebAuthnSignatureOverrides = {},
	): string {
		const validAfter = overrides.validAfter ?? 0n;
		const validUntil = overrides.validUntil ?? 0n;

		const formatedSignature = this.buildSignaturesFromSingerSignaturePairs(
			signerSignaturePairs,
			overrides,
		);

		return solidityPacked(
			["uint48", "uint48", "bytes"],
			[validAfter, validUntil, formatedSignature],
		);
	}

	/**
	 * calculate a signer public address lowercase
	 * @param signer - a signer to compute address for
	 * @param overrides - overrides for the default values
	 * @returns signer address
	 */
	public static getSignerLowerCaseAddress(
		signer: Signer,
		overrides: WebAuthnSignatureOverrides = {},
	): string {
		if (typeof signer == "string") {
			return signer.toLowerCase();
		} else {
			const eip7212WebAuthnPrecompileVerifier =
				overrides.eip7212WebAuthnPrecompileVerifier ??
				SafeAccount.DEFAULT_WEB_AUTHN_PRECOMPILE;
			const eip7212WebAuthnContractVerifier =
				overrides.eip7212WebAuthnContractVerifier ??
				SafeAccount.DEFAULT_WEB_AUTHN_FCLP256_VERIFIER;
			const webAuthnSignerFactory =
				overrides.webAuthnSignerFactory ??
				SafeAccount.DEFAULT_WEB_AUTHN_SIGNER_FACTORY;
			const webAuthnSignerSingleton =
				overrides.webAuthnSignerSingleton ??
				SafeAccount.DEFAULT_WEB_AUTHN_SIGNER_SINGLETON;

			return SafeAccount.createWebAuthnSignerVerifierAddress(
				signer.x,
				signer.y,
				{
					eip7212WebAuthnPrecompileVerifier,
					eip7212WebAuthnContractVerifier,
					webAuthnSignerFactory,
					webAuthnSignerSingleton,
				},
			).toLowerCase();
		}
	}

	/**
	 * sorts a list of signerSginaturesPairs in place based on the signer
	 * public address, as the signatures needs to be sorted to be validated
	 * by a safe account
	 * @param signer - a signer to compute address for
	 * @param overrides - overrides for the default values
	 */
	public static sortSignatures(
		signerSignaturePairs: SignerSignaturePair[],
		overrides: WebAuthnSignatureOverrides = {},
	) {
		signerSignaturePairs.sort((left, right) =>
			SafeAccount.getSignerLowerCaseAddress(
				left.signer,
				overrides,
			).localeCompare(
				SafeAccount.getSignerLowerCaseAddress(right.signer, overrides),
			),
		);
	}

	/**
	 * formate a list of eip712 signatures to a safe signature(without the time range)
	 * @param signerSignaturePairs - a list of a pair of a signer and it's signature
	 * @param overrides - overrides for the default values
	 * @returns signature
	 */
	public static buildSignaturesFromSingerSignaturePairs(
		signerSignaturePairs: SignerSignaturePair[],
		webAuthnSignatureOverrides: WebAuthnSignatureOverrides = {},
	): string {
		SafeAccount.sortSignatures(
			signerSignaturePairs,
			webAuthnSignatureOverrides,
		);
		const start = 65 * signerSignaturePairs.length;
		const { segments } = signerSignaturePairs.reduce(
			({ segments, offset }, { signer, signature, isContractSignature }) => {
				isContractSignature = isContractSignature || typeof signer != "string";
				if (isContractSignature) {
					if (typeof signer != "string") { //webauthn signature
                        //check if this is a webAuthn signature to replace 
                        //the signer address with the shared signer address
                        //if init
						if (webAuthnSignatureOverrides.isInit == null) {
							throw RangeError(
								"Must define isInit parameter when using WebAuthn",
							);
						}
						if (webAuthnSignatureOverrides.isInit) {
							const webauthnsharedsigner =
								webAuthnSignatureOverrides.webAuthnSharedSigner ??
								SafeAccount.DEFAULT_WEB_AUTHN_SHARED_SIGNER;
							signer = webauthnsharedsigner;
						} else {
							const eip7212WebAuthnPrecompileVerifier =
								webAuthnSignatureOverrides.eip7212WebAuthnPrecompileVerifier ??
								SafeAccount.DEFAULT_WEB_AUTHN_PRECOMPILE;
							const eip7212WebAuthnContractVerifier =
								webAuthnSignatureOverrides.eip7212WebAuthnContractVerifier ??
								SafeAccount.DEFAULT_WEB_AUTHN_FCLP256_VERIFIER;
							const webAuthnSignerFactory =
								webAuthnSignatureOverrides.webAuthnSignerFactory ??
								SafeAccount.DEFAULT_WEB_AUTHN_SIGNER_FACTORY;
							const webAuthnSignerSingleton =
								webAuthnSignatureOverrides.webAuthnSignerSingleton ??
								SafeAccount.DEFAULT_WEB_AUTHN_SIGNER_SINGLETON;

							signer = SafeAccount.createWebAuthnSignerVerifierAddress(
								signer.x,
								signer.y,
								{
									eip7212WebAuthnPrecompileVerifier,
									eip7212WebAuthnContractVerifier,
									webAuthnSignerFactory,
									webAuthnSignerSingleton,
								},
							);
						}
                    }
                    return {
                        segments: [
                            ...segments,
                            ethers.solidityPacked(
                                ["uint256", "uint256", "uint8"],
                                [signer, start + offset, 0],
                            ),
                        ],
                        offset: offset + 32 + ethers.dataLength(signature),
                    };
				} else {
					return {
						segments: [
							...segments,
							ethers.solidityPacked(["bytes"], [signature]),
						],
						offset: offset,
					};
				}
			},
			{ segments: [] as string[], offset: 0 },
		);
		return ethers.concat([
			...segments,
			...signerSignaturePairs.map(({ signer, signature, isContractSignature }) => {
                    isContractSignature = isContractSignature || typeof signer != "string";
                    if (isContractSignature) {
                        return ethers.solidityPacked(
                            ["uint256", "bytes"],
                            [ethers.dataLength(signature), signature],
                        )
                    }else{
                        //only append signatures if a contract signature
                        return "0x";
                    }
                },
			),
		]);
	}

	/**
	 * encode webauthn signature from WebauthnSignatureData
	 * @param signatureData - signature data to format
	 * @returns formatted signature
	 */
	public static createWebAuthnSignature(
		signatureData: WebauthnSignatureData,
	): string {
		return ethers.AbiCoder.defaultAbiCoder().encode(
			["bytes", "bytes", "uint256[2]"],
			[
				new Uint8Array(signatureData.authenticatorData),
				signatureData.clientDataFields,
				signatureData.rs,
			],
		);
	}

	/**
	 * create a swapOwner metatransaction and create a metatransaction to
	 * deploy a webauthn verifier owner if not deployed and it will automatically
	 * fetch the prevowner needed for the swap
	 * @param nodeRpcUrl - The JSON-RPC API url for the target chain
	 * (to get the prevOwner paramter) and to check if a webauthn newowner verifier 
     * is already deployed.
	 * @param newOwner - newOwner public address
	 * @param oldOwner - oldOwner to replace public address
	 * @param overrides - overrides for the default values
	 * @param overrides.prevOwner - if set, it will be used as the previous owner and
	 * nideRpcUrl won't be used to fetch it
	 * @returns a promise of a list of metaTransactions
	 */
	public async createSwapOwnerMetaTransactions(
		nodeRpcUrl: string,
		newOwner: Signer,
		oldOwner: Signer,
		overrides: {
			prevOwner?: string;
			eip7212WebAuthnPrecompileVerifier?: string;
			eip7212WebAuthnContractVerifier?: string;
			webAuthnSignerFactory?: string;
			webAuthnSignerSingleton?: string;
		} = {},
	): Promise<MetaTransaction[]> {
		let deployNewOwnerSignerMetaTransaction: MetaTransaction | null = null;
		let newOwnerT: string;
		let oldOwnerT: string;

		if (typeof newOwner != "string") {
			newOwnerT = SafeAccount.createWebAuthnSignerVerifierAddress(
				newOwner.x,
				newOwner.y,
				{
					eip7212WebAuthnPrecompileVerifier:
						overrides.eip7212WebAuthnPrecompileVerifier,
					eip7212WebAuthnContractVerifier:
						overrides.eip7212WebAuthnContractVerifier,
					webAuthnSignerFactory: overrides.webAuthnSignerFactory,
					webAuthnSignerSingleton: overrides.webAuthnSignerSingleton,
				},
			);
			const newOwnerCode = await sendEthGetCodeRequest(
				nodeRpcUrl,
				newOwnerT,
				"latest",
			);
			const newOwnerNotDeployed = newOwnerCode.length < 3;
			if (newOwnerNotDeployed) {
				deployNewOwnerSignerMetaTransaction =
					SafeAccount.createDeployWebAuthnVerifierMetaTransaction(
						newOwner.x,
						newOwner.y,
						{
							eip7212WebAuthnPrecompileVerifier:
								overrides.eip7212WebAuthnPrecompileVerifier,
							eip7212WebAuthnContractVerifier:
								overrides.eip7212WebAuthnContractVerifier,
							webAuthnSignerFactory: overrides.webAuthnSignerFactory,
						},
					);
			}
		} else {
			newOwnerT = newOwner;
		}
		if (typeof oldOwner != "string") {
			oldOwnerT = SafeAccount.createWebAuthnSignerVerifierAddress(
				oldOwner.x,
				oldOwner.y,
				{
					eip7212WebAuthnPrecompileVerifier:
						overrides.eip7212WebAuthnPrecompileVerifier,
					eip7212WebAuthnContractVerifier:
						overrides.eip7212WebAuthnContractVerifier,
					webAuthnSignerFactory: overrides.webAuthnSignerFactory,
					webAuthnSignerSingleton: overrides.webAuthnSignerSingleton,
				},
			);
		} else {
			oldOwnerT = oldOwner;
		}

		let prevOwnerT = overrides.prevOwner;
		if (prevOwnerT == null) {
			const owners = await this.getOwners(nodeRpcUrl);
			const oldOwnerIndex = owners.indexOf(oldOwnerT);
			if (oldOwnerIndex == -1) {
				throw RangeError("oldOwner is not a current owner.");
			} else if (oldOwnerIndex == 0) {
				prevOwnerT = "0x0000000000000000000000000000000000000001";
			} else if (oldOwnerIndex > 0) {
				prevOwnerT = owners[oldOwnerIndex - 1];
			} else {
				throw RangeError("Invalid owner index");
			}
		}
		const swapMetaTransaction = this.createStandardSwapOwnerMetaTransaction(
			newOwnerT,
			oldOwnerT,
			prevOwnerT,
		);
		if (deployNewOwnerSignerMetaTransaction == null) {
			return [swapMetaTransaction];
		} else {
			return [deployNewOwnerSignerMetaTransaction, swapMetaTransaction];
		}
	}

	/**
	 * create a removeOwner metatransaction, and fetch the prevowner
	 * needed for the remove
	 * @param nodeRpcUrl - The JSON-RPC API url for the target chain
	 * (to get the prevOwner paramter).
	 * @param ownerToDelete - owner to delete public address
	 * @param threshold - new threshold
	 * @param overrides - overrides for the default values
	 * @param overrides.prevOwner - if set, it will be used as the previous owner and
	 * nideRpcUrl won't be used to fetch it
	 * @returns a promise of a metaTransaction
	 */
	public async createRemoveOwnerMetaTransaction(
		nodeRpcUrl: string,
		ownerToDelete: Signer,
		threshold: number,
		overrides: {
			prevOwner?: string;
			eip7212WebAuthnPrecompileVerifier?: string;
			eip7212WebAuthnContractVerifier?: string;
			webAuthnSignerFactory?: string;
			webAuthnSignerSingleton?: string;
		} = {},
	): Promise<MetaTransaction> {
		let ownerToDeleteT: string;

		if (typeof ownerToDelete != "string") {
			ownerToDeleteT = SafeAccount.createWebAuthnSignerVerifierAddress(
				ownerToDelete.x,
				ownerToDelete.y,
				{
					eip7212WebAuthnPrecompileVerifier:
						overrides.eip7212WebAuthnPrecompileVerifier,
					eip7212WebAuthnContractVerifier:
						overrides.eip7212WebAuthnContractVerifier,
					webAuthnSignerFactory: overrides.webAuthnSignerFactory,
					webAuthnSignerSingleton: overrides.webAuthnSignerSingleton,
				},
			);
		} else {
			ownerToDeleteT = ownerToDelete;
		}

		let prevOwnerT = overrides.prevOwner;
		if (prevOwnerT == null) {
			const owners = await this.getOwners(nodeRpcUrl);
			const ownerToDeleteIndex = owners.indexOf(ownerToDeleteT);
			if (ownerToDeleteIndex == -1) {
				throw RangeError("ownerToDelete is not a current owner.");
			} else if (ownerToDeleteIndex == 0) {
				prevOwnerT = "0x0000000000000000000000000000000000000001";
			} else if (ownerToDeleteIndex > 0) {
				prevOwnerT = owners[ownerToDeleteIndex - 1];
			} else {
				throw RangeError("Invalid owner index");
			}
		}
		return this.createStandardRemoveOwnerMetaTransaction(
			ownerToDeleteT,
			threshold,
			prevOwnerT,
		);
	}

    /**
	 * create an addOwner metatransaction and create a metatransaction to
	 * deploy a webauthn verifier owner if it is not deployed
	 * @param newOwner - newOwner public address
	 * @param threshold - new threshold
	 * @param overrides - overrides for the default values
     * @param overrides.nodeRpcUrl - The JSON-RPC API url for the target chain
	 * (to check if the new webauthn owner is deployed or not).
	 * @returns a promise of a list of metaTransactions
	 */
	public async createAddOwnerWithThresholdMetaTransactions(
		newOwner: Signer,
		threshold: number,
		overrides: {
            nodeRpcUrl?: string,
			eip7212WebAuthnPrecompileVerifier?: string;
			eip7212WebAuthnContractVerifier?: string;
			webAuthnSignerFactory?: string;
			webAuthnSignerSingleton?: string;
		} = {},
	): Promise<MetaTransaction[]> {
		let deployNewOwnerSignerMetaTransaction: MetaTransaction | null = null;
		let newOwnerT: string;

		if (typeof newOwner != "string") {
			newOwnerT = SafeAccount.createWebAuthnSignerVerifierAddress(
				newOwner.x,
				newOwner.y,
				{
					eip7212WebAuthnPrecompileVerifier:
						overrides.eip7212WebAuthnPrecompileVerifier,
					eip7212WebAuthnContractVerifier:
						overrides.eip7212WebAuthnContractVerifier,
					webAuthnSignerFactory: overrides.webAuthnSignerFactory,
					webAuthnSignerSingleton: overrides.webAuthnSignerSingleton,
				},
			);
            if(overrides.nodeRpcUrl == null){
				throw RangeError(
                    "overrides.nodeRpcUrl can't be null if adding a webauthn owner");
            }
			const newOwnerCode = await sendEthGetCodeRequest(
				overrides.nodeRpcUrl,
				newOwnerT,
				"latest",
			);
			const newOwnerNotDeployed = newOwnerCode.length < 3;
			if (newOwnerNotDeployed) {
				deployNewOwnerSignerMetaTransaction =
					SafeAccount.createDeployWebAuthnVerifierMetaTransaction(
						newOwner.x,
						newOwner.y,
						{
							eip7212WebAuthnPrecompileVerifier:
								overrides.eip7212WebAuthnPrecompileVerifier,
							eip7212WebAuthnContractVerifier:
								overrides.eip7212WebAuthnContractVerifier,
							webAuthnSignerFactory: overrides.webAuthnSignerFactory,
						},
					);
			}
		} else {
			newOwnerT = newOwner;
		}
		
        const addMetaTransaction = this.createStandardAddOwnerWithThresholdMetaTransaction(
			newOwnerT,
            threshold
		);
		if (deployNewOwnerSignerMetaTransaction == null) {
			return [addMetaTransaction];
		} else {
			return [deployNewOwnerSignerMetaTransaction, addMetaTransaction];
		}
	}

	/**
	 * create a standard addOwner metatransaction
	 * @param newOwner - newOwner public address
	 * @param threshold - new threshold
	 * @returns a metaTransaction
	 */
	public createStandardAddOwnerWithThresholdMetaTransaction(
		newOwner: string,
		threshold: number,
	): MetaTransaction {
		const functionSelector = "0x0d582f13"; //addOwnerWithThreshold
		const callData = createCallData(
			functionSelector,
			[
				"address", //owner
				"uint256", //_threshold
			],
			[newOwner, threshold],
		);
		return {
			to: this.accountAddress,
			data: callData,
			value: 0n,
		};
	}

	/**
	 * create a standard swapOwner metatransaction
	 * @param newOwner - newOwner public address
	 * @param oldOwner - oldOwner public address
	 * @param prevOwner - prevOwner public address in the owners linked list
	 * @returns a metaTransaction
	 */
	public createStandardSwapOwnerMetaTransaction(
		newOwner: string,
		oldOwner: string,
		prevOwner: string,
	): MetaTransaction {
		const functionSelector = "0xe318b52b"; //swapOwner
		const callData = createCallData(
			functionSelector,
			[
				"address", //prevOwner
				"address", //oldOwner
				"address", //newOwner
			],
			[
				prevOwner, //SENTINEL_OWNERS
				oldOwner,
				newOwner,
			],
		);
		return {
			to: this.accountAddress,
			data: callData,
			value: 0n,
		};
	}

	/**
	 * create a standard removeOwner metatransaction
	 * @param ownerToDelete - owner to delete public address
	 * @param threshold - new threshold
	 * @param prevOwner - prevOwner public address in the owners linked list
	 * @returns a metaTransaction
	 */
	public createStandardRemoveOwnerMetaTransaction(
		ownerToDelete: string,
		threshold: number,
		prevOwner: string,
	): MetaTransaction {
		const functionSelector = "0xf8dc5dd9"; //removeOwner
		const callData = createCallData(
			functionSelector,
			[
				"address", //prevOwner
				"address", //owner
				"uint256", //_threshold
			],
			[
				prevOwner, //SENTINEL_OWNERS
				ownerToDelete,
				threshold,
			],
		);
		return {
			to: this.accountAddress,
			data: callData,
			value: 0n,
		};
	}

	/**
	 * create a deploy webauthn verifier metatransaction
	 * @param x - webauthn public key x parameter
	 * @param y - webauthn public key y parameter
	 * @param overrides - overrides for the default values
	 * @returns a metaTransaction
	 */
	public static createDeployWebAuthnVerifierMetaTransaction(
		x: bigint,
		y: bigint,
		overrides: {
			eip7212WebAuthnPrecompileVerifier?: string;
			eip7212WebAuthnContractVerifier?: string;
			webAuthnSignerFactory?: string;
		} = {},
	): MetaTransaction {
		const eip7212WebAuthnPrecompileVerifier =
			overrides.eip7212WebAuthnPrecompileVerifier ??
			SafeAccount.DEFAULT_WEB_AUTHN_PRECOMPILE;
		const eip7212WebAuthnContractVerifier =
			overrides.eip7212WebAuthnContractVerifier ??
			SafeAccount.DEFAULT_WEB_AUTHN_FCLP256_VERIFIER;
		const webAuthnSignerFactory =
			overrides.webAuthnSignerFactory ??
			SafeAccount.DEFAULT_WEB_AUTHN_SIGNER_FACTORY;

		const createDeterministicWebAuthnVerifierOwnerCallData = createCallData(
			"0x0d2f0489", //createSigner
			["uint256", "uint256", "uint176"],
			[
				x,
				y,
				"0x" +
					eip7212WebAuthnPrecompileVerifier.slice(-4) +
					eip7212WebAuthnContractVerifier.slice(2),
			],
		);

		return {
			to: webAuthnSignerFactory,
			value: 0n,
			data: createDeterministicWebAuthnVerifierOwnerCallData,
		};
	}

	/**
	 * fetches a list of the account owners public addresses
	 * @param nodeRpcUrl - The JSON-RPC API url for the target chain
	 * @returns a promise of a list of owners public addresses
	 */
	public async getOwners(nodeRpcUrl: string): Promise<string[]> {
		const functionSignature = "getOwners()";
		const functionSelector = getFunctionSelector(functionSignature);
		const callData = createCallData(functionSelector, [], []);

		const ethCallParams = {
			to: this.accountAddress,
			data: callData,
		};
		const getOwnersResult = await sendEthCallRequest(
			nodeRpcUrl,
			ethCallParams,
			"latest",
		);

		const abiCoder = AbiCoder.defaultAbiCoder();
		const decodedCalldata = abiCoder.decode(
			["address[]"],
			getOwnersResult,
		);

		return decodedCalldata[0];
	}
    
    /**
	 * fetches a list of the account owners public addresses
	 * @param nodeRpcUrl - The JSON-RPC API url for the target chain
	 * @returns a promise of a list of owners public addresses and
     * next Start of the next page
	 */
	public async getModules(
        nodeRpcUrl: string, 
        overrides: {
			start?: string;
            pageSize?: bigint
		} = {}
    ): Promise<[string[], string]> {
        try{
            let start = overrides.start;
            if(start == null){
                start = "0x0000000000000000000000000000000000000001";
            }
            let pageSize = overrides.pageSize;
            if(pageSize == null){
                pageSize = 10n;
            }

            const callData = createCallData(
                "0xcc2f8452", //getModulesPaginated(address,uint256)
                ["address", "uint256"],
                [start, pageSize]
            );

            const ethCallParams = {
                to: this.accountAddress,
                data: callData,
            };
            const getModulesResult = await sendEthCallRequest(
                nodeRpcUrl,
                ethCallParams,
                "latest",
            );
            if (getModulesResult == "0x"){
                throw new AbstractionKitError(
					"BAD_DATA",
					"getModules retuned an empty result, the target account is " + 
                    "probably not deployed yet.",
				);
            }
            const abiCoder = AbiCoder.defaultAbiCoder();
            const decodedCalldata = abiCoder.decode(
                ["address[]", "address"],
                getModulesResult,
            );
            return [decodedCalldata[0], decodedCalldata[1]];
        }catch (err) {
			const error = ensureError(err);

			throw new AbstractionKitError(
				"BAD_DATA",
				"getModules failed",
				{
					cause: error,
				},
			);
		}
	}

    /**
	 * check if a module is enabled 
	 * @param nodeRpcUrl - The JSON-RPC API url for the target chain
	 * @param moduleAddress - the module address to check if enabled 
	 * @returns a promise of boolean 
	 */
	public async isModuleEnabled(
        nodeRpcUrl: string, moduleAddress: string
    ): Promise<boolean> {
		const functionSignature = "isModuleEnabled(address)";
		const functionSelector = getFunctionSelector(functionSignature);
		const callData = createCallData(
            functionSelector, ["address"], [moduleAddress]);

		const ethCallParams = {
			to: this.accountAddress,
			data: callData,
		};
		const isModuleEnabledResult = await sendEthCallRequest(
			nodeRpcUrl,
			ethCallParams,
			"latest",
		);

		const abiCoder = AbiCoder.defaultAbiCoder();
		const decodedCalldata = abiCoder.decode(
			["bool"],
			isModuleEnabledResult,
		);

		return decodedCalldata[0];
	}
    
    /**
	 * create a list of dummy signer signature pair list based on the expected signers
	 * @param expectedSigners - webauthn public key x parameter
	 * @param webAuthnSignatureOverrides - overrides for the default values
	 * @returns a list of dummy SignerSignaturePair
	 */
	public static createDummySignerSignaturePairForExpectedSigners(
		expectedSigners: Signer[],
		webAuthnSignatureOverrides: WebAuthnSignatureOverrides = {},
    ): SignerSignaturePair[] {
        const signers = [...expectedSigners]; 
        const dummySignerSignatures: SignerSignaturePair[] = [];
        for (let signer of signers){
            let signerSignaturePair: SignerSignaturePair;
            if (typeof signer == "string") {
                signerSignaturePair = EOADummySignerSignaturePair;
            }else{
                if (webAuthnSignatureOverrides.isInit == null) {
                    throw RangeError(
                        "Must define isInit parameter when using WebAuthn",
                    );
                }
                signerSignaturePair = WebauthnDummySignerSignaturePair;
                if (webAuthnSignatureOverrides.isInit) {
                    const webauthnsharedsigner =
                        webAuthnSignatureOverrides.webAuthnSharedSigner ??
                        SafeAccount.DEFAULT_WEB_AUTHN_SHARED_SIGNER;
                    signerSignaturePair.signer = webauthnsharedsigner;
                } else {
                    const eip7212WebAuthnPrecompileVerifier =
                        webAuthnSignatureOverrides.eip7212WebAuthnPrecompileVerifier ??
                        SafeAccount.DEFAULT_WEB_AUTHN_PRECOMPILE;
                    const eip7212WebAuthnContractVerifier =
                        webAuthnSignatureOverrides.eip7212WebAuthnContractVerifier ??
                        SafeAccount.DEFAULT_WEB_AUTHN_FCLP256_VERIFIER;
                    const webAuthnSignerFactory =
                        webAuthnSignatureOverrides.webAuthnSignerFactory ??
                        SafeAccount.DEFAULT_WEB_AUTHN_SIGNER_FACTORY;
                    const webAuthnSignerSingleton =
                        webAuthnSignatureOverrides.webAuthnSignerSingleton ??
                        SafeAccount.DEFAULT_WEB_AUTHN_SIGNER_SINGLETON;

                    signerSignaturePair.signer = SafeAccount.createWebAuthnSignerVerifierAddress(
                        signer.x,
                        signer.y,
                        {
                            eip7212WebAuthnPrecompileVerifier,
                            eip7212WebAuthnContractVerifier,
                            webAuthnSignerFactory,
                            webAuthnSignerSingleton,
                        },
                    );
                }
            }
            dummySignerSignatures.push(signerSignaturePair);
        }
        return dummySignerSignatures;
    }
    
    /**
	 * verify a webauthn signature against a signer and a message hash 
     * @note: this function works by constructing the bytecode of a webatuhn
     * verifying contract proxy that represent the input signer, then overriding
     * an arbitrary address code and caling "isValidSignature" using eth_call 
     * this way we can check a signature even if the verifying contract is not
     * deployed
	 * @param nodeRpcUrl - The JSON-RPC API url for the target chain
	 * @param signer - a signer to check the signature against 
	 * @param messageHash - a messageHash to check the signature against 
	 * @param signature - a webauthn signature to check
	 * @param overrides - overrides for the default values
	 * @returns a promise of boolean - True if a valid signature
	 */
    public static async verifyWebAuthnSignatureForMessageHash(
		nodeRpcUrl: string,
        signer: WebauthnPublicKey,
        messageHash: string, 
        signature: string,
        overrides:{
            eip7212WebAuthnPrecompileVerifier?: string,
            eip7212WebAuthnContractVerifier?: string,
            webAuthnSignerSingleton?: string,
        } = {}
    ):Promise<boolean> {
        if (messageHash.length != 66 || messageHash.slice(0, 2) != "0x") {
			throw RangeError(
			    "Invalide messageHash ,must be a 0x prefixed keccak256 hash.",
			);
		}

        const eip7212WebAuthnPrecompileVerifier =
            overrides.eip7212WebAuthnPrecompileVerifier ??
            SafeAccount.DEFAULT_WEB_AUTHN_PRECOMPILE;
        const eip7212WebAuthnContractVerifier =
            overrides.eip7212WebAuthnContractVerifier ??
            SafeAccount.DEFAULT_WEB_AUTHN_FCLP256_VERIFIER;
        const webAuthnSignerSingleton =
            overrides.webAuthnSignerSingleton ??
            SafeAccount.DEFAULT_WEB_AUTHN_SIGNER_SINGLETON;
        
        if (
			eip7212WebAuthnPrecompileVerifier.length != 42 ||
			eip7212WebAuthnPrecompileVerifier.slice(0, 38) != ZeroAddress.slice(0, 38)
		) {
			throw RangeError(
				"Invalide precompile address. " +
                "It should have the format 0x000000000000000000000000000000000000____",
			);
		}
		const functionSelector = "0x1626ba7e"; //isValidSignature(bytes32,bytes)
		const callData = createCallData(
            functionSelector,
            ["bytes32", "bytes"],
            [messageHash, signature]
        );
        
        const arbitraryAddress = "0x1111111111111111111111111111111111111111";
		const ethCallParams = {
			to: arbitraryAddress,
			data: callData,
		};
        const deployedByteCode = SafeAccount.createSafeWebAuthnSignerProxyDeployedByteCode(
            signer,
            eip7212WebAuthnPrecompileVerifier,
            eip7212WebAuthnContractVerifier,
            webAuthnSignerSingleton
        )

		const isModuleEnabledResult = await sendEthCallRequest(
			nodeRpcUrl,
			ethCallParams,
			"latest",
            {[arbitraryAddress]: {"code": deployedByteCode}}
		);

		const decodedCalldata = AbiCoder.defaultAbiCoder().decode(
			["bool"],
			isModuleEnabledResult,
		);

		return decodedCalldata[0];
    }

    private static createSafeWebAuthnSignerProxyDeployedByteCode(
        signer: WebauthnPublicKey, 
        eip7212WebAuthnPrecompileVerifier: string,
        eip7212WebAuthnContractVerifier: string,
        webAuthnSignerSingleton: string,
    ):string {
		const abiCoder = AbiCoder.defaultAbiCoder();
        const x = abiCoder.encode(["uint256"], [signer.x])
        const y = abiCoder.encode(["uint256"], [signer.y])
        const verifiers = abiCoder.encode(
            ["uint176"],
            [
                "0x" +
				eip7212WebAuthnPrecompileVerifier.slice(-4) +
				eip7212WebAuthnContractVerifier.slice(2),
            ]
        )
        const byteCode = 
            "0x608060408190527f" + verifiers.slice(2) +
            "3660b681018290527f" + y.slice(2) +
            "60a082018190527f" + x.slice(2) + 
            "8285018190527f000000000000000000000000" +
            webAuthnSignerSingleton.slice(2) +
            "9490939192600082376000806056360183885af490503d6000803e8060c3573d6000fd5b503d6000f3fea2646970667358221220ddd9bb059ba7a6497d560ca97aadf4dbf0476f578378554a50d41c6bb654beae64736f6c63430008180033";
        return byteCode;
    }

    /**
     * create MetaTransaction to enable a module
     * @param accountAddress - Safe account to enable the module for
     * @returns a MetaTransaction
     */
    public static createEnableModuleMetaTransaction(
        moduleAddress: string,
        accountAddress: string,
    ):MetaTransaction{
        const callData = createCallData(
            "0x610b5925", //"enableModule(address)"
            ["address"],
            [moduleAddress],
        );
        return {
            to:accountAddress,
            data: callData,
            value: 0n
        }
    }
    
    /**
     * create a standard disable a module MetaTransaction
     * @param moduleAddress - Module to disable
     * @param prevModuleAddress - previous module to moudle to disable 
     * @param accountAddress - Safe account to enable the module for
     * @returns a MetaTransaction
     */
    public async createDisableModuleMetaTransaction(
		nodeRpcUrl: string,
        moduleToDisableAddress: string,
        accountAddress: string,
		overrides: {
			prevModuleAddress?: string;
			modulesStart?: string;
            modulesPageSize?: bigint
		} = {},
    ):Promise<MetaTransaction>{
        try{
            let prevModuleAddressT = overrides.prevModuleAddress;
            if (prevModuleAddressT == null) {
                const [modules, _] = await this.getModules(
                    nodeRpcUrl,
                    {
                        start:overrides.modulesStart,
                        pageSize:overrides.modulesPageSize
                    }
                );
                
                const moduleToDisableIndex = modules.indexOf(moduleToDisableAddress);
                if (moduleToDisableIndex == -1) {
                    throw RangeError(
                        "moduleToDisable " + moduleToDisableAddress +
                        " is not an enabled module."
                    );
                } else if (moduleToDisableIndex == 0) {
                    prevModuleAddressT = "0x0000000000000000000000000000000000000001";
                } else if (moduleToDisableIndex > 0) {
                    prevModuleAddressT = modules[moduleToDisableIndex - 1];
                } else {
                    throw RangeError(
                        "Invalid module index for " + moduleToDisableAddress);
                }
            }
            return SafeAccount.createStandardDisableModuleMetaTransaction(
                moduleToDisableAddress, prevModuleAddressT, accountAddress
            );
        } catch (err) {
			const error = ensureError(err);

			throw new AbstractionKitError(
				"BAD_DATA",
				"createDisableModuleMetaTransaction failed",
				{
					cause: error,
				},
			);
		}
    }

    /**
     * create a standard disable a module MetaTransaction
     * @param moduleAddress - Module to disable
     * @param prevModuleAddress - previous module to moudle to disable 
     * @param accountAddress - Safe account to enable the module for
     * @returns a MetaTransaction
     */
    public static createStandardDisableModuleMetaTransaction(
        moduleAddress: string,
        prevModuleAddress: string,
        accountAddress: string,
    ):MetaTransaction{
        const callData = createCallData(
            "0xe009cfde", //"disableModule(address)"
            ["address", "address"],
            [prevModuleAddress, moduleAddress],
        );
        return {
            to:accountAddress,
            data: callData,
            value: 0n
        }
    }

    async simulateCallDataWithTenderlyAndCreateShareLink(
        tenderlyAccountSlug:string,
        tenderlyProjectSlug:string,
        tenderlyAccessKey: string,
		nodeRpcUrl: string | null = null,
        chainId: bigint,
		metaTransactions: MetaTransaction[],
        blockNumber: bigint | null = null,
        overrides: {
			safeModuleExecutorFunctionSelector?: SafeModuleExecutorFunctionSelector;
			multisendContractAddress?: string;
            callData?: string;
            createShareLink?: boolean;
            isInit?: boolean,
		} = {},
    ): Promise<{
        simulation:TenderlySimulationResult,
        callDataSimulationShareLink?: string,
        accountDeploymentSimulationShareLink?: string,
    }> {
        let isInit:boolean = false;
        if(nodeRpcUrl == null && overrides.isInit == null){
            throw RangeError(
                "nodeRpcUrl and overrides.isInit can't both be null"
            );
        }else if(overrides.isInit == null){
            const accountNonce =
                await fetchAccountNonce(
                    nodeRpcUrl as string,
                    this.entrypointAddress,
                    this.accountAddress,
                )
            isInit = accountNonce == 0n;
        }else{
            isInit = overrides.isInit;
        }

        let callData = "0x" as string;
		if (overrides.callData == null) {
			if (metaTransactions.length == 1) {
				callData = SafeAccount.createAccountCallDataSingleTransaction(
					metaTransactions[0],
					{
						safeModuleExecutorFunctionSelector:overrides.safeModuleExecutorFunctionSelector,
					},
				);
			} else {
				callData = SafeAccount.createAccountCallDataBatchTransactions(
					metaTransactions,
					{
						safeModuleExecutorFunctionSelector:
							overrides.safeModuleExecutorFunctionSelector,
						multisendContractAddress: overrides.multisendContractAddress,
					},
				);
			}
		} else {
			callData = overrides.callData;
		}
        
        const createShareLink = overrides.createShareLink?? true;
        if(createShareLink){
            return await simulateSenderCallDataWithTenderlyAndCreateShareLink(
                tenderlyAccountSlug,
                tenderlyProjectSlug,
                tenderlyAccessKey,
                chainId,
                this.entrypointAddress,
                this.accountAddress,
                callData,
                isInit,
                this.factoryAddress,
                this.factoryData,
                blockNumber
            )
        }else{
            const simulation = await simulateSenderCallDataWithTenderly(
                tenderlyAccountSlug,
                tenderlyProjectSlug,
                tenderlyAccessKey,
                chainId,
                this.entrypointAddress,
                this.accountAddress,
                callData,
                isInit,
                this.factoryAddress,
                this.factoryData,
                blockNumber
            )
            return {simulation};
        }
    }
}

/**
 * generate  Safe on-chain identifier as per https://docs.safe.global/sdk/onchain-tracking
 * @param project - project name
 * @param platform - "Web" or "Mobile" or "Safe App" or "Widget", defaults to "Web".
 * @param tool - tool used, defaults to "abstractionkit"
 * @param toolVersion - tool version, defaults to current abstractionkit version
 * @returns the onchain idenetifier as a hex string (not 0x prefixed)
 */
function generateOnChainIdentifier(
    project: string,
    platform: "Web" | "Mobile" | "Safe App" | "Widget" = "Web",
    tool: string = "abstractionkit",
    toolVersion: string = "0.2.21"
): string {
    const identifierPrefix = '5afe'; // Safe identifier prefix
    const identifierVersion = '00'; // First version
    const projectHash = keccak256("0x" + Buffer.from(project, 'utf8').toString('hex')).slice(-20);
    const platformHash = keccak256("0x" + Buffer.from(platform, 'utf8').toString('hex')).slice(-3);
    const toolHash = keccak256("0x" + Buffer.from(tool, 'utf8').toString('hex')).slice(-3);
    const toolVersionHash = keccak256("0x" + Buffer.from(toolVersion, 'utf8').toString('hex')).slice(-3);
    
    const projectHashEncoded = Buffer.from(projectHash, 'utf8').toString('hex');
    const platformHashEncoded = Buffer.from(platformHash, 'utf8').toString('hex');
    const toolHashEncoded = Buffer.from(toolHash, 'utf8').toString('hex');
    const toolVersionHashEncoded = Buffer.from(toolVersionHash, 'utf8').toString('hex');

    const res = `${identifierPrefix}${identifierVersion}${projectHashEncoded}${platformHashEncoded}${toolHashEncoded}${toolVersionHashEncoded}`;
    return res;
}
