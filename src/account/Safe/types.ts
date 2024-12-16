import type { GasOption, StateOverrideSet, PolygonChain } from "../../types";

/**
 * Overrides for the "createBaseUserOperationAndFactoryAddressAndFactoryData" function
 */
export interface CreateBaseUserOperationOverrides {
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

	dummySignerSignaturePairs?: SignerSignaturePair[];

	webAuthnSharedSigner?: string;
	webAuthnSignerFactory?: string;
	webAuthnSignerSingleton?: string;

	eip7212WebAuthnPrecompileVerifier?: string;
	eip7212WebAuthnContractVerifier?: string;
	safeModuleExecutorFunctionSelector?: SafeModuleExecutorFunctionSelector;
	multisendContractAddress?: string;

	gasLevel?: GasOption;
	polygonGasStation?: PolygonChain;

    expectedSigners?: Signer[]
}

/**
 * Overrides for the "createUserOperation" function
 */
export interface CreateUserOperationV6Overrides
	extends CreateBaseUserOperationOverrides {
	/** set the initCode instead of using the calculated value */
	initCode?: string;
}

/**
 * Overrides for the "createUserOperation" function
 */
export interface CreateUserOperationV7Overrides
	extends CreateBaseUserOperationOverrides {
	/** set the factory address instead of using the calculated value */
	factory?: string;
	/** set the factory data instead of using the calculated value */
	factoryData?: string;
}

export interface SafeAccountSingleton {
	singletonAddress: string;
	singletonInitHash: string;
}

/**
 * Overrides for initilizing a new Safe account
 */
export interface InitCodeOverrides {
	/** signature threshold
	 * @defaultValue 1
	 */
	threshold?: number;
	/** create2 nonce - to generate different sender addresses from the same owners
	 * @defaultValue 0
	 */
	c2Nonce?: bigint;
	safe4337ModuleAddress?: string;
	safeModuleSetupddress?: string;

	entrypointAddress?: string;
	/** Safe contract singleton address
	 */
	safeAccountSingleton?: SafeAccountSingleton;
	/** Safe Factory address
	 */
	safeAccountFactoryAddress?: string;
	/** Safe 4337 module address
	 */
	multisendContractAddress?: string;
	webAuthnSharedSigner?: string;
	eip7212WebAuthnPrecompileVerifierForSharedSigner?: string;
	eip7212WebAuthnContractVerifierForSharedSigner?: string;
}

export interface BaseInitOverrides {
	/** signature threshold
	 * @defaultValue 1
	 */
	threshold?: number;
	/** create2 nonce - to generate different sender addresses from the same owners
	 * @defaultValue 0
	 */
	c2Nonce?: bigint;

	safeAccountSingleton?: SafeAccountSingleton;
	/** Safe Factory address
	 */
	safeAccountFactoryAddress?: string;
	/** Safe 4337 module address
	 */
	multisendContractAddress?: string;
	webAuthnSharedSigner?: string;
	eip7212WebAuthnPrecompileVerifierForSharedSigner?: string;
	eip7212WebAuthnContractVerifierForSharedSigner?: string;
}

export interface WebAuthnSignatureOverrides {
	isInit?: boolean;
	webAuthnSharedSigner?: string;
	eip7212WebAuthnPrecompileVerifier?: string;
	eip7212WebAuthnContractVerifier?: string;
	webAuthnSignerFactory?: string;
	webAuthnSignerSingleton?: string;
	validAfter?: bigint;
	validUntil?: bigint;
}

/**
 * Safe has two executor functions "executeUserOpWithErrorString" and "executeUserOp"
 */
export enum SafeModuleExecutorFunctionSelector {
	executeUserOpWithErrorString = "0x541d63c8",
	executeUserOp = "0x7bb37428",
}

export interface SafeUserOperationTypedDataDomain {
	chainId: bigint;
	verifyingContract: string;
}
export interface SafeUserOperationV6TypedMessageValue {
	safe: string;
	nonce: bigint;
	initCode: string;
	callData: string;
	callGasLimit: bigint;
	verificationGasLimit: bigint;
	preVerificationGas: bigint;
	maxFeePerGas: bigint;
	maxPriorityFeePerGas: bigint;
	paymasterAndData: string;
	validAfter: bigint;
	validUntil: bigint;
	entryPoint: string;
}

export interface SafeUserOperationV7TypedMessageValue {
	safe: string;
	nonce: bigint;
	initCode: string;
	callData: string;
	verificationGasLimit: bigint;
	callGasLimit: bigint;
	preVerificationGas: bigint;
	maxPriorityFeePerGas: bigint;
	maxFeePerGas: bigint;
	paymasterAndData: string;
	validAfter: bigint;
	validUntil: bigint;
	entryPoint: string;
}

export type ECDSAPublicAddress = string;

export interface WebauthnPublicKey {
	x: bigint;
	y: bigint;
}

export type Signer = ECDSAPublicAddress | WebauthnPublicKey;

export type ECDSASignature = string;

export interface WebauthnSignatureData {
	authenticatorData: ArrayBuffer;
	clientDataFields: string;
	rs: [bigint, bigint];
}

export interface SignerSignaturePair {
	signer: Signer;
	signature: string;
	isContractSignature?: boolean;
}

export const EOADummySignerSignaturePair: SignerSignaturePair = {
	signer: "0xfD90FAd33ee8b58f32c00aceEad1358e4AFC23f9",
	signature:
        "0x47003599ffa7e9198f321afa774e34a12a959844efd6363b88896e9c24ed33cf4e1be876ef123a3c4467e7d451511434039539699f2baa2f44955fa3d1c1c6d81c",
	isContractSignature: false,
};

export const WebauthnDummySignerSignaturePair: SignerSignaturePair = {
	signer: "0xfD90FAd33ee8b58f32c00aceEad1358e4AFC23f9",
	signature:
		"0x000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000e06c92f0ac5c4ef9e74721c23d80a9fc12f259ca84afb160f0890483539b9e6080d824c0e6c795157ad5d1ee5eff1ceeb3031009a595f9360919b83dd411c5a78d0000000000000000000000000000000000000000000000000000000000000025a24f744b28d73f066bf3203d145765a7bc735e6328168c8b03e476da3ad0d8fe0400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001e226f726967696e223a2268747470733a2f2f736166652e676c6f62616c220000",
	isContractSignature: true,
};
