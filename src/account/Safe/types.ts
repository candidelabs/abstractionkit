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
    //webauth signatures length are not fixed, this is an average webauth signature that should cover most cases
    //you can supply your own dummy signature that is suitable for your application or add some gas overrides to
    //createPaymasterUserOperation to compensate for the signature length difference
	webauth ="5715d3b8fc6e09d43d24175720e98c1ed970661400000000000000000000000000000000000000000000000000000000000000410000000000000000000000000000000000000000000000000000000000000001c0000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000e0762c7349c04b09b85aa0b0d21ba70df2195d60c653877df252a16c3f62559fa02d0dbe584b8a794bcf5fc5263f42cf8d50d200c3bc15fe375508e24ca97002ad000000000000000000000000000000000000000000000000000000000000002549960de5880e8c687434170f6476605b8fe4aeb9a28632c7995cf3ba831d9763050000000e00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a1226f726967696e223a22687474703a2f2f6c6f63616c686f73743a35313733222c2263726f73734f726967696e223a66616c73652c226f746865725f6b6579735f63616e5f62655f61646465645f68657265223a22646f206e6f7420636f6d7061726520636c69656e74446174614a534f4e20616761696e737420612074656d706c6174652e205365652068747470733a2f2f676f6f2e676c2f7961625065782200000000000000000000000000000000000000000000000000000000000000",
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