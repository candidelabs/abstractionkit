import type { StateOverrideSet } from "../types";

/**
 * Context passed to the Candide paymaster RPC when requesting sponsorship
 * or ERC-20 token payment for gas.
 */
export interface CandidePaymasterContext {
	/** ERC-20 token address to use for gas payment. Omit for sponsored (gasless) operations. */
	token?: string;
	/** Sponsorship policy identifier for the Candide paymaster. */
	sponsorshipPolicyId?: string;
}

/**
 * Interface for smart accounts that support prepending an ERC-20 approval
 * to their callData so the token paymaster can collect gas fees.
 */
export interface PrependTokenPaymasterApproveAccount {
	/** The EntryPoint contract address this account targets */
	readonly entrypointAddress: string;

	/**
	 * Prepends a token approval call to the existing callData.
	 * @param callData - The original encoded callData
	 * @param tokenAddress - ERC-20 token address to approve
	 * @param paymasterAddress - Paymaster address to approve as spender
	 * @param approveAmount - Amount of tokens to approve
	 * @returns The modified callData with the approval prepended
	 */
	prependTokenPaymasterApproveToCallData(
		callData: string,
		tokenAddress: string,
		paymasterAddress: string,
		approveAmount: bigint,
	): string;
}

/**
 * Overrides for paymaster-assisted UserOperation creation.
 * fine-grained control over gas limits and estimation parameters.
 */
export interface PaymasterUserOperationOverrides {
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
