import type { StateOverrideSet } from "../../types";

/**
 * Overrides for the "createUserOperation" function
 */
export interface CreateUserOperationOverrides {
	/** set the nonce instead of quering the current nonce from the rpc node */
	nonce?: bigint;
	/** set the initCode instead of using the calculated value */
	initCode?: string;
	/** set the callData instead of using the enoding the provided Metatransactions*/
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

	/** gas estimation depends on the number of signers as each signer will increase the signature size
	 * @defaultValue 1
	 */
	numberOfSigners?: number;
	/** pass some state overrides for gas estimation"*/
	state_override_set?: StateOverrideSet;

	dummySingatures?: DummySignature[]|null,
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
	/** Safe contract singleton address
	 * @defaultValue "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762"
	 */
	singletonAddress?: string;
	/** Safe Factory address
	 * @defaultValue "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67"
	 */
	safeAccountFactoryAddress?: string;
	/** Safe 4337 module address
	 * @defaultValue "0xa581c4A4DB7175302464fF3C06380BC3270b4037"
	 */
	safe4337ModuleAddress?: string;
	/** addModuleLib address
	 * "0x8EcD4ec46D4D2a6B64fE960B3D64e8B94B2234eb"
	 */
	addModuleLibAddress?: string;
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

export interface SafeUserOperationTypedDataValues {
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

export type ECDSAPublicAddress = string

export interface WebauthPublicKey {
    x:bigint,
    y:bigint,
}

export type Signer = ECDSAPublicAddress | WebauthPublicKey

export enum DummySignature {
	eoa = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
	webauth = "ca66c5a0eeab0fe74f343bb4a539042c68ae45f90000000000000000000000000000000000000000000000000000000000000041000000000000000000000000000000000000000000000000000000000000000120000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000e01e638dbc81c4fc4402ae3c845dd5c7dd76f1abb5ebe281abad04ee9b2d93bbd0b743b83bc1ce08fa3a821dcd3e59903fd5399bd1379c1a34ad9fc2444c425e3b0000000000000000000000000000000000000000000000000000000000000025a24f744b28d73f066bf3203d145765a7bc735e6328168c8b03e476da3ad0d8fe0400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001e226f726967696e223a2268747470733a2f2f736166652e676c6f62616c220000",
}

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