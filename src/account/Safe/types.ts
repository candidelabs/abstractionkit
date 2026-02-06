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

/**
 * EIP-712 domain for Safe UserOperation signing.
 * Used to scope signatures to a specific chain and Safe 4337 module.
 */
export interface SafeUserOperationTypedDataDomain {
	/** Target chain ID to prevent cross-chain replay */
	chainId: bigint;
	/** Address of the Safe 4337 module contract that verifies the signature */
	verifyingContract: string;
}

/**
 * EIP-712 typed data values for a Safe UserOperation.
 * Mirrors the UserOperation fields with additional Safe-specific validity parameters.
 */
export interface SafeUserOperationTypedDataValues {
	/** The Safe account address */
	safe: string;
	/** Anti-replay nonce from the EntryPoint */
	nonce: bigint;
	/** Factory + factory data for account deployment (empty "0x" if already deployed) */
	initCode: string;
	/** Encoded call to execute on the Safe */
	callData: string;
	/** Gas limit for the inner execution */
	callGasLimit: bigint;
	/** Gas limit for the verification step */
	verificationGasLimit: bigint;
	/** Extra gas to compensate the bundler */
	preVerificationGas: bigint;
	/** Maximum fee per gas unit */
	maxFeePerGas: bigint;
	/** Maximum priority fee per gas unit */
	maxPriorityFeePerGas: bigint;
	/** Paymaster address + paymaster-specific data (empty "0x" if self-funded) */
	paymasterAndData: string;
	/** Unix timestamp after which the signature becomes valid (0 for no restriction) */
	validAfter: bigint;
	/** Unix timestamp after which the signature expires (0 for no restriction) */
	validUntil: bigint;
	/** EntryPoint contract address */
	entryPoint: string;
}
