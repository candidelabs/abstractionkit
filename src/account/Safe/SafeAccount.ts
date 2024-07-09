import {
	AbiCoder,
	TypedDataEncoder,
	keccak256,
	solidityPacked,
	solidityPackedKeccak256,
} from "ethers";
import { SmartAccount } from "../SmartAccount";
import {
	MetaTransaction,
	Operation,
	UserOperation,
} from "../../types";
import {
	createCallData,
	getFunctionSelector,
} from "../../utils";

import {
	SafeModuleExecutorFunctionSelector,
	SafeUserOperationTypedDataDomain,
	SafeUserOperationTypedDataValues,
} from "./types";
import { decodeMultiSendCallData, encodeMultiSendCallData } from "./multisend";
import { AbstractionKitError } from "src/errors";
import { Bundler } from "src/Bundler";
import { SendUseroperationResponse } from "../SendUseroperationResponse";

export class SafeAccount extends SmartAccount {
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
	protected initCode: string | null;

	constructor(
		accountAddress: string,
		safe4337ModuleAddress: string = SafeAccount.DEFAULT_SAFE_4337_MODULE_ADDRESS,
		entrypointAddress: string = SafeAccount.DEFAULT_ENTRYPOINT_ADDRESS,
	) {
		super(accountAddress);
		this.entrypointAddress = entrypointAddress;
		this.safe4337ModuleAddress = safe4337ModuleAddress;
		this.initCode = null;
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
		const executorFunctionCallData = SafeAccount.createAccountCallData(
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
		multisendContractAddress: string = SafeAccount.DEFAULT_MULTISEND_CONTRACT_ADDRESS,
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

		const executorFunctionCallData = SafeAccount.createAccountCallData(
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
		safeModuleExecutorFunctionSelector: SafeModuleExecutorFunctionSelector = SafeAccount.DEFAULT_EXECUTOR_FUCNTION_SELECTOR,
	): string {
		const executorFunctionInputParameters = [to, value, data, operation];
		const callData = createCallData(
			safeModuleExecutorFunctionSelector,
			SafeAccount.executorFunctionInputAbi,
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
	 * adds a token approve call to the call data for a token paymaster
	 * @returns callData
	 */
	public static prependTokenPaymasterApproveToCallDataStatic(
		callData: string,
		tokenAddress: string,
		paymasterAddress: string,
		approveAmount: bigint,
		multisendContractAddress: string = SafeAccount.DEFAULT_MULTISEND_CONTRACT_ADDRESS,
	): string {
		const [to, value, accountCallData, operation] =
			SafeAccount.decodeAccountCallData(callData);
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

		const executorFunctionCallData = SafeAccount.createAccountCallData(
			multisendContractAddress,
			0n,
			multiSendCallData,
			Operation.Delegate,
		);

		return executorFunctionCallData;
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

		return SafeAccount.formatEip712SingleSignatureToUseroperationSignature(
			formatedSignature,
			validAfter,
			validUntil,
		);
	}

	public static getUserOperationEip712Hash(
		useroperation: UserOperation,
		chainId:bigint,
		validAfter: bigint = 0n,
		validUntil: bigint = 0n,
		entrypointAddress: string,
		): string{
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
			entryPoint: entrypointAddress,
		};

		const domain: SafeUserOperationTypedDataDomain = {
			chainId,
			verifyingContract: SafeAccount.DEFAULT_SAFE_4337_MODULE_ADDRESS,
		};

		return TypedDataEncoder.hash(
			domain,
			SafeAccount.EIP712_SAFE_OPERATION_TYPE,
			SafeUserOperation,
		)
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
