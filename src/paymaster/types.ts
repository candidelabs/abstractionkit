import type { StateOverrideSet } from "../types";

export interface CandidePaymasterContext {
	token?: string;
	sponsorshipPolicyId?: string;
}

export interface PrependTokenPaymasterApproveAccount {
	prependTokenPaymasterApproveToCallData(
		callData: string,
		tokenAddress: string,
		paymasterAddress: string,
		approveAmount: bigint,
	): string;
}

/**
 * Overrides for the "createUserOperation" function
 */
export interface BasePaymasterUserOperationOverrides {
	/** set the entrypoint address intead of determining it from the useroperation structure.*/
	entrypoint?: string;
}

/**
 * Overrides for the "createUserOperation" function
 */
export interface GasPaymasterUserOperationOverrides extends BasePaymasterUserOperationOverrides {
	/** set the callGasLimit instead of estimating gas using the bundler*/
	callGasLimit?: bigint;
	/** set the verificationGasLimit instead of estimating gas using the bundler*/
	verificationGasLimit?: bigint;
	/** set the preVerificationGas instead of estimating gas using the bundler*/
	preVerificationGas?: bigint;

	/** set the callGasLimitPercentageMultiplier instead of estimating gas using the bundler*/
	callGasLimitPercentageMultiplier?: number;
	/** set the verificationGasLimitPercentageMultiplier instead of estimating gas using the bundler*/
	verificationGasLimitPercentageMultiplier?: number;
	/** set the preVerificationGasPercentageMultiplier instead of estimating gas using the bundler*/
	preVerificationGasPercentageMultiplier?: number;

	/** pass some state overrides for gas estimation"*/
	state_override_set?: StateOverrideSet;
}
