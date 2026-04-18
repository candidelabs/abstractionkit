import { Paymaster } from "./Paymaster";
import { Bundler } from "../Bundler";
import { calculateUserOperationMaxGasCost, sendJsonRpcRequest } from "../utils";
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
	PrependTokenPaymasterApproveAccount,
	GasPaymasterUserOperationOverrides,
	Erc7677Provider,
	Erc7677PaymasterConstructorOptions,
} from "./types";

/** Max value for uint256 */
const UINT256_MAX = 115792089237316195423570985008687907853269984665640564039457584007913129639935n;
/** Multiplier for token approve amount to cover paymasterAndData cost variance */
const TOKEN_APPROVE_AMOUNT_MULTIPLIER = 2n;
/**
 * ERC-20 tokens that require resetting their allowance to 0 before setting a
 * new approval amount (e.g. USDT on mainnet).
 */
const TOKENS_REQUIRING_ALLOWANCE_RESET: string[] = [
	"0xdac17f958d2ee523a2206206994597c13d831ec7", // USDT (Ethereum mainnet)
];
/**
 * Time-to-live for cached Candide `pm_supportedERC20Tokens` responses, applied
 * only when the fetch is initiated for an exchange-rate lookup. Stub-data
 * lookups (paymaster address + dummyPaymasterAndData) reuse the cache
 * indefinitely since those fields are effectively static per EP.
 */
const CANDIDE_TOKEN_QUOTE_TTL_MS = 45_000;

/**
 * Opaque context object forwarded to the paymaster RPC as the fourth argument
 * of `pm_getPaymasterStubData` / `pm_getPaymasterData`.
 *
 * The shape is provider-specific: Candide uses `{ token }` for token paymaster
 * and `{ sponsorshipPolicyId }` for sponsored operations; other providers
 * (Pimlico, Alchemy, Biconomy, …) have their own conventions. Refer to the
 * paymaster provider's documentation for the exact fields.
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
 * paymaster provider that implements the standard (Candide, Pimlico, Alchemy,
 * Biconomy, …).
 *
 * For Candide-hosted paymasters, {@link CandidePaymaster} is the dedicated
 * client and offers extra features (parallel signing phases, etc.). This
 * generic class is provided so consumers retain the freedom to switch
 * providers without changing the SDK.
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
 * When `context.token` is set and the smart account implements
 * `prependTokenPaymasterApproveToCallData`, the class automatically runs the
 * token paymaster pipeline:
 *
 * - **Provider detected** (Candide, Pimlico): fetches exchange rate and
 *   paymaster address via provider-specific RPC, then handles approval
 *   prepending, gas estimation, and final paymaster data automatically.
 * - **No provider, `context.exchangeRate` set**: uses the provided rate;
 *   paymaster address comes from `pm_getPaymasterStubData`.
 * - **No provider, no `exchangeRate`**: falls through to the regular
 *   sponsored flow — the developer is responsible for prepending the
 *   approval and calculating the amount.
 *
 * @example Sponsored UserOperation (Candide)
 * ```ts
 * const paymaster = new Erc7677Paymaster(candideUrl);
 * const sponsoredOp = await paymaster.createPaymasterUserOperation(
 *   smartAccount,
 *   userOp,
 *   bundlerRpc,
 *   { sponsorshipPolicyId: "sp_melted_jackpot" },
 * );
 * sponsoredOp.signature = smartAccount.signUserOperation(sponsoredOp, [pk], chainId);
 * await new Bundler(bundlerRpc).sendUserOperation(sponsoredOp, smartAccount.entrypointAddress);
 * ```
 *
 * @example Token paymaster (Candide — automatic, provider auto-detected)
 * ```ts
 * const paymaster = new Erc7677Paymaster(candideUrl);
 * const tokenOp = await paymaster.createPaymasterUserOperation(
 *   smartAccount,
 *   userOp,
 *   bundlerRpc,
 *   { token: usdtAddress },
 * );
 * ```
 *
 * @example Token paymaster (unknown provider, exchangeRate supplied)
 * ```ts
 * const paymaster = new Erc7677Paymaster(customUrl);
 * const tokenOp = await paymaster.createPaymasterUserOperation(
 *   smartAccount,
 *   userOp,
 *   bundlerRpc,
 *   { token: usdtAddress, exchangeRate: "1000000000000000000" },
 * );
 * ```
 */
