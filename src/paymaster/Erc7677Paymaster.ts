import { Paymaster } from "./Paymaster";
import { Bundler } from "../Bundler";
import { sendJsonRpcRequest } from "../utils";
import { AbstractionKitError, ensureError } from "../errors";
import {
	ENTRYPOINT_V6,
	ENTRYPOINT_V7,
	ENTRYPOINT_V8,
	ENTRYPOINT_V9,
} from "../constants";
import type { StateOverrideSet } from "../types";
import {
	AnyUserOperation,
	SameUserOp,
	SmartAccountWithEntrypoint,
	GasPaymasterUserOperationOverrides,
} from "./types";

/**
 * Opaque context object forwarded to the paymaster RPC as the fourth argument
 * of `pm_getPaymasterStubData` / `pm_getPaymasterData`.
 *
 * The shape is provider-specific: Pimlico uses `{ token }` for token paymaster
 * and `{ sponsorshipPolicyId }` for sponsored operations; Alchemy, Biconomy,
 * and others have their own conventions. Refer to the paymaster provider's
 * documentation for the exact fields.
 */
export type Erc7677Context = Record<string, unknown>;

/**
 * Paymaster gas/data fields returned by `pm_getPaymasterStubData` and
 * `pm_getPaymasterData` for EntryPoint v0.7+ UserOperations.
 */
export interface Erc7677PaymasterFields {
	paymaster?: string;
	paymasterData?: string;
	paymasterVerificationGasLimit?: bigint | string;
	paymasterPostOpGasLimit?: bigint | string;
	/** Present on v0.6 responses; mutually exclusive with the split fields above. */
	paymasterAndData?: string;
}

/**
 * Response from `pm_getPaymasterStubData`. Includes `isFinal` when the paymaster
 * signs immediately and does not require a follow-up `pm_getPaymasterData` call.
 */
export interface Erc7677StubDataResult extends Erc7677PaymasterFields {
	/** When true, skip pm_getPaymasterData and use these fields as the final signature. */
	isFinal?: boolean;
	[key: string]: unknown;
}

/**
 * Generic ERC-7677 paymaster client.
 *
 * Speaks the [ERC-7677](https://eips.ethereum.org/EIPS/eip-7677) JSON-RPC
 * protocol: `pm_getPaymasterStubData` for gas-estimation stubs and
 * `pm_getPaymasterData` for the final signed paymaster fields. Works with any
 * paymaster provider that implements the standard (Pimlico, Alchemy, Biconomy,
 * etc.).
 *
 * For Candide-hosted paymasters, prefer {@link CandidePaymaster}, which uses
 * cached `dummyPaymasterAndData` metadata to skip the stub round-trip and
 * supports parallel signing phases.
 *
 * ## Flow
 *
 * {@link Erc7677Paymaster.createPaymasterUserOperation} runs the full pipeline:
 *
 * 1. `pm_getPaymasterStubData(userOp, entrypoint, chainId, context)` — stub
 *    paymaster fields for gas estimation.
 * 2. Apply stub fields to the UserOperation.
 * 3. `eth_estimateUserOperationGas` via the bundler, reading back the bundler's
 *    paymaster gas limits (v0.7+).
 * 4. Apply gas limits to the UserOperation.
 * 5. If the stub response includes `isFinal: true`, skip to step 7.
 * 6. `pm_getPaymasterData(userOp, entrypoint, chainId, context)` — final
 *    paymaster signature.
 * 7. Return the UserOperation with paymaster fields populated, ready to sign.
 *
 * Owner signing is intentionally out of scope — call the smart account's
 * `signUserOperation` (or your external signer) after this method returns.
 *
 * ## Token paymaster flows
 *
 * For ERC-20 gas payment, the consumer is responsible for:
 *   - Prepending the `approve(paymasterAddress, amount)` call to their
 *     UserOperation's callData *before* passing it to this class.
 *   - Determining the approval amount (typically via a provider-specific
 *     token-quotes endpoint such as Pimlico's `pimlico_getTokenQuotes`).
 *   - Resetting non-zero allowances first when required by the token
 *     (e.g. USDT on Ethereum mainnet).
 *
 * @example Sponsored UserOperation (Pimlico)
 * ```ts
 * const paymaster = new Erc7677Paymaster(pimlicoUrl);
 * const [sponsoredOp] = await paymaster.createPaymasterUserOperation(
 *   smartAccount,
 *   userOp,
 *   bundlerRpc,
 *   { sponsorshipPolicyId: "sp_melted_jackpot" },
 * );
 * sponsoredOp.signature = smartAccount.signUserOperation(sponsoredOp, [pk], chainId);
 * await new Bundler(bundlerRpc).sendUserOperation(sponsoredOp, smartAccount.entrypointAddress);
 * ```
 *
 * @example Token paymaster (Pimlico, USDT)
 * ```ts
 * // Consumer prepends approve() to callData and passes the token context.
 * userOp.callData = smartAccount.prependTokenPaymasterApproveToCallData(
 *   userOp.callData, usdtAddress, paymasterAddress, approveAmount,
 * );
 * const [tokenOp] = await paymaster.createPaymasterUserOperation(
 *   smartAccount,
 *   userOp,
 *   bundlerRpc,
 *   { token: usdtAddress },
 * );
 * ```
 */
