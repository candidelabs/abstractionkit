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
 * Signing phase for the **parallel signing** feature. Only relevant for
 * EntryPoint v0.9 accounts that use `PAYMASTER_SIG_MAGIC`-aware paymasters.
 *
 * Use the {@link SigningPhase} constant for call sites (e.g. `SigningPhase.Commit`)
 * so TypeScript narrows the literal without needing `as const`.
 */
export const SigningPhase = {
	Commit: 'commit',
	Finalize: 'finalize',
} as const;

export type SigningPhase = typeof SigningPhase[keyof typeof SigningPhase];

/**
 * Context passed to the Candide paymaster RPC when requesting sponsorship
 * or ERC-20 token payment for gas.
 *
 * This context is forwarded as the fourth argument to the `pm_getPaymasterData`
 * JSON-RPC call on the Candide paymaster. It carries `token` and
 * `sponsorshipPolicyId`. The parallel-signing `signingPhase` is hoisted to
 * the top-level {@link GasPaymasterUserOperationOverrides.signingPhase} field
 * and injected into this context internally before the RPC call.
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
 */
export interface CandidePaymasterContext {
	/** ERC-20 token address to use for gas payment. Omit for sponsored (gasless) operations. */
	token?: string;
	/** Sponsorship policy identifier for the Candide paymaster. */
	sponsorshipPolicyId?: string;
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
	 * the magic boundary (`22e325a297439656`). The hash is identical whether
	 * the paymasterData contains the init placeholder or the final paymaster
	 * signature, so owners can safely sign the UserOperation before the
	 * paymaster has issued its real signature.
	 *
	 * ## Two-phase flow
	 *
	 * **`SigningPhase.Commit`** (first call). The paymaster:
	 *   1. Sets dummy paymaster fields for gas estimation.
	 *   2. Estimates gas limits via the bundler.
	 *   3. Returns init `paymasterData` ending with `PAYMASTER_SIG_MAGIC`.
	 *   After this call, the UserOp is ready for owner signing.
	 *
	 * **`SigningPhase.Finalize`** (second call). The paymaster:
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
	 *
	 * @example
	 * ```ts
	 * import { SigningPhase } from "abstractionkit";
	 *
	 * // Step 1: commit. Returns a UserOp with stable hash and init paymasterData.
	 * const [commitOp] = await paymaster.createSponsorPaymasterUserOperation(
	 *   smartAccount, userOp, bundlerRpc,
	 *   sponsorshipPolicyId,
	 *   { signingPhase: SigningPhase.Commit },
	 * );
	 *
	 * // Owners sign in parallel. The hash is stable across commit/finalize.
	 * commitOp.signature = smartAccount.signUserOperation(commitOp, [signer], chainId);
	 *
	 * // Step 2: finalize. The paymaster replaces the init data with its real signature.
	 * const [finalOp] = await paymaster.createSponsorPaymasterUserOperation(
	 *   smartAccount, commitOp, bundlerRpc,
	 *   sponsorshipPolicyId,
	 *   { signingPhase: SigningPhase.Finalize },
	 * );
	 *
	 * await smartAccount.sendUserOperation(finalOp, bundlerRpc);
	 * ```
	 */
	signingPhase?: SigningPhase;
}
