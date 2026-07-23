import {
	concat,
	dataLength,
	decodeAbiParameters,
	encodeAbiParameters,
	getAddress,
	hashTypedData,
	hexlify,
	keccak256,
	privateKeyToAddress,
	signHash,
	solidityPacked,
	solidityPackedKeccak256,
	toUtf8Bytes,
} from "src/ethereUtils";
import {Bundler} from "src/Bundler";
import {AbstractionKitError, ensureError} from "src/errors";
import {SafeAccountFactory} from "src/factory/SafeAccountFactory";
import {invokeSigner, pickScheme} from "src/signer/negotiate";
import type {Signer as AkSigner, SigningScheme, TypedData} from "src/signer/types";
import {JsonRpcNode, type Transport} from "src/transport";
import {
	BaseUserOperationDummyValues,
	EIP712_SAFE_OPERATION_PRIMARY_TYPE,
	EIP712_SAFE_OPERATION_V6_TYPE,
	EIP712_SAFE_OPERATION_V7_TYPE,
	ENTRYPOINT_V6,
	ENTRYPOINT_V7,
	ENTRYPOINT_V9,
	SAFE_FALLBACK_HANDLER_STORAGE_SLOT,
	Safe_L2_V1_4_1,
	ZeroAddress,
} from "../../constants";
import {
	type AbiInputValue,
	type BaseUserOperation,
	type MetaTransaction,
	type OnChainIdentifierParamsType,
	Operation,
	type StateOverrideSet,
	type TenderlySimulationResult,
	type UserOperationV6,
	type UserOperationV7,
	type UserOperationV9,
} from "../../types";
import {createCallData, fetchAccountNonce, getFunctionSelector, handlefetchGasPrice,} from "../../utils";
import {
	simulateSenderCallDataWithTenderly,
	simulateSenderCallDataWithTenderlyAndCreateShareLink,
} from "../../utilsTenderly";
import {SendUseroperationResponse} from "../SendUseroperationResponse";
import {SmartAccount} from "../SmartAccount";
import {decodeMultiSendCallData, encodeMultiSendCallData} from "./multisend";
import {
	getSafeMessageEip712Data,
	type SafeMessageTypedDataDomain,
	type SafeMessageTypedMessageValue,
} from "./safeMessage";
import {
	type BaseInitOverrides,
	type CreateBaseUserOperationOverrides,
	EOADummySignerSignaturePair,
	type SafeAccountSingleton,
	SafeModuleExecutorFunctionSelector,
	type SafeSignatureOptions,
	type SafeUserOperationTypedDataDomain,
	type SafeUserOperationV6TypedMessageValue,
	type SafeUserOperationV7TypedMessageValue,
	type SafeUserOperationV9TypedMessageValue,
	type Signer,
	type SignerSignaturePair,
	WebauthnDummySignerSignaturePair,
	type WebauthnPublicKey,
	type WebauthnSignatureData,
	type WebAuthnSignatureOverrides,
} from "./types";

/**
 * Base implementation shared by all Safe-account variants.
 *
 * Provides the core logic for Safe ERC-4337 accounts: counterfactual address
 * derivation, initializer/factory-data encoding, EIP-712 UserOperation signing,
 * multi-signer aggregation (ECDSA + WebAuthn), module enable/disable helpers,
 * and UserOperation construction. Versioned subclasses
 * ({@link SafeAccountV0_2_0}, {@link SafeAccountV0_3_0},
 * {@link SafeAccountV1_5_0_M_0_3_0}) bind this class to a specific EntryPoint
 * and Safe singleton, and expose version-typed wrappers.
 *
 * Instantiate directly only for an already-deployed account; use a subclass's
 * static `initializeNewAccount` to produce a counterfactual account + factory
 * data for first-time deployment.
 */
export class SafeAccount extends SmartAccount {
	static readonly DEFAULT_WEB_AUTHN_SHARED_SIGNER: string =
		"0xfD90FAd33ee8b58f32c00aceEad1358e4AFC23f9";
	static readonly DEFAULT_WEB_AUTHN_SIGNER_SINGLETON: string =
		"0x270D7E4a57E6322f336261f3EaE2BADe72E68d72";
	static readonly DEFAULT_WEB_AUTHN_SIGNER_FACTORY: string =
		"0xF7488fFbe67327ac9f37D5F722d83Fc900852Fbf";
	// EIP-7212 contract verifier used in the verifier proxy CREATE2 salt and
	// installed as the shared signer's contract verifier at init time.
	// Defaults to FCL P256 because that's what Safe Passkey module v0.2.0
	// shipped — newer modules (v0.2.1+, v1.5.0_M_0.3.0) override with Daimo.
	// FCL has known non-security-critical bugs and is being phased out
	// upstream now that EIP-7951 (precompile) supersedes it.
	static readonly DEFAULT_WEB_AUTHN_CONTRACT_VERIFIER: string =
		"0x445a0683e494ea0c5AF3E83c5159fBE47Cf9e765";
	static readonly DEFAULT_WEB_AUTHN_PRECOMPILE: string =
		"0x0000000000000000000000000000000000000000"; //zero address means no precompile
	static readonly DEFAULT_WEB_AUTHN_SIGNER_PROXY_CREATION_CODE: string =
		"0x61010060405234801561001157600080fd5b506040516101ee3803806101ee83398101604081905261003091610058565b6001600160a01b0390931660805260a09190915260c0526001600160b01b031660e0526100bc565b6000806000806080858703121561006e57600080fd5b84516001600160a01b038116811461008557600080fd5b60208601516040870151606088015192965090945092506001600160b01b03811681146100b157600080fd5b939692955090935050565b60805160a05160c05160e05160ff6100ef60003960006008015260006031015260006059015260006080015260ff6000f3fe608060408190527f00000000000000000000000000000000000000000000000000000000000000003660b681018290527f000000000000000000000000000000000000000000000000000000000000000060a082018190527f00000000000000000000000000000000000000000000000000000000000000008285018190527f00000000000000000000000000000000000000000000000000000000000000009490939192600082376000806056360183885af490503d6000803e8060c3573d6000fd5b503d6000f3fea2646970667358221220ddd9bb059ba7a6497d560ca97aadf4dbf0476f578378554a50d41c6bb654beae64736f6c63430008180033";

	static readonly DEFAULT_MULTISEND_CONTRACT_ADDRESS = "0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526";

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

	readonly safeAccountSingleton: SafeAccountSingleton;
	readonly entrypointAddress: string;
	readonly safe4337ModuleAddress: string;
	protected factoryAddress: string | null;
	protected factoryData: string | null;

	readonly onChainIdentifier: string | null;

	/**
	 * @param accountAddress - On-chain address of the Safe account
	 * @param safe4337ModuleAddress - Address of the Safe 4337 module the account delegates to
	 * @param entrypointAddress - Target EntryPoint address (v0.6 / v0.7 / v0.9)
	 * @param overrides - Optional on-chain-identifier configuration and custom singleton
	 * @param overrides.onChainIdentifierParams - Attribution params for analytics (mutually exclusive with `onChainIdentifier`)
	 * @param overrides.onChainIdentifier - Pre-computed 32-byte identifier hex (no 0x prefix or with 0x)
	 * @param overrides.safeAccountSingleton - Override Safe singleton address + init hash (defaults to Safe L2 v1.4.1)
	 */
	constructor(
		accountAddress: string,
		safe4337ModuleAddress: string,
		entrypointAddress: string,
		overrides: {
			onChainIdentifierParams?: OnChainIdentifierParamsType;
			onChainIdentifier?: string;
			safeAccountSingleton?: SafeAccountSingleton;
		} = {},
	) {
		super(accountAddress);
		this.entrypointAddress = entrypointAddress;
		this.safe4337ModuleAddress = safe4337ModuleAddress;
		this.factoryAddress = null;
		this.factoryData = null;

		this.isInitWebAuthn = false;

		if (overrides.onChainIdentifierParams != null && overrides.onChainIdentifier != null) {
			throw new RangeError("can't override both onChainIdentifier and onChainIdentifierParams");
		} else if (overrides.onChainIdentifierParams != null) {
			this.onChainIdentifier = generateOnChainIdentifier(
				overrides.onChainIdentifierParams.project,
				overrides.onChainIdentifierParams.platform,
				overrides.onChainIdentifierParams.tool,
				overrides.onChainIdentifierParams.toolVersion,
			);
		} else if (overrides.onChainIdentifier != null) {
			let onChainIdentifier = overrides.onChainIdentifier;
			if (onChainIdentifier.startsWith("0x")) {
				onChainIdentifier = onChainIdentifier.slice(2);
			}
			if (onChainIdentifier.length !== 64) {
				throw new RangeError("onChainIdentifier length must be 64.");
			}
			this.onChainIdentifier = onChainIdentifier;
		} else {
			this.onChainIdentifier = null;
		}
		this.safeAccountSingleton = overrides.safeAccountSingleton ?? Safe_L2_V1_4_1;
	}

	/**
	 * calculate proxy/account address using initializer call data
	 * @param initializerCallData from createBaseInitializerCallData
	 * @param overrides - overrides for the default values
	 * @param overrides.c2Nonce - create2 nonce to generate different sender addresses from the same owners
	 * defaults to zero
	 * @param overrides.safeFactoryAddress - safeFactoryAddress, defaults to
	 * SafeAccountFactory.DEFAULT_FACTORY_ADDRESS
	 * @param overrides.singletonInitHash - a hash that includes the singleton address and the proxy bytecode
	 * keccak256(solidityPacked(["bytes", "bytes"], [proxyByteCode, abiCoder.encode(["uint256"], [singletonAddress])]))
	 * defaults to SafeAccount.safeAccountSingleton.singletonInitHash
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
			throw new RangeError("c2Nonce can't be negative");
		}
		const safeFactoryAddress =
			overrides.safeFactoryAddress ?? SafeAccountFactory.DEFAULT_FACTORY_ADDRESS;
		const singletonInitHash = overrides.singletonInitHash ?? Safe_L2_V1_4_1.singletonInitHash;
		const salt = keccak256(
			solidityPacked(["bytes32", "uint256"], [keccak256(initializerCallData), c2Nonce]),
		);

		const proxyAdd = solidityPackedKeccak256(
			["bytes1", "address", "bytes32", "bytes32"],
			["0xff", safeFactoryAddress, salt, singletonInitHash],
		).slice(-40);

		return getAddress(`0x${proxyAdd}`); //to checksummed
	}

	/**
	 * Check whether a Safe account is already deployed at the given address.
	 *
	 * Use this to decide between connecting to an existing account
	 * (`new SafeAccountV0_3_0(address)`) and initializing a new one
	 * (`SafeAccountV0_3_0.initializeNewAccount(owners)`). Once an account is
	 * deployed, the factory data carried by `initializeNewAccount` is no
	 * longer needed and including it would waste gas.
	 *
	 * Note: this only checks whether bytecode exists at `accountAddress`, not
	 * whether the deployed code is actually a Safe or whether its on-chain
	 * configuration matches a given set of owners.
	 *
	 * @param accountAddress - the Safe account address to check
	 * @param nodeRpcUrl - Ethereum JSON-RPC node URL
	 * @returns `true` if bytecode is deployed at `accountAddress`, `false` otherwise
	 *
	 * @example
	 * ```ts
	 * const account = (await SafeAccountV0_3_0.isDeployed(addr, rpc))
	 *   ? new SafeAccountV0_3_0(addr)
	 *   : SafeAccountV0_3_0.initializeNewAccount(owners);
	 * ```
	 */
	public static async isDeployed(
		accountAddress: string,
		nodeRpcUrl: string | Transport | JsonRpcNode,
	): Promise<boolean> {
		const code = await JsonRpcNode.from(nodeRpcUrl).getCode(accountAddress, "latest");
		return code.length > 2;
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
			throw new RangeError("There should be at least one metaTransaction");
		}
		const safeModuleExecutorFunctionSelector =
			overrides.safeModuleExecutorFunctionSelector ??
			SafeAccount.DEFAULT_EXECUTOR_FUCNTION_SELECTOR;
		const multisendContractAddress =
			overrides.multisendContractAddress ?? SafeAccount.DEFAULT_MULTISEND_CONTRACT_ADDRESS;

		const multiData = encodeMultiSendCallData(metaTransactions);