export class Erc7677Paymaster extends Paymaster {
	/** The paymaster JSON-RPC endpoint URL */
	readonly rpcUrl: string;
	/** Cached chain ID (hex string). Passed via constructor or resolved from the bundler at first use. */
	private chainId: string | null;

	/**
	 * @param rpcUrl - Paymaster JSON-RPC endpoint. Can be the same URL as the
	 *   bundler when the provider bundles both (Pimlico, Alchemy); can also be
	 *   a separate paymaster-only endpoint.
	 * @param options.chainId - Optional hex-encoded chain id (e.g. `"0x1"`).
	 *   When provided, avoids a lookup at first use. Otherwise, resolved from
	 *   the bundler via `eth_chainId` on the first call.
	 */
	constructor(rpcUrl: string, options: { chainId?: string } = {}) {
		super();
		this.rpcUrl = rpcUrl;
		this.chainId = options.chainId ?? null;
	}

	/**
	 * Resolve the chain id, querying the bundler if not provided at construction.
	 */
	private async getChainId(bundlerRpc: string): Promise<string> {
		if (this.chainId != null) return this.chainId;
		const id = await new Bundler(bundlerRpc).chainId();
		this.chainId = id;
		return id;
	}

	/**
	 * Determine the EntryPoint address from the UserOperation shape.
	 * V6 ops have `initCode`, V8+ ops have `eip7702Auth`, V7 is the default.
	 */
	private resolveEntrypoint(
		smartAccount: SmartAccountWithEntrypoint,
		userOperation: AnyUserOperation,
	): string {
		if (
			smartAccount.entrypointAddress != null &&
			smartAccount.entrypointAddress.trim() !== ""
		) {
			return smartAccount.entrypointAddress;
		}
		if ("initCode" in userOperation) return ENTRYPOINT_V6;
		if ("eip7702Auth" in userOperation) return ENTRYPOINT_V8;
		return ENTRYPOINT_V7;
	}

	/**
	 * Low-level ERC-7677 `pm_getPaymasterStubData` call.
	 * Returns dummy paymaster fields intended for gas estimation.
	 *
	 * Most consumers should prefer {@link createPaymasterUserOperation}, which
	 * runs the full stub → estimate → final pipeline. Use this directly if you
	 * need to drive the flow manually.
	 */
	async getPaymasterStubData(
		userOperation: AnyUserOperation,
		entrypoint: string,
		chainIdHex: string,
		context: Erc7677Context = {},
	): Promise<Erc7677StubDataResult> {
		try {
			const result = await sendJsonRpcRequest(
				this.rpcUrl,
				"pm_getPaymasterStubData",
				[userOperation, entrypoint, chainIdHex, context],
			);
			return result as Erc7677StubDataResult;
		} catch (err) {
			throw new AbstractionKitError(
				"PAYMASTER_ERROR",
				"pm_getPaymasterStubData failed",
				{ cause: ensureError(err) },
			);
		}
	}

	/**
	 * Low-level ERC-7677 `pm_getPaymasterData` call.
	 * Returns the final signed paymaster fields.
	 */
	async getPaymasterData(
		userOperation: AnyUserOperation,
		entrypoint: string,
		chainIdHex: string,
		context: Erc7677Context = {},
	): Promise<Erc7677PaymasterFields> {
		try {
			const result = await sendJsonRpcRequest(
				this.rpcUrl,
				"pm_getPaymasterData",
				[userOperation, entrypoint, chainIdHex, context],
			);
			return result as Erc7677PaymasterFields;
		} catch (err) {
			throw new AbstractionKitError(
				"PAYMASTER_ERROR",
				"pm_getPaymasterData failed",
				{ cause: ensureError(err) },
			);
		}
	}