/**
 * Raw shape of Candide's `pm_supportedERC20Tokens` response.
 * `dummyPaymasterAndData` is a concatenated hex string for EntryPoint v0.6 and
 * a structured object for v0.7+.
 */
interface CandideSupportedResponse {
	tokens: Array<{ address: string; exchangeRate: string }>;
	paymasterMetadata: {
		address: string;
		dummyPaymasterAndData:
			| string
			| {
				paymaster: string;
				paymasterVerificationGasLimit: string;
				paymasterPostOpGasLimit: string;
				paymasterData: string;
			};
	};
}

export class Erc7677Paymaster extends Paymaster {
	/** The paymaster JSON-RPC endpoint URL */
	readonly rpcUrl: string;
	/** Cached chain ID (hex string). Passed via constructor or resolved from the bundler at first use. */
	private chainId: string | null;
	/** Detected or explicitly set paymaster provider. `null` means no provider-specific features. */
	readonly provider: Erc7677Provider;
	/**
	 * Cached Candide `pm_supportedERC20Tokens` response, keyed by lowercase
	 * entrypoint. Used for both token quotes and stub data to avoid a second
	 * round-trip (`pm_getPaymasterStubData`) for Candide-hosted paymasters.
	 *
	 * The cache is indefinite for stub-data lookups but has a TTL for
	 * exchange-rate lookups — see {@link CANDIDE_TOKEN_QUOTE_TTL_MS}.
	 */
	private candideCache = new Map<string, { data: CandideSupportedResponse; fetchedAt: number }>();

	/**
	 * Detect the paymaster provider from the RPC URL hostname.
	 * Returns `null` for unknown hosts or malformed URLs.
	 *
	 * Hostname-based (not substring) so that proxies or paths containing a
	 * provider name (e.g. `https://my-proxy.com/pimlico-compat/...`) are not
	 * misidentified.
	 */
	static detectProvider(rpcUrl: string): Erc7677Provider {
		let host: string;
		try {
			host = new URL(rpcUrl).hostname.toLowerCase();
		} catch {
			return null;
		}
		if (host === "pimlico.io" || host.endsWith(".pimlico.io")) return "pimlico";
		if (host === "candide.dev" || host.endsWith(".candide.dev")) return "candide";
		return null;
	}

