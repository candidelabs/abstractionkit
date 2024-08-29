import type { StateOverrideSet } from "../../types";

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

	dummySignatures?: SignerSignaturePair[],

    webAuthnSharedSigner?:string,
    webAuthnSignerFactory?:string,
    webAuthnSignerSingleton?:string,

    eip7212WebAuthPrecompileVerifier?:string,
    eip7212WebAuthContractVerifier?:string, 
    safeModuleExecutorFunctionSelector?: SafeModuleExecutorFunctionSelector,
    multisendContractAddress?: string,
}

/**
 * Overrides for the "createUserOperation" function
 */
export interface CreateUserOperationV6Overrides extends CreateBaseUserOperationOverrides{
	/** set the initCode instead of using the calculated value */
	initCode?: string;
}

/**
 * Overrides for the "createUserOperation" function
 */
export interface CreateUserOperationV7Overrides extends CreateBaseUserOperationOverrides{
	/** set the factory address instead of using the calculated value */
	factory?: string;
    /** set the factory data instead of using the calculated value */
	factoryData?: string;
}

export interface SafeAccountSingleton {
    singletonAddress:string;
    singletonInitHash:string;
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
	 * @defaultValue "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762"
	 */
	safeAccountSingleton?: SafeAccountSingleton;
	/** Safe Factory address
	 * @defaultValue "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67"
	 */
	safeAccountFactoryAddress?: string;
	/** Safe 4337 module address
	 * @defaultValue "0xa581c4A4DB7175302464fF3C06380BC3270b4037"
	 */
    multisendContractAddress?: string;
    webAuthnSharedSigner?: string;
    eip7212WebAuthPrecompileVerifierForSharedSigner?:string;
    eip7212WebAuthContractVerifierForSharedSigner?:string;
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
	 * @defaultValue "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67"
	 */
	safeAccountFactoryAddress?: string;
	/** Safe 4337 module address
	 * @defaultValue "0xa581c4A4DB7175302464fF3C06380BC3270b4037"
	 */
    multisendContractAddress?: string;
    webAuthnSharedSigner?: string;
    eip7212WebAuthPrecompileVerifierForSharedSigner?:string;
    eip7212WebAuthContractVerifierForSharedSigner?:string;
}

export interface WebAuthnSignatureOverrides {
    isInit?:boolean,
    webAuthnSharedSigner?:string,
    eip7212WebAuthPrecompileVerifier?:string,
    eip7212WebAuthContractVerifier?:string,
    webAuthnSignerFactory?:string,
    webAuthnSignerSingleton?:string,
    validAfter?: bigint,
    validUntil?: bigint,
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
export interface SafeUserOperationV6TypedDataValues {
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

export interface SafeUserOperationV7TypedDataValues {
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

export type ECDSAPublicAddress = string

export interface WebauthPublicKey {
    x:bigint,
    y:bigint,
}

export type Signer = ECDSAPublicAddress | WebauthPublicKey

export type ECDSASignature = string

export interface WebauthSignatureData {
    authenticatorData: ArrayBuffer
    clientDataFields: string
    rs: [bigint, bigint]
}

export interface SignerSignaturePair {
	signer: Signer
	signature: string
	isContractSignature?: boolean
}

export const EOADummySignature : SignerSignaturePair = {
	signer: "0xfD90FAd33ee8b58f32c00aceEad1358e4AFC23f9",
    signature: "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
	isContractSignature: false
}

export const WebauthDummySignerSignaturePair: SignerSignaturePair = {
	signer: "0xfD90FAd33ee8b58f32c00aceEad1358e4AFC23f9",
	signature: "0x000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000e06c92f0ac5c4ef9e74721c23d80a9fc12f259ca84afb160f0890483539b9e6080d824c0e6c795157ad5d1ee5eff1ceeb3031009a595f9360919b83dd411c5a78d0000000000000000000000000000000000000000000000000000000000000025a24f744b28d73f066bf3203d145765a7bc735e6328168c8b03e476da3ad0d8fe0400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001e226f726967696e223a2268747470733a2f2f736166652e676c6f62616c220000",
	isContractSignature: true
}