	/**
	 * Runs the full ERC-7677 pipeline and returns a UserOperation with paymaster
	 * fields populated. The caller is responsible for signing and sending.
	 *
	 * @param smartAccount - Provides the target EntryPoint; not mutated.
	 * @param userOperation - Starting UserOperation. Not mutated — a shallow copy is returned.
	 * @param bundlerRpc - Bundler URL used for gas estimation and, if
	 *   `options.chainId` was not provided to the constructor, chain-id lookup.
	 * @param context - Provider-specific paymaster context
	 *   (e.g. `{ sponsorshipPolicyId }` or `{ token }`).
	 * @param overrides - Gas estimation overrides and state-override set.
	 *
	 * @returns The UserOperation with paymaster + gas fields populated.
	 */
	async createPaymasterUserOperation<T extends AnyUserOperation>(
		smartAccount: SmartAccountWithEntrypoint,
		userOperation: T,
		bundlerRpc: string,
		context: Erc7677Context = {},
		overrides: GasPaymasterUserOperationOverrides = {},
	): Promise<SameUserOp<T>> {
		try {
			const userOp = { ...userOperation } as T;
			const entrypoint =
				overrides.entrypoint ?? this.resolveEntrypoint(smartAccount, userOp);
			const chainIdHex = await this.getChainId(bundlerRpc);

			// Step 1 — stub paymaster data for gas estimation.
			const stub = await this.getPaymasterStubData(
				userOp,
				entrypoint,
				chainIdHex,
				context,
			);
			this.applyPaymasterFields(userOp, stub);

			// Step 2 — gas estimation with the stub paymaster applied. When a
			// paymaster is attached, v0.7+ bundlers return paymaster gas limits
			// alongside the execution limits; they supersede the stub's
			// placeholder values (Pimlico returns paymasterPostOpGasLimit: 0x1).
			await this.estimateAndApplyGasLimits(
				userOp,
				bundlerRpc,
				entrypoint,
				overrides,
			);

			// Step 3 — if the stub was already final, we're done.
			if (stub.isFinal === true) {
				return userOp as unknown as SameUserOp<T>;
			}

			// Step 4 — final paymaster data (signature over the fully-populated userOp).
			const final = await this.getPaymasterData(
				userOp,
				entrypoint,
				chainIdHex,
				context,
			);
			this.applyPaymasterFields(userOp, final);

			return userOp as unknown as SameUserOp<T>;
		} catch (err) {
			const error = ensureError(err);
			if (error instanceof AbstractionKitError) throw error;
			throw new AbstractionKitError(
				"PAYMASTER_ERROR",
				"createPaymasterUserOperation failed",
				{ cause: error },
			);
		}
	}

	/**
	 * Merge paymaster fields into a UserOperation. Handles both v0.6
	 * (`paymasterAndData`) and v0.7+ split fields.
	 */
	private applyPaymasterFields(
		userOp: AnyUserOperation,
		fields: Erc7677PaymasterFields,
	): void {
		if ("initCode" in userOp) {
			if (fields.paymasterAndData != null) {
				userOp.paymasterAndData = fields.paymasterAndData;
			}
			return;
		}
		if (fields.paymaster != null) userOp.paymaster = fields.paymaster;
		if (fields.paymasterData != null) userOp.paymasterData = fields.paymasterData;
		if (fields.paymasterVerificationGasLimit != null) {
			userOp.paymasterVerificationGasLimit = BigInt(
				fields.paymasterVerificationGasLimit,
			);
		}
		if (fields.paymasterPostOpGasLimit != null) {
			userOp.paymasterPostOpGasLimit = BigInt(fields.paymasterPostOpGasLimit);
		}
	}

