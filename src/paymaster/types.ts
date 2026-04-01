import type {StateOverrideSet, UserOperationV6, UserOperationV7, UserOperationV8, UserOperationV9} from "../types";

/** Union of all UserOperation versions supported by the Candide paymaster. */
export type AnyUserOperation = UserOperationV9 | UserOperationV8 | UserOperationV7 | UserOperationV6;

/**
 * Conditional type that maps an input UserOperation type to its matching output type.
 * Preserves type narrowing: pass V7 in → get V7 back.
 * Order matters: V9/V8 is checked first (V7 lacks `eip7702Auth` so won't match V8/V9).
 */
export type SameUserOp<T extends AnyUserOperation> =
	T extends UserOperationV9 ? UserOperationV9 :
	T extends UserOperationV8 ? UserOperationV8 :
	T extends UserOperationV7 ? UserOperationV7 :
	UserOperationV6;

/**
 * Context passed to the Candide paymaster RPC when requesting sponsorship
 * or ERC-20 token payment for gas.
 */
export interface CandidePaymasterContext {
	/** ERC-20 token address to use for gas payment. Omit for sponsored (gasless) operations. */
	token?: string;
	/** Sponsorship policy identifier for the Candide paymaster. */
	sponsorshipPolicyId?: string;
	/** Signing phase for parallel signing feature (either 'commit' or 'finalize'). */
	signingPhase?: 'commit' | 'finalize';
}

export interface SmartAccountWithEntrypoint {
	/** The EntryPoint contract address this account targets */
	readonly entrypointAddress: string;
}

/**
 * Interface for smart accounts that support prepending an ERC-20 approval
 * to their callData so the token paymaster can collect gas fees.
 */
export interface PrependTokenPaymasterApproveAccount extends SmartAccountWithEntrypoint {
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
 * Base overrides for paymaster-assisted UserOperation creation.
 * Allows manually specifying the EntryPoint address instead of auto-detection.
 */
export interface BasePaymasterUserOperationOverrides {
	/** set the entrypoint address intead of determining it from the useroperation structure.*/
	entrypoint?: string;
	/** When true, prepend an approve(0) call before the actual token approval. Required for tokens like USDT that don't allow changing a non-zero allowance directly. */
	resetApproval?: boolean;
}

/**
 * Extended overrides for paymaster-assisted UserOperation creation with
 * fine-grained control over gas limits and estimation parameters.
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
