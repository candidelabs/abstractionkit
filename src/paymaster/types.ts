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
 *
 * This context is forwarded as the fourth argument to the `pm_getPaymasterData`
 * JSON-RPC call on the Candide paymaster.
 *
 * @example Sponsored (gasless) UserOperation
 * ```ts
 * const [userOp, sponsorMeta] = await paymaster.createSponsorPaymasterUserOperation(
 *   smartAccount, userOp, bundlerRpc,
 *   "my-sponsorship-policy-id",
 * );
 * ```
 *
 * @example ERC-20 token gas payment
 * ```ts
 * const userOp = await paymaster.createTokenPaymasterUserOperation(
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
 * const [commitOp] = await paymaster.createSponsorPaymasterUserOperation(
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
 * const [finalOp] = await paymaster.createSponsorPaymasterUserOperation(
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
	 * Signing phase for the **parallel signing** feature. Only relevant for
	 * EntryPoint v0.9 accounts that use `PAYMASTER_SIG_MAGIC`-aware paymasters.
	 *
	 * Parallel signing decouples owner signing from the paymaster's final
	 * signature. This is useful when multiple owners need to co-sign a
	 * UserOperation (e.g. multi-sig wallets) or when the signing step happens
	 * on a separate device/service. Without parallel signing, you would need
	 * the final paymaster signature before owners can sign, creating a
	 * sequential dependency.
	 *
	 * ## How it works
	 *
	 * EntryPoint v0.9 introduces the `PAYMASTER_SIG_MAGIC` convention: when
	 * computing the UserOperation hash, the `paymasterData` is truncated at
	 * the magic boundary (`22e325a297439656`). This means the hash is
	 * identical whether the paymasterData contains the init placeholder or
	 * the final paymaster signature — so owners can safely sign the
	 * UserOperation before the paymaster has issued its real signature.
	 *
	 * ## Two-phase flow
	 *
	 * **`"commit"`** — First call. The paymaster:
	 *   1. Sets dummy paymaster fields for gas estimation.
	 *   2. Estimates gas limits via the bundler.
	 *   3. Returns init `paymasterData` ending with `PAYMASTER_SIG_MAGIC`.
	 *   After this call, the UserOp is ready for owner signing.
	 *
	 * **`"finalize"`** — Second call. The paymaster:
	 *   1. Skips gas estimation (already done in commit).
	 *   2. Replaces the init `paymasterData` with the real paymaster signature.
	 *   After this call, the UserOp is ready to be sent to the bundler.
	 *
	 * ## When to use
	 *
	 * - Multi-owner accounts where owners sign in parallel on different devices.
	 * - Flows where the signing step is asynchronous (e.g. hardware wallets,
	 *   approval queues, cross-chain multi-sig via `SafeMultiChainSigAccount`).
	 * - Any scenario where you need a stable UserOp hash before the paymaster
	 *   commits its final signature.
	 *
	 * If omitted, the default single-step flow is used: gas estimation,
	 * paymaster signature, and owner signing all happen sequentially.
	 */
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

	context?: CandidePaymasterContext;
}