	/**
	 * Estimate gas limits via the bundler and apply them (with multipliers).
	 * Reads paymaster gas fields back from the bundler when present — Pimlico's
	 * `pm_getPaymasterStubData` returns `paymasterPostOpGasLimit: 0x1` as a
	 * placeholder; the bundler's estimate has the real value.
	 *
	 * Mirrors CandidePaymaster.estimateAndApplyGasLimits default multipliers
	 * (5%/10%/10% on preVerification/verification/call) for consistent UX.
	 */
	private async estimateAndApplyGasLimits(
		userOp: AnyUserOperation,
		bundlerRpc: string,
		entrypoint: string,
		overrides: GasPaymasterUserOperationOverrides,
	): Promise<void> {
		let preVerificationGas = userOp.preVerificationGas;
		let verificationGasLimit = userOp.verificationGasLimit;
		let callGasLimit = userOp.callGasLimit;

		if (
			overrides.preVerificationGas == null ||
			overrides.verificationGasLimit == null ||
			overrides.callGasLimit == null
		) {
			if (bundlerRpc == null) {
				throw new AbstractionKitError(
					"BAD_DATA",
					"bundlerRpc can't be null if preVerificationGas, verificationGasLimit and callGasLimit are not overridden",
				);
			}
			const bundler = new Bundler(bundlerRpc);
			const priorCallGasLimit = userOp.callGasLimit;
			const priorVerificationGasLimit = userOp.verificationGasLimit;
			const priorPreVerificationGas = userOp.preVerificationGas;
			userOp.callGasLimit = 0n;
			userOp.verificationGasLimit = 0n;
			userOp.preVerificationGas = 0n;

			const estimation = await bundler.estimateUserOperationGas(
				userOp,
				entrypoint,
				overrides.state_override_set as StateOverrideSet | undefined,
			);

			if (estimation.preVerificationGas > preVerificationGas) {
				preVerificationGas = estimation.preVerificationGas;
			} else {
				userOp.preVerificationGas = priorPreVerificationGas;
			}
			if (estimation.verificationGasLimit > verificationGasLimit) {
				verificationGasLimit = estimation.verificationGasLimit;
			} else {
				userOp.verificationGasLimit = priorVerificationGasLimit;
			}
			if (estimation.callGasLimit > callGasLimit) {
				callGasLimit = estimation.callGasLimit;
			} else {
				userOp.callGasLimit = priorCallGasLimit;
			}

			// Overwrite paymaster gas fields with bundler-reported values when
			// available. Stub responses often leave these as placeholders.
			if (
				"paymaster" in userOp &&
				estimation.paymasterVerificationGasLimit != null
			) {
				userOp.paymasterVerificationGasLimit =
					estimation.paymasterVerificationGasLimit;
			}
			if (
				"paymaster" in userOp &&
				estimation.paymasterPostOpGasLimit != null
			) {
				userOp.paymasterPostOpGasLimit = estimation.paymasterPostOpGasLimit;
			}
		}

		if (
			typeof overrides.preVerificationGas === "bigint" &&
			overrides.preVerificationGas < 0n
		) {
			throw new RangeError("preVerificationGas override can't be negative");
		}
		if (
			typeof overrides.verificationGasLimit === "bigint" &&
			overrides.verificationGasLimit < 0n
		) {
			throw new RangeError("verificationGasLimit override can't be negative");
		}
		if (
			typeof overrides.callGasLimit === "bigint" &&
			overrides.callGasLimit < 0n
		) {
			throw new RangeError("callGasLimit override can't be negative");
		}

		const applyMultiplier = (value: bigint, multiplier?: number): bigint =>
			value +
			(value * BigInt(Math.round((multiplier ?? 0) * 100))) / 10000n;

		userOp.preVerificationGas =
			overrides.preVerificationGas ??
			applyMultiplier(
				preVerificationGas,
				overrides.preVerificationGasPercentageMultiplier ?? 5,
			);
		userOp.verificationGasLimit =
			overrides.verificationGasLimit ??
			applyMultiplier(
				verificationGasLimit,
				overrides.verificationGasLimitPercentageMultiplier ?? 10,
			);
		userOp.callGasLimit =
			overrides.callGasLimit ??
			applyMultiplier(
				callGasLimit,
				overrides.callGasLimitPercentageMultiplier ?? 10,
			);

		if (entrypoint === ENTRYPOINT_V6) {
			// Align with CandidePaymaster: add paymaster verification overhead for v0.6.
			userOp.verificationGasLimit += 40_000n;
		}
		// entrypoint v9 has no special handling here; kept for future use.
		void ENTRYPOINT_V9;
	}
}