	/**
	 * @param rpcUrl - Paymaster JSON-RPC endpoint. Can be the same URL as the
	 *   bundler when the provider bundles both (Candide, Pimlico, Alchemy);
	 *   can also be a separate paymaster-only endpoint.
	 * @param options
	 * @param options.chainId - Optional chain id as a bigint (e.g. `1n` for
	 *   mainnet). When provided, avoids a lookup at first use. Otherwise,
	 *   resolved from the bundler via `eth_chainId` on the first call.
	 * @param options.provider - Paymaster provider. `"auto"` (default) detects
	 *   from the RPC URL. Set explicitly to override, or `null` to disable.
	 */
	constructor(rpcUrl: string, options: Erc7677PaymasterConstructorOptions = {}) {
		super();
		this.rpcUrl = rpcUrl;
		this.chainId = options.chainId != null ? "0x" + options.chainId.toString(16) : null;
		if (options.provider === undefined || options.provider === "auto") {
			this.provider = Erc7677Paymaster.detectProvider(rpcUrl);
		} else {
			this.provider = options.provider;
		}
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
	 * Send an arbitrary JSON-RPC request through the paymaster endpoint.
	 * Useful for provider-specific methods that fall outside the ERC-7677 spec.
	 *
	 * @param method - The JSON-RPC method name
	 * @param params - The JSON-RPC params array
	 * @returns The `result` field from the JSON-RPC response
	 */
	async sendRPCRequest(
		method: string,
		params: unknown[] = [],
	): Promise<unknown> {
		try {
			return await sendJsonRpcRequest(this.rpcUrl, method, params);
		} catch (err) {
			throw new AbstractionKitError(
				"PAYMASTER_ERROR",
				`sendRPCRequest(${method}) failed`,
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

			// Token paymaster flow: triggered when context.token is set
			if (
				context.token != null &&
				typeof context.token === "string"
			) {
				return this.tokenPaymasterFlow(
					smartAccount as unknown as PrependTokenPaymasterApproveAccount,
					userOp,
					context.token as string,
					bundlerRpc,
					entrypoint,
					chainIdHex,
					context,
					overrides,
				);
			}

			// Delegate to the sponsored flow (stub → estimate → final).
			return this.sponsoredFlow(
				userOp,
				bundlerRpc,
				entrypoint,
				chainIdHex,
				context,
				overrides,
			);
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
	 * Reads paymaster gas fields back from the bundler when present — some
	 * providers' `pm_getPaymasterStubData` returns `paymasterPostOpGasLimit: 0x1`
	 * as a placeholder, relying on the bundler's estimate for the real value.
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

	// ── Provider-specific exchange-rate helpers ──────────────────────────

	/**
	 * Fetch token exchange rate and paymaster address via Pimlico's
	 * `pimlico_getTokenQuotes` RPC.
	 */
	private async fetchPimlicoTokenQuote(
		tokenAddress: string,
		entrypoint: string,
		chainIdHex: string,
	): Promise<{ exchangeRate: bigint; paymasterAddress: string }> {
		const result = await sendJsonRpcRequest(
			this.rpcUrl,
			"pimlico_getTokenQuotes",
			[{ tokens: [tokenAddress] }, entrypoint, chainIdHex],
		) as { quotes?: Array<{ paymaster: string; token: string; exchangeRate: string }> };

		const quotes = result?.quotes;
		if (!Array.isArray(quotes) || quotes.length === 0) {
			throw new AbstractionKitError(
				"PAYMASTER_ERROR",
				`pimlico_getTokenQuotes returned no quotes for token ${tokenAddress}`,
			);
		}
		const quote = quotes.find(
			(q) => q.token.toLowerCase() === tokenAddress.toLowerCase(),
		);
		if (quote == null) {
			throw new AbstractionKitError(
				"PAYMASTER_ERROR",
				`pimlico_getTokenQuotes did not include token ${tokenAddress}`,
			);
		}
		return {
			exchangeRate: BigInt(quote.exchangeRate),
			paymasterAddress: quote.paymaster,
		};
	}

	/**
	 * Fetch (and cache) Candide's `pm_supportedERC20Tokens` response for the
	 * given entrypoint. The response carries both exchange rates and the
	 * `dummyPaymasterAndData` used for gas estimation, so one round-trip
	 * suffices for the entire paymaster flow.
	 *
	 * @param options.enforceTTL - When true, re-fetches if the cached entry is
	 *   older than {@link CANDIDE_TOKEN_QUOTE_TTL_MS}. Set by exchange-rate
	 *   lookups (where staleness matters). Stub-data lookups leave this false
	 *   and reuse the cache indefinitely — the paymaster address and
	 *   `dummyPaymasterAndData` are effectively static per paymaster version.
	 */
	private async fetchCandideSupportedTokens(
		entrypoint: string,
		options: { enforceTTL?: boolean } = {},
	): Promise<CandideSupportedResponse> {
		const key = entrypoint.toLowerCase();
		const cached = this.candideCache.get(key);
		const isStale = cached != null
			&& options.enforceTTL === true
			&& Date.now() - cached.fetchedAt > CANDIDE_TOKEN_QUOTE_TTL_MS;
		if (cached != null && !isStale) return cached.data;
		const result = await sendJsonRpcRequest(
			this.rpcUrl,
			"pm_supportedERC20Tokens",
			[entrypoint],
		) as unknown as CandideSupportedResponse;
		this.candideCache.set(key, { data: result, fetchedAt: Date.now() });
		return result;
	}

	/**
	 * Fetch token exchange rate and paymaster address via Candide's
	 * `pm_supportedERC20Tokens` RPC.
	 */
	private async fetchCandideTokenQuote(
		tokenAddress: string,
		entrypoint: string,
	): Promise<{ exchangeRate: bigint; paymasterAddress: string }> {
		const result = await this.fetchCandideSupportedTokens(entrypoint, { enforceTTL: true });

		const token = result.tokens?.find(
			(t) => t.address.toLowerCase() === tokenAddress.toLowerCase(),
		);
		if (token == null) {
			throw new AbstractionKitError(
				"PAYMASTER_ERROR",
				`${tokenAddress} token is not supported by the Candide paymaster`,
			);
		}
		return {
			exchangeRate: BigInt(token.exchangeRate),
			paymasterAddress: result.paymasterMetadata.address,
		};
	}

	/**
	 * Convert Candide's `dummyPaymasterAndData` metadata into a stub result
	 * compatible with {@link applyPaymasterFields}. Handles both v0.6
	 * (concatenated hex string) and v0.7+ (structured) shapes.
	 */
	private candideStubFromMetadata(
		metadata: CandideSupportedResponse["paymasterMetadata"],
	): Erc7677StubDataResult {
		const dummy = metadata.dummyPaymasterAndData;
		if (typeof dummy === "string") {
			return { paymasterAndData: dummy };
		}
		return {
			paymaster: dummy.paymaster,
			paymasterData: dummy.paymasterData,
			paymasterVerificationGasLimit: dummy.paymasterVerificationGasLimit,
			paymasterPostOpGasLimit: dummy.paymasterPostOpGasLimit,
		};
	}

	/**
	 * Get stub paymaster data. For Candide-hosted paymasters this derives the
	 * stub from the cached `pm_supportedERC20Tokens` response (no extra
	 * round-trip). For other providers, falls back to `pm_getPaymasterStubData`.
	 */
	private async getStubData(
		userOperation: AnyUserOperation,
		entrypoint: string,
		chainIdHex: string,
		context: Erc7677Context,
	): Promise<Erc7677StubDataResult> {
		if (this.provider === "candide") {
			const response = await this.fetchCandideSupportedTokens(entrypoint);
			return this.candideStubFromMetadata(response.paymasterMetadata);
		}
		return this.getPaymasterStubData(userOperation, entrypoint, chainIdHex, context);
	}

	/**
	 * Route to the correct provider-specific token quote fetcher.
	 * Returns `null` when no provider is configured.
	 */
	public async fetchProviderTokenQuote(
		tokenAddress: string,
		entrypoint: string,
		chainIdHex: string,
	): Promise<{ exchangeRate: bigint; paymasterAddress: string } | null> {
		switch (this.provider) {
			case "pimlico":
				return this.fetchPimlicoTokenQuote(tokenAddress, entrypoint, chainIdHex);
			case "candide":
				return this.fetchCandideTokenQuote(tokenAddress, entrypoint);
			default:
				return null;
		}
	}

	// ── Token paymaster flow ────────────────────────────────────────────

	/**
	 * Internal token paymaster pipeline. Called from `createPaymasterUserOperation`
	 * when `context.token` is set and the smart account supports approval prepending.
	 *
	 * Three cases:
	 * - **Provider detected**: exchange rate + paymaster address from provider RPC.
	 * - **No provider, `context.exchangeRate` set**: uses provided rate, paymaster
	 *   address from stub.
	 * - **No provider, no rate**: falls through to the regular sponsored flow
	 *   (developer already handled approval).
	 */
	private async tokenPaymasterFlow<T extends AnyUserOperation>(
		smartAccount: PrependTokenPaymasterApproveAccount,
		userOp: T,
		tokenAddress: string,
		bundlerRpc: string,
		entrypoint: string,
		chainIdHex: string,
		context: Erc7677Context,
		overrides: GasPaymasterUserOperationOverrides,
	): Promise<SameUserOp<T>> {
		// Step 1 — resolve exchange rate + paymaster address.
		let exchangeRate: bigint;
		let paymasterAddress: string | null = null;

		const providerQuote = await this.fetchProviderTokenQuote(
			tokenAddress,
			entrypoint,
			chainIdHex,
		);

		if (providerQuote != null) {
			// Case A: provider detected.
			exchangeRate = providerQuote.exchangeRate;
			paymasterAddress = providerQuote.paymasterAddress;
		} else if (context.exchangeRate != null) {
			// Case B: no provider, but exchangeRate in context.
			// paymasterAddress is resolved from the stub response below.
			exchangeRate = BigInt(context.exchangeRate as string | bigint);
		} else {
			// Case C: no provider, no exchangeRate — fall through to regular flow.
			return this.sponsoredFlow(
				userOp,
				bundlerRpc,
				entrypoint,
				chainIdHex,
				context,
				overrides,
			);
		}

		// Step 2 — stub paymaster data for gas estimation.
		// For Candide, this is derived from the cached `pm_supportedERC20Tokens`
		// response (same RPC call used for the exchange rate above) — no extra
		// `pm_getPaymasterStubData` round-trip.
		const stub = await this.getStubData(
			userOp,
			entrypoint,
			chainIdHex,
			context,
		);
		this.applyPaymasterFields(userOp, stub);

		// For Case B, resolve paymasterAddress from stub or context override.
		if (paymasterAddress == null) {
			if (context.paymasterAddress != null) {
				paymasterAddress = context.paymasterAddress as string;
			} else if ("initCode" in userOp && stub.paymasterAndData != null) {
				// v0.6: extract address from first 20 bytes of paymasterAndData.
				paymasterAddress = "0x" + stub.paymasterAndData.slice(2, 42);
			} else if (stub.paymaster != null) {
				paymasterAddress = stub.paymaster;
			} else {
				throw new AbstractionKitError(
					"PAYMASTER_ERROR",
					"pm_getPaymasterStubData did not return a paymaster address. " +
					"Pass paymasterAddress in the context or set a provider.",
				);
			}
		}

		// Step 3 — save original callData, prepend approve(paymaster, UINT256_MAX).
		const originalCallData = userOp.callData;
		const requiresAllowanceReset = overrides.resetApproval
			?? TOKENS_REQUIRING_ALLOWANCE_RESET.includes(tokenAddress.toLowerCase());

		let callDataWithApprove = smartAccount.prependTokenPaymasterApproveToCallData(
			userOp.callData,
			tokenAddress,
			paymasterAddress,
			UINT256_MAX,
		);
		if (requiresAllowanceReset) {
			callDataWithApprove = smartAccount.prependTokenPaymasterApproveToCallData(
				callDataWithApprove,
				tokenAddress,
				paymasterAddress,
				0n,
			);
		}
		userOp.callData = callDataWithApprove;

		// Step 4 — estimate gas limits.
		await this.estimateAndApplyGasLimits(userOp, bundlerRpc, entrypoint, overrides);

		// Step 5 — calculate real token cost.
		const maxGasCostWei = calculateUserOperationMaxGasCost(userOp);
		const tokenCost = (exchangeRate * maxGasCostWei) / (10n ** 18n);
		const approveAmount = tokenCost * TOKEN_APPROVE_AMOUNT_MULTIPLIER;

		// Step 6 — replace dummy approval with calculated amount on original callData.
		callDataWithApprove = smartAccount.prependTokenPaymasterApproveToCallData(
			originalCallData,
			tokenAddress,
			paymasterAddress,
			approveAmount,
		);
		if (requiresAllowanceReset) {
			callDataWithApprove = smartAccount.prependTokenPaymasterApproveToCallData(
				callDataWithApprove,
				tokenAddress,
				paymasterAddress,
				0n,
			);
		}
		userOp.callData = callDataWithApprove;

		// Step 7 — if the stub was already final, we're done.
		if (stub.isFinal === true) {
			return userOp as unknown as SameUserOp<T>;
		}

		// Step 8 — final paymaster data (signature over the fully-populated userOp).
		const final = await this.getPaymasterData(
			userOp,
			entrypoint,
			chainIdHex,
			context,
		);
		this.applyPaymasterFields(userOp, final);

		return userOp as unknown as SameUserOp<T>;
	}

	/**
	 * The regular (non-token) sponsored flow: stub → estimate → final.
	 * Extracted to allow `tokenPaymasterFlow` to fall through to it for Case C.
	 */
	private async sponsoredFlow<T extends AnyUserOperation>(
		userOp: T,
		bundlerRpc: string,
		entrypoint: string,
		chainIdHex: string,
		context: Erc7677Context,
		overrides: GasPaymasterUserOperationOverrides,
	): Promise<SameUserOp<T>> {
		// Step 1 — stub paymaster data for gas estimation.
		// Candide-hosted paymasters skip `pm_getPaymasterStubData` and use the
		// cached `pm_supportedERC20Tokens` response instead.
		const stub = await this.getStubData(
			userOp,
			entrypoint,
			chainIdHex,
			context,
		);
		this.applyPaymasterFields(userOp, stub);

		// Step 2 — gas estimation with the stub paymaster applied.
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
	}
}