		const mutisendSelector = "0x8d80ff0a";
		const multiSendCallData = createCallData(mutisendSelector, ["bytes"], [multiData]);

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
	 * @param value - amount of native token to transfer to target address
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
		let safeModuleExecutorFunctionSelector: SafeModuleExecutorFunctionSelector | null = null;
		if (callData.startsWith(SafeModuleExecutorFunctionSelector.executeUserOpWithErrorString)) {
			safeModuleExecutorFunctionSelector =
				SafeModuleExecutorFunctionSelector.executeUserOpWithErrorString;
		} else if (callData.startsWith(SafeModuleExecutorFunctionSelector.executeUserOp)) {
			safeModuleExecutorFunctionSelector = SafeModuleExecutorFunctionSelector.executeUserOp;
		}
		if (safeModuleExecutorFunctionSelector != null) {
			const params = `0x${callData.slice(10)}`;
			const decodedParams = decodeAbiParameters<[string, bigint, string | Uint8Array, bigint]>(
				[
					"address", //to
					"uint256", //value
					"bytes", //data
					"uint8", //operation"
				],
				params,
			);
			// decodeAbiParameters returns the "bytes" field as either a hex
			// string or a Uint8Array. UTF-8 decoding the bytes would corrupt
			// any non-text payload (function selectors, addresses, multisend
			// blobs); hex-encode instead so the calldata round-trips.
			const accountCallDataString: string =
				typeof decodedParams[2] === "string" ? decodedParams[2] : hexlify(decodedParams[2]);

			return [
				{
					to: decodedParams[0],
					value: BigInt(decodedParams[1]),
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
			overrides.multisendContractAddress ?? SafeAccount.DEFAULT_MULTISEND_CONTRACT_ADDRESS;
		const [metaTransaction, safeModuleExecutorFunctionSelector] =
			SafeAccount.decodeAccountCallData(callData);

		const approveFunctionSignature = "approve(address,uint256)";
		const approveFunctionSelector = getFunctionSelector(approveFunctionSignature);
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
		const encodedApproveMetatransaction = encodeMultiSendCallData([approveMetatransaction]);

		let multiSendCallDataParams = "";
		const mutisendSelector = "0x8d80ff0a";
		if (metaTransaction.data.startsWith(mutisendSelector)) {
			//multisend
			const decodedCalldata = decodeMultiSendCallData(metaTransaction.data);
			multiSendCallDataParams = encodedApproveMetatransaction + decodedCalldata.slice(2);
		} else {
			const encodedCallDataMetaTransaction = encodeMultiSendCallData([metaTransaction]);
			multiSendCallDataParams =
				encodedApproveMetatransaction + encodedCallDataMetaTransaction.slice(2);
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
	 * @deprecated
	 * format a list of eip712 signatures to a useroperation signature
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
			isMultiChainSignature?: boolean;
			merkleProof?: string;
		} = {},
	): string {
		if (signersAddresses.length !== signatures.length) {
			throw new RangeError("signersAddresses and signatures arrays should be the same length");
		}

		const signersSignatures: SignerSignaturePair[] = [];

		signersAddresses.forEach((signer, index) => {
			signersSignatures.push({
				signer: signer.toLowerCase(),
				signature: signatures[index],
			});
		});

		return SafeAccount.formatSignaturesToUseroperationSignature(signersSignatures, {
			validAfter: overrides.validAfter,
			validUntil: overrides.validUntil,
			isMultiChainSignature: overrides.isMultiChainSignature,
			multiChainMerkleProof: overrides.merkleProof,
		});
	}

	/**
	 * Get the EIP-712 typed data for this account's configured EntryPoint and
	 * Safe 4337 module. Prefer this instance method for manual signing so
	 * custom constructor overrides are carried through automatically.
	 *
	 * @param useroperation - UserOperation to get typed data for
	 * @param chainId - target chain ID
	 * @param overrides - optional validity window and explicit address overrides
	 * @returns Object with domain, types, and messageValue for EIP-712 signing
	 */
	public getUserOperationEip712Data(
		useroperation: UserOperationV6 | UserOperationV7 | UserOperationV9,
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
		messageValue:
			| SafeUserOperationV6TypedMessageValue
			| SafeUserOperationV7TypedMessageValue
			| SafeUserOperationV9TypedMessageValue;
	} {
		return SafeAccount.getUserOperationEip712Data(useroperation, chainId, {
			...overrides,
			entrypointAddress: overrides.entrypointAddress ?? this.entrypointAddress,
			safe4337ModuleAddress: overrides.safe4337ModuleAddress ?? this.safe4337ModuleAddress,
		});
	}

	/**
	 * Hash the EIP-712 typed data for this account's configured EntryPoint and
	 * Safe 4337 module. Prefer this instance method for manual signing so
	 * custom constructor overrides are carried through automatically.
	 *
	 * @param useroperation - UserOperation to hash
	 * @param chainId - target chain ID
	 * @param overrides - optional validity window and explicit address overrides
	 * @returns EIP-712 digest as a hex string
	 */
	public getUserOperationEip712Hash(
		useroperation: UserOperationV6 | UserOperationV7 | UserOperationV9,
		chainId: bigint,
		overrides: {
			validAfter?: bigint;
			validUntil?: bigint;
			entrypointAddress?: string;
			safe4337ModuleAddress?: string;
		} = {},
	): string {
		const data = this.getUserOperationEip712Data(useroperation, chainId, overrides);
		return hashTypedData(data.domain, data.types, data.messageValue);
	}

	/**
	 * Format signer/signature pairs for this account's signature encoding.
	 * Prefer this instance method for manual signing so account-level module
	 * context is applied automatically.
	 *
	 * @param signerSignaturePairs - signer/signature pairs to encode
	 * @param options - optional validity window, multi-chain, module, and WebAuthn encoding overrides
	 * @returns formatted UserOperation signature
	 */
	public formatUserOperationSignature(
		signerSignaturePairs: SignerSignaturePair[],
		options: SafeSignatureOptions & WebAuthnSignatureOverrides = {},
	): string {
		return SafeAccount.formatSignaturesToUseroperationSignature(signerSignaturePairs, {
			...options,
			safe4337ModuleAddress: options.safe4337ModuleAddress ?? this.safe4337ModuleAddress,
		});
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
		useroperation: UserOperationV6 | UserOperationV7 | UserOperationV9,
		chainId: bigint,
		overrides: {
			validAfter?: bigint;
			validUntil?: bigint;
			entrypointAddress?: string;
			safe4337ModuleAddress?: string;
		} = {},
	): string {
		if ("initCode" in useroperation) {
			return SafeAccount.getUserOperationEip712Hash_V6(useroperation, chainId, overrides);
		} else {
			if (overrides.entrypointAddress) {
				if (overrides.entrypointAddress.toLowerCase() === ENTRYPOINT_V9.toLowerCase()) {
					return SafeAccount.getUserOperationEip712Hash_V9(
						useroperation as UserOperationV9,
						chainId,
						overrides,
					);
				} else {
					return SafeAccount.getUserOperationEip712Hash_V7(useroperation, chainId, overrides);
				}
			} else {
				return SafeAccount.getUserOperationEip712Hash_V7(useroperation, chainId, overrides);
			}
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
		useroperation: UserOperationV6 | UserOperationV7 | UserOperationV9,
		chainId: bigint,
		overrides?: {
			validAfter?: bigint;
			validUntil?: bigint;
			entrypointAddress?: string;
			safe4337ModuleAddress?: string;
		},
	): {
		domain: SafeUserOperationTypedDataDomain;
		types: Record<string, { name: string; type: string }[]>;
		messageValue:
			| SafeUserOperationV6TypedMessageValue
			| SafeUserOperationV7TypedMessageValue
			| SafeUserOperationV9TypedMessageValue;
	} {
		if ("initCode" in useroperation) {
			const data = SafeAccount.getUserOperationEip712Data_V6(useroperation, chainId, overrides);
			return {
				domain: data.domain,
				types: data.types,
				messageValue: data.messageValue,
			};
		} else {
			let data:
				| ReturnType<typeof SafeAccount.getUserOperationEip712Data_V7>
				| ReturnType<typeof SafeAccount.getUserOperationEip712Data_V9>;
			if (overrides?.entrypointAddress) {
				if (overrides.entrypointAddress.toLowerCase() === ENTRYPOINT_V9.toLowerCase()) {
					data = SafeAccount.getUserOperationEip712Data_V9(
						useroperation as UserOperationV9,
						chainId,
						overrides,
					);
				} else {
					data = SafeAccount.getUserOperationEip712Data_V7(useroperation, chainId, overrides);
				}
			} else {
				data = SafeAccount.getUserOperationEip712Data_V7(useroperation, chainId, overrides);
			}
			return {
				domain: data.domain,
				types: data.types,
				messageValue: data.messageValue,
			};
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
		domain: SafeUserOperationTypedDataDomain;
		types: Record<string, { name: string; type: string }[]>;
		messageValue: SafeUserOperationV6TypedMessageValue;
	} {
		const validAfter = overrides.validAfter ?? 0n;
		const validUntil = overrides.validUntil ?? 0n;

		const entrypointAddress = overrides.entrypointAddress ?? ENTRYPOINT_V6;
		const safe4337ModuleAddress =
			overrides.safe4337ModuleAddress ?? "0xa581c4A4DB7175302464fF3C06380BC3270b4037";

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
		const data = SafeAccount.getUserOperationEip712Data_V6(useroperation, chainId, overrides);
		return hashTypedData(data.domain, data.types, data.messageValue);
	}

	private static baseGetUserOperationEip712DataV7V8V9(
		useroperation: UserOperationV7,
		chainId: bigint,
		entrypointAddress: string,
		overrides: {
			validAfter?: bigint;
			validUntil?: bigint;
			safe4337ModuleAddress?: string;
			is_v9?: boolean;
		} = {},
	): {
		domain: SafeUserOperationTypedDataDomain;
		types: Record<string, { name: string; type: string }[]>;
		messageValue: SafeUserOperationV6TypedMessageValue;
	} {
		const validAfter = overrides.validAfter ?? 0n;
		const validUntil = overrides.validUntil ?? 0n;

		const safe4337ModuleAddress =
			overrides.safe4337ModuleAddress ?? "0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226";

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
				paymasterAndData += encodeAbiParameters(
					["uint128"],
					[useroperation.paymasterVerificationGasLimit],
				).slice(34);
			}
			if (useroperation.paymasterPostOpGasLimit != null) {
				paymasterAndData += encodeAbiParameters(
					["uint128"],
					[useroperation.paymasterPostOpGasLimit],
				).slice(34);
			}
			if (useroperation.paymasterData != null) {
				const PAYMASTER_SIG_MAGIC = "22e325a297439656";
				if (
					overrides.is_v9 &&
					useroperation.paymasterData.toLowerCase().endsWith(PAYMASTER_SIG_MAGIC)
				) {
					const sigLenHex = useroperation.paymasterData.slice(
						useroperation.paymasterData.length - 16 - 4,
						useroperation.paymasterData.length - 16,
					);
					const sigLen = parseInt(sigLenHex, 16);
					const prefixEnd = useroperation.paymasterData.length - 16 - 4 - sigLen * 2;
					paymasterAndData +=
						useroperation.paymasterData.slice(0, prefixEnd).replaceAll("0x", "") +
						PAYMASTER_SIG_MAGIC;
				} else {
					paymasterAndData += useroperation.paymasterData.slice(2);
				}
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
			paymasterAndData,
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
		domain: SafeUserOperationTypedDataDomain;
		types: Record<string, { name: string; type: string }[]>;
		messageValue: SafeUserOperationV6TypedMessageValue;
	} {
		return SafeAccount.baseGetUserOperationEip712DataV7V8V9(
			useroperation,
			chainId,
			overrides.entrypointAddress ?? ENTRYPOINT_V7,
			overrides,
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
		const data = SafeAccount.getUserOperationEip712Data_V7(useroperation, chainId, overrides);
		return hashTypedData(data.domain, data.types, data.messageValue);
	}

	/**
	 * create a v0.09 useroperation eip712 hash
	 * @param useroperation - useroperation to hash
	 * @param chainId - target chain id
	 * @param overrides - overrides for the default values
	 * @param overrides.validAfter - timestamp the signature will be valid after
	 * @param overrides.validUntil - timestamp the signature will be valid until
	 * @param overrides.entrypoint - target entrypoint
	 * defaults to ENTRYPOINT_V9
	 * @param overrides.safe4337ModuleAddress - defaults to "0xee8005d7e79f9a6829ea61A81Fc2A85055fB2a42"
	 * @returns an object containing the typed data domain, type and typed data vales
	 * object needed for hashing and signing
	 */
	public static getUserOperationEip712Data_V9(
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
		const safe4337ModuleAddress =
			overrides.safe4337ModuleAddress ?? "0xee8005d7e79f9a6829ea61A81Fc2A85055fB2a42";

		return SafeAccount.baseGetUserOperationEip712DataV7V8V9(
			useroperation,
			chainId,
			overrides.entrypointAddress ?? ENTRYPOINT_V9,
			{
				...overrides,
				safe4337ModuleAddress,
				is_v9: true,
			},
		);
	}

	/**
	 * create a v0.09 useroperation eip712 hash
	 * @param useroperation - useroperation to hash
	 * @param chainId - target chain id
	 * @param overrides - overrides for the default values
	 * @param overrides.validAfter - timestamp the signature will be valid after
	 * @param overrides.validUntil - timestamp the signature will be valid until
	 * @param overrides.entrypoint - target entrypoint
	 * defaults to ENTRYPOINT_V9
	 * @param overrides.safe4337ModuleAddress - defaults to "0xE0049883864b20728b76B5cf265765B45162516D"
	 * @returns useroperation hash
	 */
	public static getUserOperationEip712Hash_V9(
		useroperation: UserOperationV9,
		chainId: bigint,
		overrides: {
			validAfter?: bigint;
			validUntil?: bigint;
			entrypointAddress?: string;
			safe4337ModuleAddress?: string;
		} = {},
	): string {
		const data = SafeAccount.getUserOperationEip712Data_V9(useroperation, chainId, overrides);
		return hashTypedData(data.domain, data.types, data.messageValue);
	}

	/**
	 * @deprecated Use `account.formatUserOperationSignature([{ signer, signature }], options)`
	 * when an account instance is available, or
	 * `SafeAccount.formatSignaturesToUseroperationSignature([{ signer, signature }], options)`
	 * for static formatting. For `SafeMultiChainSigAccountV1`, prefer the
	 * instance method so `isMultiChainSignature` is applied automatically; if
	 * using the lower-level static formatter directly, pass
	 * `isMultiChainSignature: true`.
	 *
	 * format an eip712 signature to a useroperation signature
	 * @param signature - an eip712 signature
	 * @param overrides - overrides for the default values
	 * @param overrides.validAfter - timestamp the signature will be valid after
	 * @param overrides.validUntil - timestamp the signature will be valid until
	 * @returns formatted signature
	 */
	public static formatEip712SingleSignatureToUseroperationSignature(
		signature: string,
		overrides: {
			validAfter?: bigint;
			validUntil?: bigint;
			isMultiChainSignature?: boolean;
		} = {},
	): string {
		return SafeAccount.formatSignaturesToUseroperationSignature(
			[
				{
					signer: "0x0000000000000000000000000000000000000000", // any random address
					signature,
				},
			],
			overrides,
		);
	}

	/**
	 * sends a useroperation to a bundler rpc
	 * @param userOperation - useroperation to send
	 * @param bundlerRpc - bundler rpc URL, {@link Transport}, or pre-constructed {@link Bundler}
	 * @returns promise with SendUseroperationResponse
	 */
	public async sendUserOperation(
		userOperation: UserOperationV6 | UserOperationV7 | UserOperationV9,
		bundlerRpc: string | Transport | Bundler,
	): Promise<SendUseroperationResponse> {
		const bundler = Bundler.from(bundlerRpc);
		const sendUserOperationRes = await bundler.sendUserOperation(
			userOperation,
			this.entrypointAddress,
		);

		return new SendUseroperationResponse(sendUserOperationRes, bundler, this.entrypointAddress);
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
		safeModuleSetupAddress: string,
	): [string, string, string] {
		if (owners.length < 1) {
			throw new RangeError("There should be at least one owner");
		}
		const initializerCallData = SafeAccount.createBaseInitializerCallData(
			owners,
			overrides.threshold ?? 1,
			safe4337ModuleAddress,
			safeModuleSetupAddress,
			overrides.multisendContractAddress ?? SafeAccount.DEFAULT_MULTISEND_CONTRACT_ADDRESS,
			overrides.webAuthnSharedSigner ?? SafeAccount.DEFAULT_WEB_AUTHN_SHARED_SIGNER,
			overrides.eip7212WebAuthnPrecompileVerifierForSharedSigner ??
				SafeAccount.DEFAULT_WEB_AUTHN_PRECOMPILE,
			overrides.eip7212WebAuthnContractVerifierForSharedSigner ??
				SafeAccount.DEFAULT_WEB_AUTHN_CONTRACT_VERIFIER,
		);

		let safeAccountFactory: SafeAccountFactory;
		if (overrides.safeAccountFactoryAddress != null) {
			safeAccountFactory = new SafeAccountFactory(overrides.safeAccountFactoryAddress);
		} else {
			safeAccountFactory = new SafeAccountFactory();
		}
		const safeSingleton = overrides.safeAccountSingleton ?? Safe_L2_V1_4_1;
		const sender = SafeAccount.createProxyAddress(initializerCallData, {
			c2Nonce: overrides.c2Nonce ?? 0n,
			safeFactoryAddress: safeAccountFactory.address,
			singletonInitHash: safeSingleton.singletonInitHash,
		});

		const generatorFunctionInputParameters = [
			safeSingleton.singletonAddress,
			initializerCallData,
			overrides.c2Nonce ?? 0n,
		];

		const factoryGeneratorFunctionCallData = safeAccountFactory.getFactoryGeneratorFunctionCallData(
			generatorFunctionInputParameters,
		);

		return [sender, safeAccountFactory.address, factoryGeneratorFunctionCallData];
	}

	protected static createBaseInitializerCallData(
		owners: Signer[],
		threshold: number,
		safe4337ModuleAddress: string,
		safeModuleSetupAddress: string,
		multisendContractAddress: string = SafeAccount.DEFAULT_MULTISEND_CONTRACT_ADDRESS,
		webAuthnSharedSigner = SafeAccount.DEFAULT_WEB_AUTHN_SHARED_SIGNER,
		eip7212WebAuthnPrecompileVerifierForSharedSigner: string = SafeAccount.DEFAULT_WEB_AUTHN_PRECOMPILE,
		eip7212WebAuthnContractVerifierForSharedSigner: string = SafeAccount.DEFAULT_WEB_AUTHN_CONTRACT_VERIFIER,
	): string {
		if (owners.length < 1) {
			throw new RangeError("There should be at least one owner");
		}

		if (threshold < 1) {
			throw new RangeError("threshold should be at least one");
		}

		if (threshold > owners.length) {
			throw new RangeError("threshold can't be larger than number of owners");
		}

		const enable4337ModuleCallData = createCallData(
			"0x8d0dc49f", //enableModules
			["address[]"],
			[[safe4337ModuleAddress]],
		);
		let isInitWebAuthn = false;
		let initializerFunctionInputParameters: AbiInputValue[];

		const owners_str: string[] = [];
		for (const owner of owners) {
			if (typeof owner !== "string") {
				isInitWebAuthn = true;
			} else {
				owners_str.push(owner);
			}
		}

		if (isInitWebAuthn) {
			const safeModuleSetupCallData: MetaTransaction = {
				to: safeModuleSetupAddress,
				value: 0n,
				data: enable4337ModuleCallData,
				operation: Operation.Delegate,
			};
			const txs = [];
			txs.push(safeModuleSetupCallData);
			const modOwners = [];

			let numOfWebAuthnOwners = 0;
			for (const owner of owners) {
				if (typeof owner !== "string") {
					if (numOfWebAuthnOwners > 0) {
						throw new RangeError("Only one WebAuthn owner can be set during initialization");
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
			const multiSendCallData = createCallData(mutisendSelector, ["bytes"], [encodedInit]);

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
				safeModuleSetupAddress, //to Contract address for optional delegate call during initialization
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
		safeModuleSetupAddress: string,
	): [string, string] {
		if (owners.length < 1) {
			throw new RangeError("There should be at least one owner");
		}
		const threshold = overrides.threshold ?? 1;
		const c2Nonce = overrides.c2Nonce ?? 0;
		if (threshold < 1) {
			throw new RangeError("threshold should be at least one");
		}

		if (threshold > owners.length) {
			throw new RangeError("threshold can't be larger than number of owners");
		}

		if (c2Nonce < 0n) {
			throw new RangeError("c2Nonce can't be negative");
		}

		const initializerCallData = SafeAccount.createBaseInitializerCallData(
			owners,
			overrides.threshold ?? 1,
			safe4337ModuleAddress,
			safeModuleSetupAddress,
			overrides.multisendContractAddress ?? SafeAccount.DEFAULT_MULTISEND_CONTRACT_ADDRESS,
			overrides.webAuthnSharedSigner ?? SafeAccount.DEFAULT_WEB_AUTHN_SHARED_SIGNER,
			overrides.eip7212WebAuthnPrecompileVerifierForSharedSigner ??
				SafeAccount.DEFAULT_WEB_AUTHN_PRECOMPILE,
			overrides.eip7212WebAuthnContractVerifierForSharedSigner ??
				SafeAccount.DEFAULT_WEB_AUTHN_CONTRACT_VERIFIER,
		);

		let safeAccountFactory: SafeAccountFactory;
		if (overrides.safeAccountFactoryAddress != null) {
			safeAccountFactory = new SafeAccountFactory(overrides.safeAccountFactoryAddress);
		} else {
			safeAccountFactory = new SafeAccountFactory();
		}

		const safeSingleton = overrides.safeAccountSingleton ?? Safe_L2_V1_4_1;

		const generatorFunctionInputParameters = [
			safeSingleton.singletonAddress,
			initializerCallData,
			c2Nonce,
		];

		const factoryGeneratorFunctionCallData = safeAccountFactory.getFactoryGeneratorFunctionCallData(
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
			overrides.multisendContractAddress ?? SafeAccount.DEFAULT_MULTISEND_CONTRACT_ADDRESS;
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
	 *
	 * The returned verificationGasLimit includes ~55k gas per dummy signer
	 * used for estimation (from dummySignerSignaturePairs, expectedSigners,
	 * or the single-EOA default), compensating for the per-signature
	 * verification cost bundler simulation skips. If the operation already
	 * carries a signature, no compensation is added and the caller is
	 * responsible for it.
	 *
	 * The passed userOperation is not mutated; estimation runs on an
	 * internal copy carrying the dummy signature and zeroed gas fees.
	 * @param userOperation - useroperation to estimate gas for
	 * @param bundlerRpc - bundler rpc for gas estimation
	 * @param overrides - overrides for the default values
	 * @param overrides.stateOverrideSet - state override values to set during gs estimation
	 * @param overrides.dummySignerSignaturePairs - list of dummy signers signature pairs
	 * defaults to a single eoa signature
	 * @returns promise with [preVerificationGas, verificationGasLimit, callGasLimit]
	 */
	public async baseEstimateUserOperationGas(
		userOperation: UserOperationV6 | UserOperationV7,
		bundlerRpc: string | Transport | Bundler,
		overrides: {
			stateOverrideSet?: StateOverrideSet;
			dummySignerSignaturePairs?: SignerSignaturePair[];
			expectedSigners?: Signer[];
			webAuthnSharedSigner?: string;
			webAuthnSignerFactory?: string;
			webAuthnSignerSingleton?: string;
			webAuthnSignerProxyCreationCode?: string;
			eip7212WebAuthnPrecompileVerifier?: string;
			eip7212WebAuthnContractVerifier?: string;
			isMultiChainSignature?: boolean;
		} = {},
	): Promise<[bigint, bigint, bigint]> {
		const validAfter = 0xffffffffffffn;
		const validUntil = 0xffffffffffffn;

		// Derived from the operation's own init fields; the signature encoder
		// needs the init flag and verifier config whenever a dummy pair
		// carries a raw WebauthnPublicKey signer.
		let initCode: string | null;
		if ("initCode" in userOperation) {
			initCode = userOperation.initCode;
		} else {
			initCode = userOperation.factory;
		}
		const isInit = initCode != null && initCode !== "0x";
		const webAuthnSignatureOverrides = {
			isInit,
			webAuthnSharedSigner: overrides.webAuthnSharedSigner,
			eip7212WebAuthnPrecompileVerifier: overrides.eip7212WebAuthnPrecompileVerifier,
			eip7212WebAuthnContractVerifier: overrides.eip7212WebAuthnContractVerifier,
			webAuthnSignerFactory: overrides.webAuthnSignerFactory,
			webAuthnSignerSingleton: overrides.webAuthnSignerSingleton,
			webAuthnSignerProxyCreationCode: overrides.webAuthnSignerProxyCreationCode,
		};

		// Number of dummy signatures this method placed on the estimated
		// operation. Zero when the caller supplied a ready-made signature,
		// in which case the signer count is unknown here and per-signer gas
		// compensation is left to the caller.
		let dummySignersCount = 0;
		let estimationSignature = userOperation.signature;
		if (overrides.dummySignerSignaturePairs != null) {
			if (overrides.expectedSigners != null) {
				throw new RangeError(
					"Can't use both dummySignerSignaturePairs and expectedSigners overrides.",
				);
			}
			if (overrides.dummySignerSignaturePairs.length < 1) {
				throw new RangeError("Number of dummy signers signature pairs can't be less than 1");
			}
			dummySignersCount = overrides.dummySignerSignaturePairs.length;
			estimationSignature = SafeAccount.formatSignaturesToUseroperationSignature(
				overrides.dummySignerSignaturePairs,
				{
					validAfter,
					validUntil,
					isMultiChainSignature: overrides.isMultiChainSignature,
					...webAuthnSignatureOverrides,
				},
			);
		} else if (overrides.expectedSigners != null) {
			const dummySignerSignaturePairs =
				SafeAccount.createDummySignerSignaturePairForExpectedSigners(
					overrides.expectedSigners,
					webAuthnSignatureOverrides,
				);
			dummySignersCount = dummySignerSignaturePairs.length;
			estimationSignature = SafeAccount.formatSignaturesToUseroperationSignature(
				dummySignerSignaturePairs,
				{
					validAfter,
					validUntil,
					isMultiChainSignature: overrides.isMultiChainSignature,
					...webAuthnSignatureOverrides,
				},
			);
		} else if (userOperation.signature.length < 3) {
			dummySignersCount = 1;
			estimationSignature = SafeAccount.formatSignaturesToUseroperationSignature(
				[EOADummySignerSignaturePair],
				{
					validAfter,
					validUntil,
					isMultiChainSignature: overrides.isMultiChainSignature,
				},
			);
		}

		const bundler = Bundler.from(bundlerRpc);

		// Estimate on a shallow copy so the caller's operation is never
		// mutated, even when estimation throws.
		const userOperationToEstimate = {
			...userOperation,
			signature: estimationSignature,
			maxFeePerGas: 0n,
			maxPriorityFeePerGas: 0n,
		};
		const estimation = await bundler.estimateUserOperationGas(
			userOperationToEstimate,
			this.entrypointAddress,
			overrides.stateOverrideSet,
		);

		const preVerificationGas = BigInt(estimation.preVerificationGas);

		// Compensate for per-signer signature verification cost the bundler
		// skips during estimation: dummy signatures short-circuit validation,
		// but Safe iterates owner signatures inside `validateUserOp`, so each
		// real signature pays ~55k gas at inclusion that simulation never
		// paid for.
		const verificationGasLimit =
			BigInt(estimation.verificationGasLimit) + BigInt(dummySignersCount) * 55_000n;

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
		providerRpc?: string | Transport | JsonRpcNode,
		bundlerRpc?: string | Transport | Bundler,
		overrides: CreateBaseUserOperationOverrides = {},
	): Promise<[BaseUserOperation, string | null, string | null]> {
		if (transactions.length < 1) {
			throw new RangeError("There should be at least one transaction");
		}
		const webAuthnSharedSigner =
			overrides.webAuthnSharedSigner ?? SafeAccount.DEFAULT_WEB_AUTHN_SHARED_SIGNER;
		const safeModuleExecutorFunctionSelector =
			overrides.safeModuleExecutorFunctionSelector ??
			SafeAccount.DEFAULT_EXECUTOR_FUCNTION_SELECTOR;
		const multisendContractAddress =
			overrides.multisendContractAddress ?? SafeAccount.DEFAULT_MULTISEND_CONTRACT_ADDRESS;

		let nonce: bigint | null = null;
		let nonceOp: Promise<bigint> | null = null;

		if (overrides.nonce == null) {
			if (providerRpc != null) {
				nonceOp = fetchAccountNonce(providerRpc, this.entrypointAddress, this.accountAddress);
			} else {
				throw new AbstractionKitError(
					"BAD_DATA",
					"providerRpc can't be null if nonce is not overridden",
				);
			}
		} else {
			nonce = overrides.nonce;
		}

		if (typeof overrides.maxFeePerGas === "bigint" && overrides.maxFeePerGas < 0n) {
			throw new RangeError("maxFeePerGas overrid can't be negative");
		}

		if (typeof overrides.maxPriorityFeePerGas === "bigint" && overrides.maxPriorityFeePerGas < 0n) {
			throw new RangeError("maxPriorityFeePerGas overrid can't be negative");
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

		maxFeePerGas =
			overrides.maxFeePerGas ??
			(maxFeePerGas * BigInt((overrides.maxFeePerGasPercentageMultiplier ?? 0) + 100)) / 100n;
		maxPriorityFeePerGas =
			overrides.maxPriorityFeePerGas ??
			(maxPriorityFeePerGas *
				BigInt((overrides.maxPriorityFeePerGasPercentageMultiplier ?? 0) + 100)) /
				100n;

		const eip7212WebAuthnPrecompileVerifier =
			overrides.eip7212WebAuthnPrecompileVerifier ?? SafeAccount.DEFAULT_WEB_AUTHN_PRECOMPILE;
		const eip7212WebAuthnContractVerifier =
			overrides.eip7212WebAuthnContractVerifier ?? SafeAccount.DEFAULT_WEB_AUTHN_CONTRACT_VERIFIER;
		const webAuthnSignerFactory =
			overrides.webAuthnSignerFactory ?? SafeAccount.DEFAULT_WEB_AUTHN_SIGNER_FACTORY;
		const webAuthnSignerSingleton =
			overrides.webAuthnSignerSingleton ?? SafeAccount.DEFAULT_WEB_AUTHN_SIGNER_SINGLETON;
		const webAuthnSignerProxyCreationCode =
			overrides.webAuthnSignerProxyCreationCode ??
			SafeAccount.DEFAULT_WEB_AUTHN_SIGNER_PROXY_CREATION_CODE;

		let factoryAddress: string | null = this.factoryAddress;
		let factoryData: string | null = this.factoryData;

		if (nonce == null) {
			throw new RangeError("failed to determine nonce");
		} else if (nonce < 0n) {
			throw new RangeError("nonce can't be negative");
		} else if (nonce > 0n) {
			factoryAddress = null;
			factoryData = null;
		} else if (this.isInitWebAuthn) {
			//nonce = 0
			if (this.x == null || this.y == null) {
				throw new RangeError(
					"Invalid account initialization with Webauthn signer." +
						"Webauthn signer publickey can be null!!",
				);
			}

			const createDeterministicWebAuthnVerifierOwner: MetaTransaction =
				SafeAccount.createDeployWebAuthnVerifierMetaTransaction(this.x, this.y, {
					eip7212WebAuthnPrecompileVerifier,
					eip7212WebAuthnContractVerifier,
					webAuthnSignerFactory,
				});

			const deterministicWebAuthnVerifierAddress = SafeAccount.createWebAuthnSignerVerifierAddress(
				this.x,
				this.y,
				{
					eip7212WebAuthnPrecompileVerifier,
					eip7212WebAuthnContractVerifier,
					webAuthnSignerFactory,
					webAuthnSignerSingleton,
					webAuthnSignerProxyCreationCode,
				},
			);

			const swapSingletonWithDeterministicWebAuthnVerifierOwnerCallData = createCallData(
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

			const swapSingletonWithDeterministicWebAuthnVerifierOwner: MetaTransaction = {
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
			if (transactions.length === 1) {
				callData = SafeAccount.createAccountCallDataSingleTransaction(transactions[0], {
					safeModuleExecutorFunctionSelector,
				});
			} else {
				callData = SafeAccount.createAccountCallDataBatchTransactions(transactions, {
					safeModuleExecutorFunctionSelector: safeModuleExecutorFunctionSelector,
					multisendContractAddress: multisendContractAddress,
				});
			}
		} else {
			callData = overrides.callData;
		}

		if (this.onChainIdentifier != null) {
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
		let verificationGasLimit = BaseUserOperationDummyValues.verificationGasLimit;
		let callGasLimit = BaseUserOperationDummyValues.callGasLimit;

		// Build the dummy signature up-front and attach it to the user operation
		// so the returned op always carries a valid placeholder signature
		// whether gas estimation runs below or is skipped.
		const validAfter = 0xffffffffffffn;
		const validUntil = 0xffffffffffffn;

		const isInit = factoryAddress != null && factoryAddress !== "0x";
		let dummySignerSignaturePairs: SignerSignaturePair[];
		if (overrides.dummySignerSignaturePairs != null) {
			if (overrides.expectedSigners != null) {
				throw new RangeError(
					"Can't use both dummySignerSignaturePairs and expectedSigners overrides.",
				);
			}
			if (overrides.dummySignerSignaturePairs.length < 1) {
				throw new RangeError("Number of dummySignerSignaturePairs can't be less than 1");
			}
			dummySignerSignaturePairs = overrides.dummySignerSignaturePairs;
		} else {
			if (overrides.expectedSigners == null) {
				dummySignerSignaturePairs = [EOADummySignerSignaturePair];
			} else {
				dummySignerSignaturePairs = SafeAccount.createDummySignerSignaturePairForExpectedSigners(
					overrides.expectedSigners,
					{
						isInit,
						webAuthnSharedSigner,
						eip7212WebAuthnPrecompileVerifier,
						eip7212WebAuthnContractVerifier,
						webAuthnSignerFactory,
						webAuthnSignerSingleton,
						webAuthnSignerProxyCreationCode,
					},
				);
			}
		}
		userOperation.signature = SafeAccount.formatSignaturesToUseroperationSignature(
			dummySignerSignaturePairs,
			{
				validAfter,
				validUntil,
				isMultiChainSignature: overrides.isMultiChainSignature,
				// needed when user-supplied dummySignerSignaturePairs contain raw
				// WebauthnPublicKey signers — the encoder requires the init flag,
				// and for deployed accounts derives the per-owner verifier
				// address from the verifier config
				isInit,
				webAuthnSharedSigner,
				eip7212WebAuthnPrecompileVerifier,
				eip7212WebAuthnContractVerifier,
				webAuthnSignerFactory,
				webAuthnSignerSingleton,
				webAuthnSignerProxyCreationCode,
			},
		);

		const skipGasEstimation = overrides.skipGasEstimation ?? false;

		if (
			!skipGasEstimation &&
			(overrides.preVerificationGas == null ||
				overrides.verificationGasLimit == null ||
				overrides.callGasLimit == null)
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

					const parallelPaymasterInitValues = overrides.parallelPaymasterInitValues;
					if (parallelPaymasterInitValues != null) {
						// lowercase like the EIP-712 trimmer and the MultiChain
						// subclass — uppercase hex is valid input
						if (
							!parallelPaymasterInitValues.paymasterData
								.toLowerCase()
								.endsWith("22e325a297439656")
						) {
							throw new RangeError(
								"Invalid paymasterData override, it must end with the PAYMASTER_SIG_MAGIC '22e325a297439656'.",
							);
						}
						if (this.entrypointAddress.toLowerCase() !== ENTRYPOINT_V9.toLowerCase()) {
							throw new RangeError("parallelPaymasterInitValues only works with ep v0.9");
						}
						userOperationToEstimate.paymaster = parallelPaymasterInitValues.paymaster;
						userOperationToEstimate.paymasterVerificationGasLimit =
							parallelPaymasterInitValues.paymasterVerificationGasLimit;
						userOperationToEstimate.paymasterPostOpGasLimit =
							parallelPaymasterInitValues.paymasterPostOpGasLimit;
						userOperationToEstimate.paymasterData = parallelPaymasterInitValues.paymasterData;
					}
				}

				[preVerificationGas, verificationGasLimit, callGasLimit] =
					await this.baseEstimateUserOperationGas(userOperationToEstimate, bundlerRpc, {
						stateOverrideSet: overrides.state_override_set,
						isMultiChainSignature: overrides.isMultiChainSignature,
					});
				// Compensate for per-signer signature verification cost the
				// bundler skips during `eth_estimateUserOperationGas`:
				// estimation runs with dummy signatures whose signature paths
				// are short-circuited (dummies don't recover to real owners,
				// so the bundler bypasses signature validation). Safe iterates
				// owner signatures inside `validateUserOp`, so each real
				// signature pays ~55k gas at inclusion that simulation never
				// paid for. The same pattern (without the per-signer
				// multiplier) appears in Simple7702 and Calibur.
				verificationGasLimit += BigInt(dummySignerSignaturePairs.length) * 55_000n;

				userOperation.maxFeePerGas = inputMaxFeePerGas;
				userOperation.maxPriorityFeePerGas = inputMaxPriorityFeePerGas;
			} else {
				throw new AbstractionKitError(
					"BAD_DATA",
					"bundlerRpc can't be null if preVerificationGas," +
						"verificationGasLimit and callGasLimit are not overridden",
				);
			}
		}
		if (typeof overrides.preVerificationGas === "bigint" && overrides.preVerificationGas < 0n) {
			throw new RangeError("preVerificationGas overrid can't be negative");
		}

		if (typeof overrides.verificationGasLimit === "bigint" && overrides.verificationGasLimit < 0n) {
			throw new RangeError("verificationGasLimit overrid can't be negative");
		}

		if (typeof overrides.callGasLimit === "bigint" && overrides.callGasLimit < 0n) {
			throw new RangeError("callGasLimit overrid can't be negative");
		}

		userOperation.preVerificationGas =
			overrides.preVerificationGas ??
			(preVerificationGas * BigInt((overrides.preVerificationGasPercentageMultiplier ?? 0) + 100)) /
				100n;

		userOperation.verificationGasLimit =
			overrides.verificationGasLimit ??
			(verificationGasLimit *
				BigInt((overrides.verificationGasLimitPercentageMultiplier ?? 0) + 100)) /
				100n;

		userOperation.callGasLimit =
			overrides.callGasLimit ??
			(callGasLimit * BigInt((overrides.callGasLimitPercentageMultiplier ?? 0) + 100)) / 100n;

		return [userOperation, factoryAddress, factoryData];
	}

	/**
	 * create a useroperation signature
	 * @param useroperation - useroperation to sign
	 * @param privateKeys - for the signers
	 * @param chainId - target chain id
	 * @param entrypointAddress - target EntryPoint
	 * @param safe4337ModuleAddress - Safe 4337 module
	 * @param options - per-call signing options (timing, multi-chain encoding, module address) — passed through to {@link formatSignaturesToUseroperationSignature}
	 * @returns signature
	 */
	protected static baseSignSingleUserOperation(
		useroperation: UserOperationV6 | UserOperationV7,
		privateKeys: string[],
		chainId: bigint,
		entrypointAddress: string,
		safe4337ModuleAddress: string,
		options: SafeSignatureOptions = {},
	): string {
		const validAfter = options.validAfter ?? 0n;
		const validUntil = options.validUntil ?? 0n;
		const moduleAddress = options.safe4337ModuleAddress ?? safe4337ModuleAddress;

		if (privateKeys.length < 1) {
			throw new RangeError("There should be at least one privateKey");
		}
		if (chainId < 0n) {
			throw new RangeError("chainId can't be negative");
		}
		if (validAfter < 0n) {
			throw new RangeError("validAfter can't be negative");
		}
		if (validUntil < 0n) {
			throw new RangeError("validUntil can't be negative");
		}

		const userOperationEip712Hash = SafeAccount.getUserOperationEip712Hash(useroperation, chainId, {
			validAfter,
			validUntil,
			entrypointAddress,
			safe4337ModuleAddress: moduleAddress,
		});

		const signerSignaturePairs: SignerSignaturePair[] = [];
		for (const privateKey of privateKeys) {
			const signature = signHash(privateKey, userOperationEip712Hash).serialized;
			signerSignaturePairs.push({
				signer: privateKeyToAddress(privateKey),
				signature,
			});
		}

		return SafeAccount.formatSignaturesToUseroperationSignature(
			signerSignaturePairs,
			{ ...options, validAfter, validUntil },
		);
	}

	/**
	 * Schemes Safe accepts from a {@link Signer}, in preference order.
	 * `typedData` is preferred because wallets can display structured fields
	 * rather than a hex blob; `hash` is accepted as a fallback for signers
	 * that only support raw ECDSA.
	 */
	public static readonly ACCEPTED_SIGNING_SCHEMES: readonly SigningScheme[] = ["typedData", "hash"];

	/**
	 * Sign a UserOperation using one or more {@link Signer}s. This is the
	 * capability-oriented signing path: each signer declares what it can do
	 * (`signHash`, `signTypedData`, both) and the account picks the best
	 * match per signer. Incompatible signers fail offline with an actionable
	 * error rather than a silent bundler rejection.
	 *
	 * Signers are invoked in parallel. For interactive wallets that share a
	 * popup session, sequence the prompts inside your Signer implementation.
	 *
	 * @param useroperation - UserOperation to sign
	 * @param signers - Signer instances (`fromViem(account)`, `fromEthersWallet(wallet)`, etc.)
	 * @param chainId - target chain id
	 * @param params - bag combining required wiring (`entrypointAddress`,
	 *   `safe4337ModuleAddress`, `context`) with optional `options`
	 *   ({@link SafeSignatureOptions}: timing, multi-chain encoding,
	 *   module address).
	 *   Both flow through to {@link formatSignaturesToUseroperationSignature}.
	 * @returns formatted signature
	 */
	protected static async baseSignUserOperationWithSigners<
		T extends UserOperationV6 | UserOperationV7 | UserOperationV9,
		C,
	>(
		useroperation: T,
		signers: ReadonlyArray<AkSigner<C>>,
		chainId: bigint,
		params: {
			entrypointAddress: string;
			safe4337ModuleAddress: string;
			context: C;
			options?: SafeSignatureOptions;
		},
	): Promise<string> {
		const {
			entrypointAddress,
			safe4337ModuleAddress,
			context,
			options = {},
		} = params;
		const validAfter = options.validAfter ?? 0n;
		const validUntil = options.validUntil ?? 0n;
		const moduleAddress = options.safe4337ModuleAddress ?? safe4337ModuleAddress;

		if (signers.length < 1) {
			throw new RangeError("There should be at least one signer");
		}

		const typedDataRaw = SafeAccount.getUserOperationEip712Data(useroperation, chainId, {
			validAfter,
			validUntil,
			entrypointAddress,
			safe4337ModuleAddress: moduleAddress,
		});
		const userOpHash = hashTypedData(
			typedDataRaw.domain,
			typedDataRaw.types,
			typedDataRaw.messageValue,
		) as `0x${string}`;

		// Strip EIP712Domain; every downstream signTypedData API rejects it
		// when it appears alongside the primary type.
		const { EIP712Domain: _drop, ...primaryTypes } = typedDataRaw.types as Record<
			string,
			{ name: string; type: string }[]
		>;
		const typedData: TypedData = {
			domain: typedDataRaw.domain as TypedData["domain"],
			types: primaryTypes,
			primaryType: EIP712_SAFE_OPERATION_PRIMARY_TYPE,
			// SafeUserOperationVxTypedMessageValue has fixed fields, not an
			// index signature, so TS rejects a direct cast to Record. Route
			// through `unknown` to acknowledge the structural conversion.
			message: typedDataRaw.messageValue as unknown as Record<string, unknown>,
		};

		// Preflight: validate + checksum every signer's address before
		// calling any signer. Catches malformed addresses offline instead
		// of after an external signer (HSM, hardware wallet) has already
		// been prompted.
		const normalizedAddresses = signers.map((signer) => getAddress(signer.address));

		// Offline capability check: throws with an actionable message if
		// any signer can't produce what Safe accepts.
		const schemes = signers.map((signer, signerIndex) =>
			pickScheme(signer, SafeAccount.ACCEPTED_SIGNING_SCHEMES, {
				accountName: "Safe (EIP-712 or raw hash over SafeOp digest)",
				signerIndex,
			}),
		);

		const signatures = await Promise.all(
			signers.map((signer, i) =>
				invokeSigner(signer, schemes[i], {
					hash: userOpHash,
					typedData,
					context,
				}),
			),
		);

		const signerSignaturePairs = signatures.map((signature, i) => ({
			signer: normalizedAddresses[i],
			signature,
			isContractSignature: signers[i].type === "contract",
		}));

		return SafeAccount.formatSignaturesToUseroperationSignature(
			signerSignaturePairs,
			{ ...options, validAfter, validUntil },
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
			webAuthnSignerProxyCreationCode?: string;
		} = {},
	): string {
		const eip7212WebAuthnPrecompileVerifier =
			overrides.eip7212WebAuthnPrecompileVerifier ?? SafeAccount.DEFAULT_WEB_AUTHN_PRECOMPILE;
		const eip7212WebAuthnContractVerifier =
			overrides.eip7212WebAuthnContractVerifier ?? SafeAccount.DEFAULT_WEB_AUTHN_CONTRACT_VERIFIER;
		const webAuthnSignerFactory =
			overrides.webAuthnSignerFactory ?? SafeAccount.DEFAULT_WEB_AUTHN_SIGNER_FACTORY;
		const webAuthnSignerSingleton =
			overrides.webAuthnSignerSingleton ?? SafeAccount.DEFAULT_WEB_AUTHN_SIGNER_SINGLETON;

		if (
			eip7212WebAuthnPrecompileVerifier.length !== 42 ||
			eip7212WebAuthnPrecompileVerifier.slice(0, 38) !== ZeroAddress.slice(0, 38)
		) {
			throw new RangeError(
				"Invalid precompile address. " +
					"It should have the format 0x000000000000000000000000000000000000____",
			);
		}
		const codeHash = keccak256(
			solidityPacked(
				["bytes", "uint256", "uint256", "uint256", "uint256"],
				[
					overrides.webAuthnSignerProxyCreationCode ??
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

		return getAddress(`0x${proxyAdd}`); //to checksummed
	}

	/**
	 * format a list of eip712 signatures to a useroperation signature
	 * @param signerSignaturePairs - a list of a pair of a signer and it's signature
	 * @param options - merged bag of {@link SafeSignatureOptions} (timing, multi-chain encoding, module address) and {@link WebAuthnSignatureOverrides} (verifier addresses, init flag). Single param for back-compat with the pre-split shape — callers may pass any combination of fields from either type.
	 * @returns signature
	 */
	public static formatSignaturesToUseroperationSignature(
		signerSignaturePairs: SignerSignaturePair[],
		options: SafeSignatureOptions & WebAuthnSignatureOverrides = {},
	): string {
		const validAfter = options.validAfter ?? 0n;
		const validUntil = options.validUntil ?? 0n;

		const signature = SafeAccount.buildSignaturesFromSingerSignaturePairs(
			signerSignaturePairs,
			options,
		);

		if (options.isMultiChainSignature) {
			if (options.multiChainMerkleProof != null) {
				const merkleProofLength = options.multiChainMerkleProof.slice(2).length; // wihout 0x prefix
				if (
					// 1 byte has a length of 2 hex chars
					// minimum proof consist of at least two hashes, 2 * 2 * 32 = 128
					merkleProofLength < 128 ||
					// a valid proof length should be a multiple of 2 * 32 = 64
					merkleProofLength % 64 !== 0
				) {
					throw new RangeError("invalid multiChainMerkleProof length.");
				}
				const merkleTreeDepth = merkleProofLength / 64 - 1;
				let merkleTreeDepthHex = merkleTreeDepth.toString(16);

				// create a 0x prefixed hex with an even length of chars
				if (merkleTreeDepthHex.length % 2 === 0) {
					merkleTreeDepthHex = `0x${merkleTreeDepthHex}`;
				} else {
					merkleTreeDepthHex = `0x0${merkleTreeDepthHex}`;
				}

				return solidityPacked(
					["bytes1", "uint48", "uint48", "bytes"],
					[
						merkleTreeDepthHex,
						validAfter,
						validUntil,
						options.multiChainMerkleProof + signature.slice(2),
					],
				);
			} else {
				//no proof means a single useroperation
				return solidityPacked(
					["bytes1", "uint48", "uint48", "bytes"],
					[
						"0x00", // single useroperation - merkle depth is 0
						validAfter,
						validUntil,
						signature,
					],
				);
			}
		} else {
			return solidityPacked(["uint48", "uint48", "bytes"], [validAfter, validUntil, signature]);
		}
	}

	/**
	 * Resolve a {@link Signer} to the lowercase address the Safe contract
	 * sees as the owner — not merely a case conversion:
	 *
	 * - string signer: returned lowercased as-is.
	 * - WebAuthn public key with `overrides.isInit` set: resolves to the
	 *   WebAuthn **shared signer** address, since during account init the
	 *   shared signer is the enabled owner rather than a per-owner verifier.
	 * - WebAuthn public key otherwise: **derives** the deterministic CREATE2
	 *   address of the per-owner WebAuthn verifier proxy from the key's x/y
	 *   coordinates and the verifier/factory configuration.
	 *
	 * Used as the sort key in {@link sortSignatures}, so it must always match
	 * the owner address that signature encoding will emit for the same
	 * overrides — pass the same overrides bag to both.
	 * @param signer - a signer to compute the owner address for
	 * @param overrides - WebAuthn verifier configuration and the init flag
	 * @returns the owner address, lowercased
	 */
	public static getSignerLowerCaseAddress(
		signer: Signer,
		overrides: WebAuthnSignatureOverrides = {},
	): string {
		if (typeof signer === "string") {
			return signer.toLowerCase();
		} else if (overrides.isInit) {
			// on init the encoded owner is the WebAuthn shared signer, not the
			// per-owner verifier proxy — sort by the same address that gets encoded
			const webAuthnSharedSigner =
				overrides.webAuthnSharedSigner ?? SafeAccount.DEFAULT_WEB_AUTHN_SHARED_SIGNER;
			return webAuthnSharedSigner.toLowerCase();
		} else {
			const eip7212WebAuthnPrecompileVerifier =
				overrides.eip7212WebAuthnPrecompileVerifier ?? SafeAccount.DEFAULT_WEB_AUTHN_PRECOMPILE;
			const eip7212WebAuthnContractVerifier =
				overrides.eip7212WebAuthnContractVerifier ?? SafeAccount.DEFAULT_WEB_AUTHN_CONTRACT_VERIFIER;
			const webAuthnSignerFactory =
				overrides.webAuthnSignerFactory ?? SafeAccount.DEFAULT_WEB_AUTHN_SIGNER_FACTORY;
			const webAuthnSignerSingleton =
				overrides.webAuthnSignerSingleton ?? SafeAccount.DEFAULT_WEB_AUTHN_SIGNER_SINGLETON;
			const webAuthnSignerProxyCreationCode =
				overrides.webAuthnSignerProxyCreationCode ??
				SafeAccount.DEFAULT_WEB_AUTHN_SIGNER_PROXY_CREATION_CODE;

			return SafeAccount.createWebAuthnSignerVerifierAddress(signer.x, signer.y, {
				eip7212WebAuthnPrecompileVerifier,
				eip7212WebAuthnContractVerifier,
				webAuthnSignerFactory,
				webAuthnSignerSingleton,
				webAuthnSignerProxyCreationCode,
			}).toLowerCase();
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
			SafeAccount.getSignerLowerCaseAddress(left.signer, overrides).localeCompare(
				SafeAccount.getSignerLowerCaseAddress(right.signer, overrides),
			),
		);
	}

	/**
	 * format a list of eip712 signatures to a safe signature (without the time range)
	 * @param signerSignaturePairs - a list of a pair of a signer and it's signature
	 * @param webAuthnSignatureOverrides - WebAuthn-only configuration (verifier addresses, init flag)
	 * @returns signature
	 */
	public static buildSignaturesFromSingerSignaturePairs(
		signerSignaturePairs: SignerSignaturePair[],
		webAuthnSignatureOverrides: WebAuthnSignatureOverrides = {},
	): string {
		SafeAccount.sortSignatures(signerSignaturePairs, webAuthnSignatureOverrides);
		const start = 65 * signerSignaturePairs.length;
		const { segments } = signerSignaturePairs.reduce(
			({ segments, offset }, { signer, signature, isContractSignature }) => {
				isContractSignature = isContractSignature || typeof signer !== "string";
				if (isContractSignature) {
					if (typeof signer !== "string") {
						// webauthn signature — on init, use the shared signer address
						// instead of the per-owner WebAuthn verifier address
						if (webAuthnSignatureOverrides.isInit == null) {
							throw new RangeError("Must define isInit parameter when using WebAuthn");
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
								SafeAccount.DEFAULT_WEB_AUTHN_CONTRACT_VERIFIER;
							const webAuthnSignerFactory =
								webAuthnSignatureOverrides.webAuthnSignerFactory ??
								SafeAccount.DEFAULT_WEB_AUTHN_SIGNER_FACTORY;
							const webAuthnSignerSingleton =
								webAuthnSignatureOverrides.webAuthnSignerSingleton ??
								SafeAccount.DEFAULT_WEB_AUTHN_SIGNER_SINGLETON;
							const webAuthnSignerProxyCreationCode =
								webAuthnSignatureOverrides.webAuthnSignerProxyCreationCode ??
								SafeAccount.DEFAULT_WEB_AUTHN_SIGNER_PROXY_CREATION_CODE;

							signer = SafeAccount.createWebAuthnSignerVerifierAddress(signer.x, signer.y, {
								eip7212WebAuthnPrecompileVerifier,
								eip7212WebAuthnContractVerifier,
								webAuthnSignerFactory,
								webAuthnSignerSingleton,
								webAuthnSignerProxyCreationCode,
							});
						}
					}
					return {
						segments: [
							...segments,
							solidityPacked(["uint256", "uint256", "uint8"], [signer, start + offset, 0]),
						],
						offset: offset + 32 + dataLength(signature),
					};
				} else {
					return {
						segments: [...segments, solidityPacked(["bytes"], [signature])],
						offset: offset,
					};
				}
			},
			{ segments: [] as string[], offset: 0 },
		);
		return concat([
			...segments,
			...signerSignaturePairs.map(({ signer, signature, isContractSignature }) => {
				isContractSignature = isContractSignature || typeof signer !== "string";
				if (isContractSignature) {
					return solidityPacked(
						["uint256", "bytes"],
						[dataLength(signature), signature],
					);
				} else {
					//only append signatures if a contract signature
					return "0x";
				}
			}),
		]);
	}

	/**
	 * encode webauthn signature from WebauthnSignatureData
	 * @param signatureData - signature data to format
	 * @returns formatted signature
	 */
	public static createWebAuthnSignature(signatureData: WebauthnSignatureData): string {
		return encodeAbiParameters(
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
	 * fetch the prevOwner needed for the swap
	 * @param nodeRpcUrl - The JSON-RPC API url for the target chain
	 * (to get the prevOwner parameter) and to check if a webauthn newowner verifier
	 * is already deployed.
	 * @param newOwner - newOwner public address
	 * @param oldOwner - oldOwner to replace public address
	 * @param overrides - overrides for the default values
	 * @param overrides.prevOwner - if set, it will be used as the previous owner and
	 * nodeRpcUrl won't be used to fetch it
	 * @returns a promise of a list of metaTransactions
	 */
	public async createSwapOwnerMetaTransactions(
		nodeRpcUrl: string | Transport | JsonRpcNode,
		newOwner: Signer,
		oldOwner: Signer,
		overrides: {
			prevOwner?: string;
			eip7212WebAuthnPrecompileVerifier?: string;
			eip7212WebAuthnContractVerifier?: string;
			webAuthnSignerFactory?: string;
			webAuthnSignerSingleton?: string;
			webAuthnSignerProxyCreationCode?: string;
		} = {},
	): Promise<MetaTransaction[]> {
		let deployNewOwnerSignerMetaTransaction: MetaTransaction | null = null;
		let newOwnerT: string;
		let oldOwnerT: string;
		const webAuthnSignerProxyCreationCode =
			overrides.webAuthnSignerProxyCreationCode ??
			SafeAccount.DEFAULT_WEB_AUTHN_SIGNER_PROXY_CREATION_CODE;

		if (typeof newOwner !== "string") {
			newOwnerT = SafeAccount.createWebAuthnSignerVerifierAddress(newOwner.x, newOwner.y, {
				eip7212WebAuthnPrecompileVerifier: overrides.eip7212WebAuthnPrecompileVerifier,
				eip7212WebAuthnContractVerifier: overrides.eip7212WebAuthnContractVerifier,
				webAuthnSignerFactory: overrides.webAuthnSignerFactory,
				webAuthnSignerSingleton: overrides.webAuthnSignerSingleton,
				webAuthnSignerProxyCreationCode,
			});
			const newOwnerCode = await JsonRpcNode.from(nodeRpcUrl).getCode(newOwnerT, "latest");
			const newOwnerNotDeployed = newOwnerCode.length < 3;
			if (newOwnerNotDeployed) {
				deployNewOwnerSignerMetaTransaction =
					SafeAccount.createDeployWebAuthnVerifierMetaTransaction(newOwner.x, newOwner.y, {
						eip7212WebAuthnPrecompileVerifier: overrides.eip7212WebAuthnPrecompileVerifier,
						eip7212WebAuthnContractVerifier: overrides.eip7212WebAuthnContractVerifier,
						webAuthnSignerFactory: overrides.webAuthnSignerFactory,
					});
			}
		} else {
			newOwnerT = newOwner;
		}
		if (typeof oldOwner !== "string") {
			oldOwnerT = SafeAccount.createWebAuthnSignerVerifierAddress(oldOwner.x, oldOwner.y, {
				eip7212WebAuthnPrecompileVerifier: overrides.eip7212WebAuthnPrecompileVerifier,
				eip7212WebAuthnContractVerifier: overrides.eip7212WebAuthnContractVerifier,
				webAuthnSignerFactory: overrides.webAuthnSignerFactory,
				webAuthnSignerSingleton: overrides.webAuthnSignerSingleton,
				webAuthnSignerProxyCreationCode,
			});
		} else {
			oldOwnerT = oldOwner;
		}

		let prevOwnerT = overrides.prevOwner;
		if (prevOwnerT == null) {
			const owners = await this.getOwners(nodeRpcUrl);
			const oldOwnerIndex = owners.findIndex(
				(owner) => owner.toLowerCase() === oldOwnerT.toLowerCase(),
			);
			if (oldOwnerIndex === -1) {
				throw new RangeError("oldOwner is not a current owner.");
			} else if (oldOwnerIndex === 0) {
				prevOwnerT = "0x0000000000000000000000000000000000000001";
			} else {
				prevOwnerT = owners[oldOwnerIndex - 1];
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
	 * create a removeOwner metatransaction, and fetch the prevOwner
	 * needed for the remove
	 * @param nodeRpcUrl - The JSON-RPC API url for the target chain
	 * (to get the prevOwner parameter).
	 * @param ownerToDelete - owner to delete public address
	 * @param threshold - new threshold
	 * @param overrides - overrides for the default values
	 * @param overrides.prevOwner - if set, it will be used as the previous owner and
	 * nodeRpcUrl won't be used to fetch it
	 * @returns a promise of a metaTransaction
	 */
	public async createRemoveOwnerMetaTransaction(
		nodeRpcUrl: string | Transport | JsonRpcNode,
		ownerToDelete: Signer,
		threshold: number,
		overrides: {
			prevOwner?: string;
			eip7212WebAuthnPrecompileVerifier?: string;
			eip7212WebAuthnContractVerifier?: string;
			webAuthnSignerFactory?: string;
			webAuthnSignerSingleton?: string;
			webAuthnSignerProxyCreationCode?: string;
		} = {},
	): Promise<MetaTransaction> {
		let ownerToDeleteT: string;

		if (typeof ownerToDelete !== "string") {
			const webAuthnSignerProxyCreationCode =
				overrides.webAuthnSignerProxyCreationCode ??
				SafeAccount.DEFAULT_WEB_AUTHN_SIGNER_PROXY_CREATION_CODE;

			ownerToDeleteT = SafeAccount.createWebAuthnSignerVerifierAddress(
				ownerToDelete.x,
				ownerToDelete.y,
				{
					eip7212WebAuthnPrecompileVerifier: overrides.eip7212WebAuthnPrecompileVerifier,
					eip7212WebAuthnContractVerifier: overrides.eip7212WebAuthnContractVerifier,
					webAuthnSignerFactory: overrides.webAuthnSignerFactory,
					webAuthnSignerSingleton: overrides.webAuthnSignerSingleton,
					webAuthnSignerProxyCreationCode,
				},
			);
		} else {
			ownerToDeleteT = ownerToDelete;
		}

		let prevOwnerT = overrides.prevOwner;
		if (prevOwnerT == null) {
			const owners = await this.getOwners(nodeRpcUrl);
			const ownerToDeleteIndex = owners.findIndex(
				(owner) => owner.toLowerCase() === ownerToDeleteT.toLowerCase(),
			);
			if (ownerToDeleteIndex === -1) {
				throw new RangeError("ownerToDelete is not a current owner.");
			} else if (ownerToDeleteIndex === 0) {
				prevOwnerT = "0x0000000000000000000000000000000000000001";
			} else {
				prevOwnerT = owners[ownerToDeleteIndex - 1];
			}
		}
		return this.createStandardRemoveOwnerMetaTransaction(ownerToDeleteT, threshold, prevOwnerT);
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
			nodeRpcUrl?: string | Transport | JsonRpcNode;
			eip7212WebAuthnPrecompileVerifier?: string;
			eip7212WebAuthnContractVerifier?: string;
			webAuthnSignerFactory?: string;
			webAuthnSignerSingleton?: string;
			webAuthnSignerProxyCreationCode?: string;
		} = {},
	): Promise<MetaTransaction[]> {
		let deployNewOwnerSignerMetaTransaction: MetaTransaction | null = null;
		let newOwnerT: string;

		if (typeof newOwner !== "string") {
			const webAuthnSignerProxyCreationCode =
				overrides.webAuthnSignerProxyCreationCode ??
				SafeAccount.DEFAULT_WEB_AUTHN_SIGNER_PROXY_CREATION_CODE;

			newOwnerT = SafeAccount.createWebAuthnSignerVerifierAddress(newOwner.x, newOwner.y, {
				eip7212WebAuthnPrecompileVerifier: overrides.eip7212WebAuthnPrecompileVerifier,
				eip7212WebAuthnContractVerifier: overrides.eip7212WebAuthnContractVerifier,
				webAuthnSignerFactory: overrides.webAuthnSignerFactory,
				webAuthnSignerSingleton: overrides.webAuthnSignerSingleton,
				webAuthnSignerProxyCreationCode,
			});
			if (overrides.nodeRpcUrl == null) {
				throw new RangeError("overrides.nodeRpcUrl can't be null if adding a webauthn owner");
			}
			const newOwnerCode = await JsonRpcNode.from(overrides.nodeRpcUrl).getCode(newOwnerT, "latest");
			const newOwnerNotDeployed = newOwnerCode.length < 3;
			if (newOwnerNotDeployed) {
				deployNewOwnerSignerMetaTransaction =
					SafeAccount.createDeployWebAuthnVerifierMetaTransaction(newOwner.x, newOwner.y, {
						eip7212WebAuthnPrecompileVerifier: overrides.eip7212WebAuthnPrecompileVerifier,
						eip7212WebAuthnContractVerifier: overrides.eip7212WebAuthnContractVerifier,
						webAuthnSignerFactory: overrides.webAuthnSignerFactory,
					});
			}
		} else {
			newOwnerT = newOwner;
		}

		const addMetaTransaction = this.createStandardAddOwnerWithThresholdMetaTransaction(
			newOwnerT,
			threshold,
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
	 * create a change threshold metatransaction
	 * @param threshold - new threshold
	 * @returns a metaTransactions
	 */
	public createChangeThresholdMetaTransaction(threshold: number): MetaTransaction {
		if (threshold < 1) {
			throw new RangeError("threshold can't be less than 1.");
		}

		const changeThresholdCallData = createCallData(
			"0x694e80c3", //changeThreshold
			["uint256"],
			[threshold],
		);

		return {
			to: this.accountAddress,
			data: changeThresholdCallData,
			value: 0n,
		};
	}

	/**
	 * create an approve hash metatransaction
	 * @param hashToApprove - hash to approve
	 * @returns a metaTransactions
	 */
	public createApproveHashMetaTransaction(hashToApprove: string): MetaTransaction {
		const approveHashCallData = createCallData(
			"0xd4d9bdcd", //approveHash
			["bytes32"],
			[hashToApprove],
		);

		return {
			to: this.accountAddress,
			data: approveHashCallData,
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
			overrides.eip7212WebAuthnPrecompileVerifier ?? SafeAccount.DEFAULT_WEB_AUTHN_PRECOMPILE;
		const eip7212WebAuthnContractVerifier =
			overrides.eip7212WebAuthnContractVerifier ?? SafeAccount.DEFAULT_WEB_AUTHN_CONTRACT_VERIFIER;
		const webAuthnSignerFactory =
			overrides.webAuthnSignerFactory ?? SafeAccount.DEFAULT_WEB_AUTHN_SIGNER_FACTORY;

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
	public async getOwners(nodeRpcUrl: string | Transport | JsonRpcNode): Promise<string[]> {
		const functionSignature = "getOwners()";
		const functionSelector = getFunctionSelector(functionSignature);
		const callData = createCallData(functionSelector, [], []);

		const ethCallParams = {
			to: this.accountAddress,
			data: callData,
		};
		const getOwnersResult = await JsonRpcNode.from(nodeRpcUrl).call(ethCallParams, "latest");

		const decodedCalldata = decodeAbiParameters<[string[]]>(["address[]"], getOwnersResult);

		return decodedCalldata[0];
	}

	/**
	 * fetches the current threshold
	 * @param nodeRpcUrl - The JSON-RPC API url for the target chain
	 * @returns a promise with the current threshold
	 */
	public async getThreshold(nodeRpcUrl: string | Transport | JsonRpcNode): Promise<number> {
		const functionSelector = "0xe75235b8"; //getThreshold
		const callData = createCallData(functionSelector, [], []);

		const ethCallParams = {
			to: this.accountAddress,
			data: callData,
		};
		const getThresholdResult = await JsonRpcNode.from(nodeRpcUrl).call(ethCallParams, "latest");

		const decodedCalldata = decodeAbiParameters<[bigint]>(["uint256"], getThresholdResult);

		return Number(decodedCalldata[0]);
	}

	/**
	 * fetches a paginated list of enabled modules for this account.
	 * @param nodeRpcUrl - The JSON-RPC API url for the target chain
	 * @param overrides - pagination overrides
	 * @param overrides.start - module address to start from (defaults to the sentinel 0x...0001)
	 * @param overrides.pageSize - maximum number of modules to return (default 10)
	 * @returns a promise of [moduleAddresses, nextPageStart]; pass nextPageStart back in overrides.start to continue
	 */
	public async getModules(
		nodeRpcUrl: string | Transport | JsonRpcNode,
		overrides: {
			start?: string;
			pageSize?: bigint;
		} = {},
	): Promise<[string[], string]> {
		try {
			let start = overrides.start;
			if (start == null) {
				start = "0x0000000000000000000000000000000000000001";
			}
			let pageSize = overrides.pageSize;
			if (pageSize == null) {
				pageSize = 10n;
			}

			const callData = createCallData(
				"0xcc2f8452", //getModulesPaginated(address,uint256)
				["address", "uint256"],
				[start, pageSize],
			);

			const ethCallParams = {
				to: this.accountAddress,
				data: callData,
			};
			const getModulesResult = await JsonRpcNode.from(nodeRpcUrl).call(ethCallParams, "latest");
			if (getModulesResult === "0x") {
				throw new AbstractionKitError(
					"BAD_DATA",
					"getModules returned an empty result, the target account is " +
						"probably not deployed yet.",
				);
			}
			const decodedCalldata = decodeAbiParameters<[string[], string]>(
				["address[]", "address"],
				getModulesResult,
			);
			return [decodedCalldata[0], decodedCalldata[1]];
		} catch (err) {
			const error = ensureError(err);

			throw new AbstractionKitError("BAD_DATA", "getModules failed", {
				cause: error,
			});
		}
	}

	/**
	 * check if a module is enabled
	 * @param nodeRpcUrl - The JSON-RPC API url for the target chain
	 * @param moduleAddress - the module address to check if enabled
	 * @returns a promise of boolean
	 */
	public async isModuleEnabled(
		nodeRpcUrl: string | Transport | JsonRpcNode,
		moduleAddress: string,
	): Promise<boolean> {
		const functionSignature = "isModuleEnabled(address)";
		const functionSelector = getFunctionSelector(functionSignature);
		const callData = createCallData(functionSelector, ["address"], [moduleAddress]);

		const ethCallParams = {
			to: this.accountAddress,
			data: callData,
		};
		const isModuleEnabledResult = await JsonRpcNode.from(nodeRpcUrl).call(ethCallParams, "latest");

		const decodedCalldata = decodeAbiParameters<[boolean]>(["bool"], isModuleEnabledResult);

		return decodedCalldata[0];
	}

	/**
	 * read the Safe's current fallback handler address from storage.
	 * For Safe ERC-4337 accounts the fallback handler is the 4337 module, so this
	 * is the canonical way to confirm which module/EntryPoint version an account
	 * is on (e.g. after a module migration).
	 * @param nodeRpcUrl - The JSON-RPC API url for the target chain
	 * @returns a promise of the fallback handler address (checksummed)
	 */
	public async getFallbackHandler(
		nodeRpcUrl: string | Transport | JsonRpcNode,
	): Promise<string> {
		const word = await JsonRpcNode.from(nodeRpcUrl).getStorageAt(
			this.accountAddress,
			SAFE_FALLBACK_HANDLER_STORAGE_SLOT,
			"latest",
		);
		return getAddress("0x" + word.slice(-40));
	}

	/**
	 * read the Safe's version string via `VERSION()` (e.g. "1.4.1").
	 * @param nodeRpcUrl - The JSON-RPC API url for the target chain
	 * @returns a promise of the Safe singleton version string
	 */
	public async getSafeVersion(
		nodeRpcUrl: string | Transport | JsonRpcNode,
	): Promise<string> {
		const callData = createCallData(getFunctionSelector("VERSION()"), [], []);
		const result = await JsonRpcNode.from(nodeRpcUrl).call(
			{ to: this.accountAddress, data: callData },
			"latest",
		);
		const [version] = decodeAbiParameters<[string]>(["string"], result);
		return version;
	}

	/**
	 * create a list of dummy signer/signature pairs for gas estimation based on the expected signers.
	 * @param expectedSigners - signers whose signatures will be produced at sign time
	 * @param webAuthnSignatureOverrides - WebAuthn verifier/module configuration
	 * @returns a list of dummy SignerSignaturePair entries, one per expected signer
	 */
	public static createDummySignerSignaturePairForExpectedSigners(
		expectedSigners: Signer[],
		webAuthnSignatureOverrides: WebAuthnSignatureOverrides = {},
	): SignerSignaturePair[] {
		const signers = [...expectedSigners];
		const dummySignerSignatures: SignerSignaturePair[] = [];
		for (const signer of signers) {
			let signerSignaturePair: SignerSignaturePair;
			if (typeof signer === "string") {
				signerSignaturePair = EOADummySignerSignaturePair;
			} else {
				if (webAuthnSignatureOverrides.isInit == null) {
					throw new RangeError("Must define isInit parameter when using WebAuthn");
				}
				signerSignaturePair = { ...WebauthnDummySignerSignaturePair };
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
						SafeAccount.DEFAULT_WEB_AUTHN_CONTRACT_VERIFIER;
					const webAuthnSignerFactory =
						webAuthnSignatureOverrides.webAuthnSignerFactory ??
						SafeAccount.DEFAULT_WEB_AUTHN_SIGNER_FACTORY;
					const webAuthnSignerSingleton =
						webAuthnSignatureOverrides.webAuthnSignerSingleton ??
						SafeAccount.DEFAULT_WEB_AUTHN_SIGNER_SINGLETON;
					const webAuthnSignerProxyCreationCode =
						webAuthnSignatureOverrides.webAuthnSignerProxyCreationCode ??
						SafeAccount.DEFAULT_WEB_AUTHN_SIGNER_PROXY_CREATION_CODE;

					signerSignaturePair.signer = SafeAccount.createWebAuthnSignerVerifierAddress(
						signer.x,
						signer.y,
						{
							eip7212WebAuthnPrecompileVerifier,
							eip7212WebAuthnContractVerifier,
							webAuthnSignerFactory,
							webAuthnSignerSingleton,
							webAuthnSignerProxyCreationCode,
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
	 * @note: this function works by constructing the bytecode of a webauthn
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
		nodeRpcUrl: string | Transport | JsonRpcNode,
		signer: WebauthnPublicKey,
		messageHash: string,
		signature: string,
		overrides: {
			eip7212WebAuthnPrecompileVerifier?: string;
			eip7212WebAuthnContractVerifier?: string;
			webAuthnSignerSingleton?: string;
		} = {},
	): Promise<boolean> {
		if (messageHash.length !== 66 || messageHash.slice(0, 2) !== "0x") {
			throw new RangeError("Invalid messageHash, must be a 0x-prefixed keccak256 hash.");
		}

		const eip7212WebAuthnPrecompileVerifier =
			overrides.eip7212WebAuthnPrecompileVerifier ?? SafeAccount.DEFAULT_WEB_AUTHN_PRECOMPILE;
		const eip7212WebAuthnContractVerifier =
			overrides.eip7212WebAuthnContractVerifier ?? SafeAccount.DEFAULT_WEB_AUTHN_CONTRACT_VERIFIER;
		const webAuthnSignerSingleton =
			overrides.webAuthnSignerSingleton ?? SafeAccount.DEFAULT_WEB_AUTHN_SIGNER_SINGLETON;

		if (
			eip7212WebAuthnPrecompileVerifier.length !== 42 ||
			eip7212WebAuthnPrecompileVerifier.slice(0, 38) !== ZeroAddress.slice(0, 38)
		) {
			throw new RangeError(
				"Invalid precompile address. " +
					"It should have the format 0x000000000000000000000000000000000000____",
			);
		}
		const functionSelector = "0x1626ba7e"; //isValidSignature(bytes32,bytes)
		const callData = createCallData(
			functionSelector,
			["bytes32", "bytes"],
			[messageHash, signature],
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
			webAuthnSignerSingleton,
		);

		const isModuleEnabledResult = await JsonRpcNode.from(nodeRpcUrl).call(
			ethCallParams,
			"latest",
			{
				[arbitraryAddress]: { code: deployedByteCode },
			},
		);

		const decodedCalldata = decodeAbiParameters<[boolean]>(["bool"], isModuleEnabledResult);

		return decodedCalldata[0];
	}

	private static createSafeWebAuthnSignerProxyDeployedByteCode(
		signer: WebauthnPublicKey,
		eip7212WebAuthnPrecompileVerifier: string,
		eip7212WebAuthnContractVerifier: string,
		webAuthnSignerSingleton: string,
	): string {
		const x = encodeAbiParameters(["uint256"], [signer.x]);
		const y = encodeAbiParameters(["uint256"], [signer.y]);
		const verifiers = encodeAbiParameters(
			["uint176"],
			[
				"0x" +
					eip7212WebAuthnPrecompileVerifier.slice(-4) +
					eip7212WebAuthnContractVerifier.slice(2),
			],
		);
		const byteCode =
			"0x608060408190527f" +
			verifiers.slice(2) +
			"3660b681018290527f" +
			y.slice(2) +
			"60a082018190527f" +
			x.slice(2) +
			"8285018190527f000000000000000000000000" +
			webAuthnSignerSingleton.slice(2) +
			"9490939192600082376000806056360183885af490503d6000803e8060c3573d6000fd5b503d6000f3fea2646970667358221220ddd9bb059ba7a6497d560ca97aadf4dbf0476f578378554a50d41c6bb654beae64736f6c63430008180033";
		return byteCode;
	}

	/**
	 * create MetaTransaction to enable a module on a Safe account
	 * @param moduleAddress - Module to enable
	 * @param accountAddress - Safe account to enable the module for
	 * @returns a MetaTransaction
	 */
	public static createEnableModuleMetaTransaction(
		moduleAddress: string,
		accountAddress: string,
	): MetaTransaction {
		const callData = createCallData(
			"0x610b5925", //"enableModule(address)"
			["address"],
			[moduleAddress],
		);
		return {
			to: accountAddress,
			data: callData,
			value: 0n,
		};
	}

	/**
	 * create a MetaTransaction that disables a module on this Safe account,
	 * fetching the previous module in the linked list automatically when not provided.
	 * @param nodeRpcUrl - The JSON-RPC API url for the target chain (used when prevModuleAddress is not provided)
	 * @param moduleToDisableAddress - Module to disable
	 * @param accountAddress - Safe account to disable the module on
	 * @param overrides - overrides for the default values
	 * @param overrides.prevModuleAddress - previous module in the linked list (skips the RPC lookup when set)
	 * @param overrides.modulesStart - pagination start when scanning modules to find the previous one
	 * @param overrides.modulesPageSize - pagination page size when scanning modules
	 * @returns a promise of a MetaTransaction
	 */
	public async createDisableModuleMetaTransaction(
		nodeRpcUrl: string | Transport | JsonRpcNode,
		moduleToDisableAddress: string,
		accountAddress: string,
		overrides: {
			prevModuleAddress?: string;
			modulesStart?: string;
			modulesPageSize?: bigint;
		} = {},
	): Promise<MetaTransaction> {
		try {
			let prevModuleAddressT = overrides.prevModuleAddress;
			if (prevModuleAddressT == null) {
				const SENTINEL_MODULES = "0x0000000000000000000000000000000000000001";
				const target = moduleToDisableAddress.toLowerCase();
				let cursor = overrides.modulesStart ?? SENTINEL_MODULES;
				// The predecessor of the first entry on page N is the cursor passed
				// to that page (SENTINEL on page 1; the last seen address on later
				// pages). We carry it across page boundaries so the lookup works
				// even when the module list spans multiple pages.
				let prev = cursor;
				while (prevModuleAddressT == null) {
					const [modules, next] = await this.getModules(nodeRpcUrl, {
						start: cursor,
						pageSize: overrides.modulesPageSize,
					});
					for (const module of modules) {
						if (module.toLowerCase() === target) {
							prevModuleAddressT = prev;
							break;
						}
						prev = module;
					}
					if (prevModuleAddressT != null) break;
					if (
						modules.length === 0 ||
						next.toLowerCase() === SENTINEL_MODULES ||
						next.toLowerCase() === cursor.toLowerCase()
					) {
						throw new RangeError(
							`moduleToDisable ${moduleToDisableAddress} is not an enabled module.`,
						);
					}
					cursor = next;
				}
			}
			return SafeAccount.createStandardDisableModuleMetaTransaction(
				moduleToDisableAddress,
				prevModuleAddressT,
				accountAddress,
			);
		} catch (err) {
			const error = ensureError(err);

			throw new AbstractionKitError("BAD_DATA", "createDisableModuleMetaTransaction failed", {
				cause: error,
			});
		}
	}

	/**
	 * create a standard disable-module MetaTransaction (callers provide the previous module).
	 * @param moduleAddress - Module to disable
	 * @param prevModuleAddress - previous module in the linked list
	 * @param accountAddress - Safe account to disable the module on
	 * @returns a MetaTransaction
	 */
	public static createStandardDisableModuleMetaTransaction(
		moduleAddress: string,
		prevModuleAddress: string,
		accountAddress: string,
	): MetaTransaction {
		const callData = createCallData(
			"0xe009cfde", //"disableModule(address)"
			["address", "address"],
			[prevModuleAddress, moduleAddress],
		);
		return {
			to: accountAddress,
			data: callData,
			value: 0n,
		};
	}

	/**
	 * create the MetaTransactions that migrate a DEPLOYED Safe from one ERC-4337
	 * module (and EntryPoint) to another. For Safe 4337 accounts the module is
	 * both the enabled module and the fallback handler, so a migration is exactly:
	 *   1. disableModule(oldModule)
	 *   2. enableModule(newModule)
	 *   3. setFallbackHandler(newModule)
	 *
	 * @note Both the v0.6/v0.7 `Safe4337Module` and the v0.9
	 * `Safe4337MultiChainSignatureModule` are stateless (no per-account storage),
	 * so there is NO storage to clear when swapping modules — these three
	 * transactions are the whole migration. The batch is validated and executed
	 * by the OLD module on the OLD EntryPoint; disabling that module mid-batch is
	 * safe because validation has already completed.
	 *
	 * Unless `skipPreflight` is set, this verifies on-chain that the account is
	 * actually a Safe running `oldModuleAddress` (the module is enabled AND is the
	 * current fallback handler) and that its Safe version meets the module minimum
	 * (>= 1.4.1) — turning a would-be cryptic on-chain `AA23`/`AA24` into a clear
	 * up-front error.
	 *
	 * @param nodeRpcUrl - The JSON-RPC API url for the target chain (used to find
	 *   the previous module in the linked list when not provided, and for preflight)
	 * @param oldModuleAddress - the currently-enabled 4337 module to disable
	 * @param newModuleAddress - the 4337 module to enable and set as fallback handler
	 * @param overrides - previous-module lookup overrides and `skipPreflight`
	 * @returns a promise of [disableOld, enableNew, setFallbackHandler] MetaTransactions
	 *
	 * @remarks Shared implementation behind the version-specific migration helpers
	 * (e.g. {@link SafeAccountV0_3_0.createMigrateToSafeMultiChainSigAccountV1MetaTransactions}).
	 * It is `protected` on purpose: those wrappers pin the correct module addresses,
	 * so callers reach migration through them rather than supplying raw module
	 * addresses directly.
	 */
	protected async createModuleMigrationMetaTransactions(
		nodeRpcUrl: string | Transport | JsonRpcNode,
		oldModuleAddress: string,
		newModuleAddress: string,
		overrides: {
			prevModuleAddress?: string;
			modulesStart?: string;
			modulesPageSize?: bigint;
			skipPreflight?: boolean;
		} = {},
	): Promise<MetaTransaction[]> {
		if (overrides.skipPreflight !== true) {
			await this.assertMigratableFromModule(nodeRpcUrl, oldModuleAddress);
		}

		const disableOldModule = await this.createDisableModuleMetaTransaction(
			nodeRpcUrl,
			oldModuleAddress,
			this.accountAddress,
			overrides,
		);

		const enableNewModule = SafeAccount.createEnableModuleMetaTransaction(
			newModuleAddress,
			this.accountAddress,
		);

		const setFallbackHandler: MetaTransaction = {
			to: this.accountAddress,
			value: 0n,
			data: createCallData(
				"0xf08a0323", //setFallbackHandler(address)
				["address"],
				[newModuleAddress],
			),
		};

		return [disableOldModule, enableNewModule, setFallbackHandler];
	}

	/**
	 * Minimum Safe singleton version required by the ERC-4337 modules.
	 */
	private static readonly MIN_SAFE_4337_VERSION = "1.4.1";

	/**
	 * Assert that this account is a deployed Safe currently running `oldModuleAddress`
	 * as both its enabled module and its fallback handler, on a Safe version that
	 * meets the 4337 module minimum. Throws a descriptive `BAD_DATA` error otherwise.
	 */
	private async assertMigratableFromModule(
		nodeRpcUrl: string | Transport | JsonRpcNode,
		oldModuleAddress: string,
	): Promise<void> {
		const node = JsonRpcNode.from(nodeRpcUrl);

		// The migration UserOperation is validated through the Safe's fallback
		// handler on the old EntryPoint, so the old module must be the fallback
		// handler for the migration to be processable at all.
		let fallbackHandler: string;
		try {
			fallbackHandler = await this.getFallbackHandler(node);
		} catch (err) {
			throw new AbstractionKitError(
				"BAD_DATA",
				`Could not read the fallback handler of ${this.accountAddress} — is it a deployed Safe? ` +
					"Pass { skipPreflight: true } to bypass this check.",
				{ cause: ensureError(err) },
			);
		}
		if (fallbackHandler.toLowerCase() !== oldModuleAddress.toLowerCase()) {
			throw new AbstractionKitError(
				"BAD_DATA",
				`Safe ${this.accountAddress} fallback handler is ${fallbackHandler}, expected the ` +
					`old 4337 module ${oldModuleAddress}. This account is not a Safe running that ` +
					"module; pass { skipPreflight: true } to bypass.",
			);
		}

		// The old module must also be enabled so execTransactionFromModule (which
		// executes the migration batch) is authorized.
		let moduleEnabled: boolean;
		try {
			moduleEnabled = await this.isModuleEnabled(node, oldModuleAddress);
		} catch (err) {
			throw new AbstractionKitError(
				"BAD_DATA",
				`Could not check whether module ${oldModuleAddress} is enabled on Safe ` +
					`${this.accountAddress} — is it a deployed Safe? Pass { skipPreflight: true } to bypass.`,
				{ cause: ensureError(err) },
			);
		}
		if (!moduleEnabled) {
			throw new AbstractionKitError(
				"BAD_DATA",
				`The 4337 module ${oldModuleAddress} is not enabled on Safe ${this.accountAddress}. ` +
					"Pass { skipPreflight: true } to bypass.",
			);
		}

		// Both modules require Safe >= 1.4.1. Treat read/decode failures and
		// empty/invalid version strings as a failed preflight.
		let version: string;
		try {
			version = await this.getSafeVersion(node);
		} catch (err) {
			throw new AbstractionKitError(
				"BAD_DATA",
				`Could not read the Safe version (VERSION()) of ${this.accountAddress} — is it a ` +
					`deployed Safe running module ${oldModuleAddress}? Pass { skipPreflight: true } to bypass.`,
				{ cause: ensureError(err) },
			);
		}
		if (
			typeof version !== "string" ||
			version.trim() === "" ||
			!SafeAccount.isVersionAtLeast(version, SafeAccount.MIN_SAFE_4337_VERSION)
		) {
			throw new AbstractionKitError(
				"BAD_DATA",
				`Safe ${this.accountAddress} reported version "${version}", which does not meet the ` +
					`minimum ${SafeAccount.MIN_SAFE_4337_VERSION} required by the 4337 modules ` +
					`(module ${oldModuleAddress}). Pass { skipPreflight: true } to bypass.`,
			);
		}
	}

	/**
	 * Compare dotted version strings numerically (ignoring any "+suffix"), e.g.
	 * isVersionAtLeast("1.4.1", "1.4.1") === true, ("1.5.0", "1.4.1") === true.
	 */
	private static isVersionAtLeast(version: string, minimum: string): boolean {
		const parse = (v: string): number[] =>
			v
				.split("+")[0]
				.split(".")
				.map((n) => parseInt(n, 10) || 0);
		const a = parse(version);
		const b = parse(minimum);
		for (let i = 0; i < Math.max(a.length, b.length); i++) {
			const x = a[i] ?? 0;
			const y = b[i] ?? 0;
			if (x !== y) return x > y;
		}
		return true;
	}

	/**
	 * Simulate the encoded calldata for this account on Tenderly and optionally return a share link.
	 * When `isInit` isn't provided, nonce is fetched via `nodeRpcUrl` to decide whether to include
	 * factory address/data in the simulation.
	 * @param tenderlyAccountSlug - The Tenderly account slug
	 * @param tenderlyProjectSlug - The Tenderly project slug
	 * @param tenderlyAccessKey - The Tenderly API access key
	 * @param nodeRpcUrl - Ethereum JSON-RPC node URL (only used when overrides.isInit is not set)
	 * @param chainId - Target chain ID
	 * @param metaTransactions - Transactions to simulate (ignored if overrides.callData is set)
	 * @param blockNumber - Optional block number for the simulation
	 * @param overrides - overrides for the default values
	 * @param overrides.safeModuleExecutorFunctionSelector - executor function to use
	 * @param overrides.multisendContractAddress - multisend address for batch transactions
	 * @param overrides.callData - pre-encoded calldata, overriding metaTransactions
	 * @param overrides.createShareLink - if true (default), also create a shareable dashboard link
	 * @param overrides.isInit - skip the nonce RPC check and explicitly set whether this is a deployment simulation
	 * @returns The simulation result, and optionally `callDataSimulationShareLink` / `accountDeploymentSimulationShareLink`
	 */
	async simulateCallDataWithTenderlyAndCreateShareLink(
		tenderlyAccountSlug: string,
		tenderlyProjectSlug: string,
		tenderlyAccessKey: string,
		nodeRpcUrl: string | Transport | JsonRpcNode | null = null,
		chainId: bigint,
		metaTransactions: MetaTransaction[],
		blockNumber: number | null = null,
		overrides: {
			safeModuleExecutorFunctionSelector?: SafeModuleExecutorFunctionSelector;
			multisendContractAddress?: string;
			callData?: string;
			createShareLink?: boolean;
			isInit?: boolean;
		} = {},
	): Promise<{
		simulation: TenderlySimulationResult;
		callDataSimulationShareLink?: string;
		accountDeploymentSimulationShareLink?: string;
	}> {
		let isInit: boolean = false;
		if (nodeRpcUrl == null && overrides.isInit == null) {
			throw new RangeError("nodeRpcUrl and overrides.isInit can't both be null");
		} else if (overrides.isInit == null) {
			const accountNonce = await fetchAccountNonce(
				nodeRpcUrl as string,
				this.entrypointAddress,
				this.accountAddress,
			);
			isInit = accountNonce === 0n;
		} else {
			isInit = overrides.isInit;
		}

		let callData = "0x" as string;
		if (overrides.callData == null) {
			if (metaTransactions.length === 1) {
				callData = SafeAccount.createAccountCallDataSingleTransaction(metaTransactions[0], {
					safeModuleExecutorFunctionSelector: overrides.safeModuleExecutorFunctionSelector,
				});
			} else {
				callData = SafeAccount.createAccountCallDataBatchTransactions(metaTransactions, {
					safeModuleExecutorFunctionSelector: overrides.safeModuleExecutorFunctionSelector,
					multisendContractAddress: overrides.multisendContractAddress,
				});
			}
		} else {
			callData = overrides.callData;
		}

		const createShareLink = overrides.createShareLink ?? true;
		if (createShareLink) {
			return await simulateSenderCallDataWithTenderlyAndCreateShareLink(
				tenderlyAccountSlug,
				tenderlyProjectSlug,
				tenderlyAccessKey,
				chainId,
				this.entrypointAddress,
				this.accountAddress,
				callData,
				isInit ? this.factoryAddress : null,
				isInit ? this.factoryData : null,
				blockNumber,
			);
		} else {
			const simulation = await simulateSenderCallDataWithTenderly(
				tenderlyAccountSlug,
				tenderlyProjectSlug,
				tenderlyAccessKey,
				chainId,
				this.entrypointAddress,
				this.accountAddress,
				callData,
				isInit ? this.factoryAddress : null,
				isInit ? this.factoryData : null,
				blockNumber,
			);
			return { simulation };
		}
	}

	/**
	 * create EIP-712 signing data for a Safe message, scoped to this account.
	 * @param chainId - target chain id
	 * @param message - message string to sign
	 * @returns an object containing the typed data domain, types, and message value
	 * needed for hashing and signing a Safe message
	 */
	getSafeMessageEip712Data(
		chainId: bigint,
		message: string,
	): {
		domain: SafeMessageTypedDataDomain;
		types: Record<string, { name: string; type: string }[]>;
		messageValue: SafeMessageTypedMessageValue;
	} {
		return getSafeMessageEip712Data(this.accountAddress, chainId, message);
	}
}

/**
 * generate a Safe on-chain identifier per https://docs.safe.global/sdk/onchain-tracking
 * @param project - project name
 * @param platform - "Web", "Mobile", "Safe App", or "Widget"; defaults to "Web"
 * @param tool - tool name; defaults to "abstractionkit"
 * @param toolVersion - tool version; defaults to the current abstractionkit version
 * @returns the on-chain identifier as a hex string (not 0x prefixed)
 */
function generateOnChainIdentifier(
	project: string,
	platform: "Web" | "Mobile" | "Safe App" | "Widget" = "Web",
	tool: string = "abstractionkit",
	toolVersion: string = "0.4.0",
): string {
	const identifierPrefix = "5afe"; // Safe identifier prefix
	const identifierVersion = "00"; // First version
	const projectHash = keccak256(hexlify(toUtf8Bytes(project))).slice(-20);
	const platformHash = keccak256(hexlify(toUtf8Bytes(platform))).slice(-3);
	const toolHash = keccak256(hexlify(toUtf8Bytes(tool))).slice(-3);
	const toolVersionHash = keccak256(hexlify(toUtf8Bytes(toolVersion))).slice(-3);

	// hex of the UTF-8 bytes, no 0x prefix (Buffer is undefined in browsers / React Native)
	const projectHashEncoded = hexlify(toUtf8Bytes(projectHash)).slice(2);
	const platformHashEncoded = hexlify(toUtf8Bytes(platformHash)).slice(2);
	const toolHashEncoded = hexlify(toUtf8Bytes(toolHash)).slice(2);
	const toolVersionHashEncoded = hexlify(toUtf8Bytes(toolVersionHash)).slice(2);

	const res = `${identifierPrefix}${identifierVersion}${projectHashEncoded}${platformHashEncoded}${toolHashEncoded}${toolVersionHashEncoded}`;
	return res;
}
