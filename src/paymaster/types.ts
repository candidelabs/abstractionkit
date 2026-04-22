import type {
	StateOverrideSet,
	UserOperationV6,
	UserOperationV7,
	UserOperationV8,
	UserOperationV9,
} from "../types";

/** Union of all UserOperation versions supported by the Candide paymaster. */
export type AnyUserOperation =
	| UserOperationV9
	| UserOperationV8
	| UserOperationV7
	| UserOperationV6;

/**
 * Conditional type that maps an input UserOperation type to its matching output type.
 * Preserves type narrowing: pass V7 in → get V7 back.
 * Order matters: V9/V8 is checked first (V7 lacks `eip7702Auth` so won't match V8/V9).
 */
export type SameUserOp<T extends AnyUserOperation> = T extends UserOperationV9
	? UserOperationV9
	: T extends UserOperationV8
		? UserOperationV8
		: T extends UserOperationV7
			? UserOperationV7
			: UserOperationV6;

/**
 * Context passed to the Candide paymaster RPC when requesting sponsorship
 * or ERC-20 token payment for gas.
 *
 * This context is forwarded as the fourth argument to the `pm_getPaymasterData`
 * JSON-RPC call on the Candide paymaster.
 *
 * @example Sponsored (gasless) UserOperation
 * ```ts
 * const { userOperation, sponsorMetadata } = await paymaster.createSponsorPaymasterUserOperation(
 *   smartAccount, userOp, bundlerRpc,
 *   "my-sponsorship-policy-id",
 * );
 * ```
 *
 * @example ERC-20 token gas payment
 * ```ts
 * const { userOperation, tokenQuote } = await paymaster.createTokenPaymasterUserOperation(
 *   smartAccount, userOp, USDC_ADDRESS, bundlerRpc,
 * );
 * ```
 *
 * @example Parallel signing with `signingPhase` (two-step commit/finalize)
 * ```ts
 * // ── Step 1: COMMIT ──
 * // Request initial paymaster fields with dummy signature.
 * // The paymaster returns gas limits and init paymasterData (ending with
 * // PAYMASTER_SIG_MAGIC) so owners can sign in parallel without waiting
 * // for the final paymaster signature.
 * const { userOperation: commitOp } = await paymaster.createSponsorPaymasterUserOperation(
 *   smartAccount, userOp, bundlerRpc,
 *   sponsorshipPolicyId,
 *   { signingPhase: "commit" },
 * );
 *
 * // Sign the UserOperation (safe because the UserOp hash is stable —
 * // the PAYMASTER_SIG_MAGIC boundary ensures the hash stays the same
 * // whether init or final paymasterData is used).
 * commitOp.signature = smartAccount.signUserOperation(
 *   commitOp, [signer], chainId,
 * );
 *
 * // ── Step 2: FINALIZE ──
 * // Send the already-signed UserOperation back to the paymaster.
 * // The paymaster replaces the init paymasterData with the final
 * // paymaster signature. Gas estimation is skipped (already done in commit).
 * const { userOperation: finalOp } = await paymaster.createSponsorPaymasterUserOperation(
 *   smartAccount, commitOp, bundlerRpc,
 *   sponsorshipPolicyId,
 *   { signingPhase: "finalize" },
 * );
 *
 * // Send the finalized UserOperation to the bundler.
 * const response = await smartAccount.sendUserOperation(finalOp, bundlerRpc);
 * ```
 */
export interface CandidePaymasterContext {
	/** ERC-20 token address to use for gas payment. Omit for sponsored (gasless) operations. */
	token?: string;
	/** Sponsorship policy identifier for the Candide paymaster. */
	sponsorshipPolicyId?: string;
	/**
	 * Opt into the **parallel signing** two-phase flow (EntryPoint v0.9 only).
	 *
	 * Decouples owner signing from the paymaster's final signature, so owners
	 * can sign asynchronously on separate devices (multi-sig, hardware wallets,
	 * cross-chain multi-sig) without waiting for the paymaster. Works because
	 * EP v0.9 truncates `paymasterData` at the `PAYMASTER_SIG_MAGIC` boundary
	 * (`22e325a297439656`) when computing the UserOperation hash — the hash is
	 * identical whether `paymasterData` holds the init placeholder or the final
	 * signature, so owners can sign before the paymaster commits.
	 *
	 * - `"commit"` — first call: stub fields, gas estimation, returns init
	 *   `paymasterData` ending with `PAYMASTER_SIG_MAGIC`. Owners then sign.
	 * - `"finalize"` — second call: skips gas estimation, swaps the placeholder
	 *   for the real paymaster signature. Ready to send to the bundler.
	 *
	 * Omit for the default single-step (sequential) flow.
	 */
	signingPhase?: "commit" | "finalize";
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

/** Known paymaster provider identifiers for provider-specific features (token quotes, etc.). */
export type Erc7677Provider = "pimlico" | "candide" | null;

/** Constructor options for {@link Erc7677Paymaster}. */
export interface Erc7677PaymasterConstructorOptions {
	/** Chain id as a bigint (e.g. `1n` for mainnet). Avoids a lookup at first use. */
	chainId?: bigint;
	/**
	 * Paymaster provider. `"auto"` (default) detects from the RPC URL.
	 * Set explicitly to override detection, or `null` to disable provider features.
	 */
	provider?: "auto" | Erc7677Provider;
}

/**
 * Base overrides for paymaster-assisted UserOperation creation.
 * Allows manually specifying the EntryPoint address instead of auto-detection.
 */
export interface BasePaymasterUserOperationOverrides {
	/** set the entrypoint address instead of determining it from the useroperation structure. */
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

	/** pass some state overrides for gas estimation */
	state_override_set?: StateOverrideSet;
}
