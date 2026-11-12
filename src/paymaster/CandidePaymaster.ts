import {isAddress} from "src/ethereUtils";
import {Bundler} from "src/Bundler";
import {ENTRYPOINT_V6, ENTRYPOINT_V7, ENTRYPOINT_V8} from "src/constants";
import {AbstractionKitError} from "src/errors";
import {
	HttpTransport,
	type JsonRpcNode,
	normalizingTransport,
	type RequestArgs,
	type RequestOptions,
	type Transport,
} from "src/transport";
import type {
	ERC20Token,
	ERC20TokenWithExchangeRate,
	PaymasterMetadata,
	PmUserOperationV6Result,
	PmUserOperationV7Result,
	PmUserOperationV8Result,
	SponsorMetadata,
	SupportedERC20TokensAndMetadata,
	SupportedERC20TokensAndMetadataWithExchangeRate,
	TokenQuote,
} from "../types";
import {calculateUserOperationErc20TokenCost} from "../utils";
import {
	type DecodedTokenQuote,
	type DecodeTokenQuoteOverrides,
	decodeTokenQuote as decodeTokenQuoteImpl,
} from "./decodeTokenQuote";
import {
	assertPaymasterMatchesApproveSpender,
	assertValidApproveAmountOverride,
	getUserOperationPaymaster,
	Paymaster,
	resolveTokenApproveAmount,
	toPaymasterError,
} from "./Paymaster";
import type {
	AnyUserOperation,
	CandidePaymasterContext,
	GasPaymasterUserOperationOverrides,
	PrependTokenPaymasterApproveAccount,
	SameUserOp,
	SmartAccountWithEntrypoint,
} from "./types";

/** Buffer added to verificationGasLimit for paymasterAndData verification overhead */
const PAYMASTER_V06_VERIFICATION_OVERHEAD = 40000n;
/** Max value for uint256 */
const UINT256_MAX = 115792089237316195423570985008687907853269984665640564039457584007913129639935n;

/**
 * ERC-20 tokens that require resetting their allowance to 0 before setting a
 * new approval amount (e.g. USDT on mainnet).
 * Addresses are stored lowercase for case-insensitive comparison.
 *
 * If you encounter a token with this behavior that is not listed here,
 * please open an issue at https://github.com/candidelabs/abstractionkit/issues
 * or use the `resetApproval` override as a workaround.
 */
const TOKENS_REQUIRING_ALLOWANCE_RESET: string[] = [
	"0xdac17f958d2ee523a2206206994597c13d831ec7", // USDT (Ethereum mainnet)
];

/**
 * Client for the Candide Paymaster service.
 * Supports both gas sponsorship (sponsor paymaster) and ERC-20 token payment for gas (token paymaster).
 * Auto-initializes on first use by fetching supported tokens and metadata from the paymaster RPC.
 *
 * Candide's paymaster endpoint follows the format:
 * - `https://api.candide.dev/api/v3/{chainId}/{apiKey}` (authenticated)
 * - `https://api.candide.dev/public/v3/{chainId}` (public, no key required)
 *
 * @example
 * const paymaster = new CandidePaymaster("https://api.candide.dev/public/v3/11155111");
 * const { userOperation: sponsoredOp } = await paymaster.createSponsorPaymasterUserOperation(
 *   smartAccount,
 *   userOp,
 *   bundlerRpcUrl,
 * );
 */
export class CandidePaymaster extends Paymaster implements Transport {
	/**
	 * The raw transport the user passed in (or {@link HttpTransport} when a URL
	 * string was passed). Exposed for introspection — reading `.url`,
	 * `isHttpTransport(...)` checks, passing it back into another service.
	 *
	 * Calls made directly on this field (`paymaster.transport.request(...)`)
	 * go to the raw transport and skip SDK-level behavior like bigint param
	 * normalization. For SDK-pipeline behavior, use
	 * {@link CandidePaymaster.request} or the typed methods.
	 */
	readonly transport: Transport;
	/** Normalizing wrapper around {@link transport}, used for every SDK-outbound call. */
	private readonly outbound: Transport;
	/** Cached token/metadata per EntryPoint address (lowercase keys) */
	private entrypointData = new Map<string, SupportedERC20TokensAndMetadata>();
	/** Per-entrypoint initialization promises (lowercase keys) */
	private initPromises = new Map<string, Promise<void>>();
	/** Cached chain ID (hex string), resolved from URL or pm_chainId RPC */
	private chainId: string | null = null;
	private chainIdPromise: Promise<string> | null = null;

	/**
	 * @param rpc - The Candide paymaster JSON-RPC endpoint URL, or any {@link Transport}.
	 *   When a URL string is passed, the chain id is inferred from the URL path
	 *   when possible; otherwise it's resolved lazily via `pm_chainId`.
	 */
	constructor(rpc: string | Transport) {
		super();
		this.transport = typeof rpc === "string" ? new HttpTransport(rpc) : rpc;
		this.outbound = normalizingTransport(this.transport);
		this.chainId = typeof rpc === "string" ? CandidePaymaster.extractChainIdFromUrl(rpc) : null;
	}

	/**
	 * Normalize any acceptable input into a `CandidePaymaster`. Returns the
	 * input by reference when it's already a `CandidePaymaster`.
	 */
	static from(input: string | Transport | CandidePaymaster): CandidePaymaster {
		return input instanceof CandidePaymaster ? input : new CandidePaymaster(input);
	}

	/**
	 * Read the token payment a finished UserOperation commits to, entirely
	 * offline, for co-signers who never saw its `TokenQuote`. Static: needs no
	 * paymaster URL. Same as {@link Erc7677Paymaster.decodeTokenQuote}, which
	 * documents the parameters, result and errors.
	 */
	static decodeTokenQuote(
		userOperation: AnyUserOperation,
		nodeRpcUrl: string | Transport | JsonRpcNode,
		overrides: DecodeTokenQuoteOverrides = {},
	): Promise<DecodedTokenQuote | null> {
		return decodeTokenQuoteImpl(userOperation, nodeRpcUrl, overrides);
	}

	/**
	 * Transport delegate. Forwards directly to {@link Transport.request}, so a
	 * `CandidePaymaster` can be slotted into any other transport position.
	 */
	request<T = unknown>(args: RequestArgs, options?: RequestOptions): Promise<T> {
		return this.outbound.request<T>(args, options);
	}

	/**
	 * Extract chain ID from a Candide paymaster URL.
	 * Matches: https://api.candide.dev/(api|public)/v{N}/{chainId}(/{apiKey})?
	 */
	private static extractChainIdFromUrl(url: string): string | null {
		const match = url.match(/api\.candide\.dev\/(?:api|public)\/v\d+\/(\d+)(?:\/|$)/);
		if (match) {
			return `0x${BigInt(match[1]).toString(16)}`;
		}
		return null;
	}

	/**
	 * Get the chain ID, resolving it from the URL or via pm_chainId RPC.
	 * Deduplicates concurrent calls.
	 */
	private async getChainId(): Promise<string> {
		if (this.chainId != null) {
			return this.chainId;
		}
		if (this.chainIdPromise == null) {
			this.chainIdPromise = this.fetchChainId()
				.then((id) => {
					this.chainId = id;
					return id;
				})
				.catch((err) => {
					this.chainIdPromise = null;
					throw err;
				});
		}
		return this.chainIdPromise;
	}

	private async fetchChainId(): Promise<string> {
		try {
			const result = await this.outbound.request<string>({ method: "pm_chainId" });
			return result;
		} catch (err) {
			throw toPaymasterError("pm_chainId failed", err);
		}
	}

	/**
	 * Determine the EntryPoint address from the UserOperation's shape.
	 * V6 ops have `initCode`, V8 ops have `eip7702Auth`, V7 is the default.
	 */
	private resolveEntrypoint(
		smartAccount: SmartAccountWithEntrypoint,
		userOperation: AnyUserOperation,
	): string {
		if (smartAccount.entrypointAddress != null && smartAccount.entrypointAddress.trim() !== "") {
			return smartAccount.entrypointAddress;
		}
		if ("initCode" in userOperation) return ENTRYPOINT_V6;
		else if ("eip7702Auth" in userOperation) return ENTRYPOINT_V8;
		else return ENTRYPOINT_V7;
	}

	/**
	 * Get the cached entrypoint data for a given entrypoint address.
	 */
	private getEntrypointData(entrypoint: string): SupportedERC20TokensAndMetadata | undefined {
		return this.entrypointData.get(entrypoint.toLowerCase());
	}

	/**
	 * The cached data for `entrypoint`, which `ensureInitialized` has loaded.
	 * A paymaster that does not support the EntryPoint already fails in
	 * `ensureInitialized` (its `pm_supportedERC20Tokens` call errors), so this
	 * guards against a missing cache entry with the same PAYMASTER_ERROR.
	 */
	private requireEntrypointData(entrypoint: string): SupportedERC20TokensAndMetadata {
		const data = this.getEntrypointData(entrypoint);
		if (data == null) {
			throw new AbstractionKitError(
				"PAYMASTER_ERROR",
				`the paymaster does not support entrypoint ${entrypoint}`,
				{ context: { entrypoint } },
			);
		}
		return data;
	}

	private static mapTokens(
		tokens: { name: string; symbol: string; address: string; decimals: number | string }[],
	): ERC20Token[] {
		return tokens.map((t) => ({
			name: t.name,
			symbol: t.symbol,
			address: t.address,
			decimals: Number(t.decimals),
		}));
	}

	private static mapTokensWithExchangeRate(
		tokens: {
			name: string;
			symbol: string;
			address: string;
			decimals: number | string;
			exchangeRate: string | bigint;
		}[],
	): ERC20TokenWithExchangeRate[] {
		return tokens.map((t) => ({
			name: t.name,
			symbol: t.symbol,
			address: t.address,
			decimals: Number(t.decimals),
			exchangeRate: BigInt(t.exchangeRate),
		}));
	}

	/**
	 * Convert dummyPaymasterAndData gas fields from hex strings to bigint.
	 * RPC returns these as hex strings, but our types expect bigint.
	 */
	private static normalizePaymasterMetadata(metadata: PaymasterMetadata): PaymasterMetadata {
		if (typeof metadata.dummyPaymasterAndData !== "string") {
			return {
				...metadata,
				dummyPaymasterAndData: {
					...metadata.dummyPaymasterAndData,
					paymasterVerificationGasLimit: BigInt(
						metadata.dummyPaymasterAndData.paymasterVerificationGasLimit,
					),
					paymasterPostOpGasLimit: BigInt(metadata.dummyPaymasterAndData.paymasterPostOpGasLimit),
				},
			};
		}
		return metadata;
	}

	/**
	 * Ensure the paymaster data for a specific entrypoint is initialized.
	 * Deduplicates concurrent calls for the same entrypoint.
	 * On failure, resets so the next call retries.
	 */
	private ensureInitialized(entrypoint: string): Promise<void> {
		const key = entrypoint.toLowerCase();
		let promise = this.initPromises.get(key);
		if (promise == null) {
			promise = this.doInitialize(entrypoint).catch((err) => {
				this.initPromises.delete(key);
				throw err;
			});
			this.initPromises.set(key, promise);
		}
		return promise;
	}

	/**
	 * Fetch and cache the paymaster's supported tokens and metadata for a specific entrypoint.
	 *
	 * @throws AbstractionKitError with code "PAYMASTER_ERROR" if initialization fails
	 */
	private async doInitialize(entrypoint: string): Promise<void> {
		try {
			const data = await this.fetchAndTransformTokenData(entrypoint);
			if (data == null) {
				// the paymaster's answer, not the caller's input
				throw new AbstractionKitError(
					"PAYMASTER_ERROR",
					`Invalid data received during initialization for entrypoint ${entrypoint}.`,
				);
			}
			this.entrypointData.set(entrypoint.toLowerCase(), data);
		} catch (err) {
			throw toPaymasterError("failed initializing the paymaster", err);
		}
	}

	/**
	 * Fetch supported tokens and metadata for a specific entrypoint from the RPC
	 * and transform the result into a normalized format. Used during initialization.
	 */
	private async fetchAndTransformTokenData(
		entrypoint: string,
	): Promise<SupportedERC20TokensAndMetadata | null> {
		try {
			const jsonRpcResult = await this.fetchSupportedTokensRpc(entrypoint);

			const result = jsonRpcResult as SupportedERC20TokensAndMetadata;
			return {
				tokens: CandidePaymaster.mapTokens(result.tokens),
				paymasterMetadata: CandidePaymaster.normalizePaymasterMetadata(result.paymasterMetadata),
			};
		} catch (err) {
			throw toPaymasterError("fetchAndTransformTokenData failed", err);
		}
	}

	private async fetchSupportedTokensRpc(entrypoint: string): Promise<unknown> {
		return await this.outbound.request({
			method: "pm_supportedERC20Tokens",
			params: [entrypoint],
		});
	}

	/**
	 * Get the EntryPoint addresses supported by this paymaster.
	 *
	 * @returns Array of supported EntryPoint contract addresses
	 */
	async getSupportedEntrypoints(): Promise<string[]> {
		try {
			const result = await this.outbound.request<string[]>({
				method: "pm_supportedEntryPoints",
			});
			return result;
		} catch (err) {
			throw toPaymasterError("pm_supportedEntryPoints failed", err);
		}
	}

	/**
	 * Get the paymaster contract metadata for a specific EntryPoint.
	 * Auto-initializes if not yet initialized.
	 *
	 * @param entrypoint - Target EntryPoint address
	 * @returns The paymaster metadata (name, address, icons, dummyPaymasterAndData, etc.)
	 * @throws AbstractionKitError with code "PAYMASTER_ERROR" if the entrypoint is not supported
	 *   or the paymaster cannot be initialized. The method never resolves to `null`; the
	 *   return type keeps it for compatibility.
	 */
	async getPaymasterMetaData(entrypoint: string): Promise<PaymasterMetadata | null> {
		await this.ensureInitialized(entrypoint);

		return this.requireEntrypointData(entrypoint).paymasterMetadata;
	}

	/**
	 * Check if the token paymaster supports a given ERC-20 token for gas payment.
	 *
	 * @param erc20TokenAddress - The ERC-20 token contract address to check
	 * @param entrypoint - Target EntryPoint address (default: ENTRYPOINT_V7)
	 * @returns true if the token is supported, false otherwise
	 */
	async isSupportedERC20Token(
		erc20TokenAddress: string,
		entrypoint: string = ENTRYPOINT_V7,
	): Promise<boolean> {
		const gasToken = await this.getSupportedERC20TokenData(erc20TokenAddress, entrypoint);
		return gasToken != null;
	}

	/**
	 * Get the paymaster's data for a specific ERC-20 token.
	 *
	 * @param erc20TokenAddress - The ERC-20 token contract address
	 * @param entrypoint - Target EntryPoint address (default: ENTRYPOINT_V7)
	 * @returns The token data (name, symbol, address, decimals), or null if not supported
	 * @throws AbstractionKitError with code "PAYMASTER_ERROR" if the entrypoint is not
	 *   supported or the paymaster cannot be initialized
	 */
	async getSupportedERC20TokenData(
		erc20TokenAddress: string,
		entrypoint: string = ENTRYPOINT_V7,
	): Promise<ERC20Token | null> {
		await this.ensureInitialized(entrypoint);

		const data = this.requireEntrypointData(entrypoint);

		const gasToken = data.tokens.find(
			(token) => token.address.toLowerCase() === erc20TokenAddress.toLowerCase(),
		);

		if (!gasToken) {
			return null;
		}
		return {
			name: gasToken.name,
			symbol: gasToken.symbol,
			address: gasToken.address,
			decimals: Number(gasToken.decimals),
		};
	}

	// ── Private helpers for createPaymasterUserOperation ─────────────

	private setDummyPaymasterFields(
		userOp: AnyUserOperation,
		epData: SupportedERC20TokensAndMetadata,
	): void {
		const dummyPaymasterAndData = epData.paymasterMetadata.dummyPaymasterAndData;
		if ("initCode" in userOp) {
			userOp.paymasterAndData = dummyPaymasterAndData as string;
		} else {
			const structured = dummyPaymasterAndData as Exclude<typeof dummyPaymasterAndData, string>;
			userOp.paymaster = structured.paymaster;
			userOp.paymasterVerificationGasLimit = structured.paymasterVerificationGasLimit;
			userOp.paymasterPostOpGasLimit = structured.paymasterPostOpGasLimit;
			userOp.paymasterData = structured.paymasterData;
		}
	}

	private async estimateAndApplyGasLimits(
		userOp: AnyUserOperation,
		bundlerRpc: string | Transport | Bundler,
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
					"bundlerRpc can't be null if preVerificationGas,verificationGasLimit and callGasLimit are not overridden",
				);
			}
			const bundler = Bundler.from(bundlerRpc);

			userOp.callGasLimit = 0n;
			userOp.verificationGasLimit = 0n;
			userOp.preVerificationGas = 0n;
			const inputMaxFeePerGas = userOp.maxFeePerGas;
			const inputMaxPriorityFeePerGas = userOp.maxPriorityFeePerGas;
			userOp.maxFeePerGas = 0n;
			userOp.maxPriorityFeePerGas = 0n;

			const estimation = await bundler.estimateUserOperationGas(
				userOp,
				entrypoint,
				overrides.state_override_set,
			);

			if (preVerificationGas < estimation.preVerificationGas) {
				preVerificationGas = estimation.preVerificationGas;
			}
			if (verificationGasLimit < estimation.verificationGasLimit) {
				verificationGasLimit = estimation.verificationGasLimit;
			}
			if (callGasLimit < estimation.callGasLimit) {
				callGasLimit = estimation.callGasLimit;
			}

			userOp.maxFeePerGas = inputMaxFeePerGas;
			userOp.maxPriorityFeePerGas = inputMaxPriorityFeePerGas;
		}

		if (typeof overrides.preVerificationGas === "bigint" && overrides.preVerificationGas < 0n) {
			throw new RangeError("preVerificationGas override can't be negative");
		}
		if (typeof overrides.verificationGasLimit === "bigint" && overrides.verificationGasLimit < 0n) {
			throw new RangeError("verificationGasLimit override can't be negative");
		}
		if (typeof overrides.callGasLimit === "bigint" && overrides.callGasLimit < 0n) {
			throw new RangeError("callGasLimit override can't be negative");
		}

		const applyMultiplier = (value: bigint, multiplier?: number): bigint =>
			value + (value * BigInt(Math.round((multiplier ?? 0) * 100))) / 10000n;

		userOp.preVerificationGas =
			overrides.preVerificationGas ??
			applyMultiplier(preVerificationGas, overrides.preVerificationGasPercentageMultiplier ?? 5);
		userOp.verificationGasLimit =
			overrides.verificationGasLimit ??
			applyMultiplier(
				verificationGasLimit,
				overrides.verificationGasLimitPercentageMultiplier ?? 10,
			);
		userOp.callGasLimit =
			overrides.callGasLimit ??
			applyMultiplier(callGasLimit, overrides.callGasLimitPercentageMultiplier ?? 10);

		// Lowercase compare — the entrypoint comes from arbitrary user input
		// and ENTRYPOINT_V6 is checksummed. Skip the buffer when the caller
		// pinned verificationGasLimit explicitly: the override is documented
		// to be used verbatim.
		if (
			overrides.verificationGasLimit == null &&
			entrypoint.toLowerCase() === ENTRYPOINT_V6.toLowerCase()
		) {
			userOp.verificationGasLimit += PAYMASTER_V06_VERIFICATION_OVERHEAD;
		}
	}

	private applyPaymasterResult(
		userOp: AnyUserOperation,
		jsonRpcResult: unknown,
	): SponsorMetadata | undefined {
		const result = jsonRpcResult as
			| PmUserOperationV8Result
			| PmUserOperationV7Result
			| PmUserOperationV6Result;

		if (jsonRpcResult == null || typeof jsonRpcResult !== "object") {
			throw new AbstractionKitError("PAYMASTER_ERROR", "pm_getPaymasterData returned no result");
		}

		// Set version-specific paymaster fields (gas limits/prices are not overridden)
		if ("initCode" in userOp) {
			const v6Result = jsonRpcResult as PmUserOperationV6Result;
			userOp.paymasterAndData = v6Result.paymasterAndData;
		} else {
			const v7Result = jsonRpcResult as PmUserOperationV7Result;
			userOp.paymaster = v7Result.paymaster;
			// ERC-7677 only requires `paymaster` and `paymasterData` here. When
			// the gas limits are left out, the ones already on the operation
			// (from the stub or the commit phase) stay.
			if (v7Result.paymasterVerificationGasLimit != null) {
				userOp.paymasterVerificationGasLimit = BigInt(v7Result.paymasterVerificationGasLimit);
			}
			if (v7Result.paymasterPostOpGasLimit != null) {
				userOp.paymasterPostOpGasLimit = BigInt(v7Result.paymasterPostOpGasLimit);
			}
			userOp.paymasterData = v7Result.paymasterData;
		}

		// ERC-7677 returns sponsor info under `sponsor: { name, icon? }` (singular `icon`).
		// Normalize into the public `SponsorMetadata` shape.
		if (result.sponsor?.name != null) {
			const { name, icon } = result.sponsor;
			return {
				name,
				description: "",
				url: "",
				icons: icon ? [icon] : [],
			};
		}
		return undefined;
	}

	// ── Core paymaster method (private) ──────────────────────────────

	private async createPaymasterUserOperation<T extends AnyUserOperation>(
		smartAccount: SmartAccountWithEntrypoint,
		userOperation: T,
		context: CandidePaymasterContext = {},
		overrides: GasPaymasterUserOperationOverrides = {},
	): Promise<{ userOperation: SameUserOp<T>; sponsorMetadata?: SponsorMetadata }> {
		try {
			const entrypoint =
				overrides.entrypoint ?? this.resolveEntrypoint(smartAccount, userOperation);
			const chainId = await this.getChainId();
			const jsonRpcResult = await this.outbound.request<unknown>({
				method: "pm_getPaymasterData",
				params: [userOperation, entrypoint, chainId, context],
			});
			const sponsorMetadata = this.applyPaymasterResult(userOperation, jsonRpcResult);
			return {
				userOperation: userOperation as unknown as SameUserOp<T>,
				sponsorMetadata,
			};
		} catch (err) {
			throw toPaymasterError("pm_getPaymasterData failed", err);
		}
	}

	// ── Public convenience methods ───────────────────────────────────

	/**
	 * Create a gas-sponsored UserOperation (no token payment required).
	 *
	 * @param smartAccount - The smart account instance
	 * @param userOperation - The UserOperation to sponsor
	 * @param bundlerRpc - Bundler RPC URL for gas estimation
	 * @param sponsorshipPolicyId - Optional sponsorship policy ID
	 * @param context - Optional additional context to pass to the paymaster RPC
	 * @param overrides - Override gas limits and multipliers
	 * @returns An object `{ userOperation, sponsorMetadata? }`
	 * @throws AbstractionKitError with code "PAYMASTER_ERROR" when the paymaster
	 *   fails: an RPC error such as a denied sponsorship policy or an
	 *   unsupported EntryPoint (the `cause`, its JSON-RPC code in `errno`), or
	 *   a response without a paymaster.
	 * @throws AbstractionKitError with code "PAYMASTER_ERROR" when gas estimation
	 *   fails because the paymaster rejected the operation (an EntryPoint
	 *   `AA3x` / `AA50` code, or bundler code -32501 / -32508). The bundler's
	 *   error is the `cause`; `aaCode` and `errno` are copied to the top.
	 * @throws AbstractionKitError with code "BUNDLER_ERROR" when gas estimation
	 *   fails for any other reason (e.g. `AA23`, the account's own validation),
	 *   as from an account's `createUserOperation`; `aaCode` names the
	 *   EntryPoint error.
	 * @throws RangeError for invalid UserOperation input, e.g. a negative gas
	 *   override.
	 */
	async createSponsorPaymasterUserOperation<T extends AnyUserOperation>(
		smartAccount: SmartAccountWithEntrypoint,
		userOperation: T,
		bundlerRpc: string | Transport | Bundler,
		sponsorshipPolicyId?: string,
		context?: CandidePaymasterContext,
		overrides?: GasPaymasterUserOperationOverrides,
	): Promise<{ userOperation: SameUserOp<T>; sponsorMetadata?: SponsorMetadata }> {
		try {
			const userOp = { ...userOperation } as T;
			context = {
				...(context || {}),
				...(sponsorshipPolicyId !== undefined ? { sponsorshipPolicyId } : {}),
			};
			const entrypoint = overrides?.entrypoint ?? this.resolveEntrypoint(smartAccount, userOp);
			await this.ensureInitialized(entrypoint);
			const epData = this.requireEntrypointData(entrypoint);
			if (context.signingPhase !== "finalize") {
				this.setDummyPaymasterFields(userOp, epData);
				await this.estimateAndApplyGasLimits(userOp, bundlerRpc, entrypoint, overrides ?? {});
			}
			const _overrides = { ...(overrides || {}), entrypoint: entrypoint };
			const result = await this.createPaymasterUserOperation(
				smartAccount,
				userOp,
				context,
				_overrides,
			);
			// a response without a paymaster is not a sponsorship
			if (getUserOperationPaymaster(result.userOperation) == null) {
				throw new AbstractionKitError(
					"PAYMASTER_ERROR",
					"pm_getPaymasterData returned no paymaster for the sponsored operation",
				);
			}
			return result;
		} catch (err) {
			// same contract as createTokenPaymasterUserOperation
			throw toPaymasterError("createSponsorPaymasterUserOperation failed", err);
		}
	}

	/**
	 * Create a UserOperation that pays for gas with an ERC-20 token.
	 * Automatically prepends a token approval to the calldata and sets paymaster fields.
	 *
	 * @param smartAccount - The smart account instance (must implement prependTokenPaymasterApproveToCallData)
	 * @param userOperation - The UserOperation to modify for token payment
	 * @param tokenAddress - The ERC-20 token contract address to pay gas with
	 * @param bundlerRpc - Bundler RPC URL for gas estimation
	 * @param context - Optional additional context to pass to the paymaster RPC
	 * @param overrides - Override gas limits and multipliers, and the approval
	 *   (`resetApproval`, `approveAmount`). By default the prepended approval
	 *   grants twice the quoted `tokenCost`; pass `approveAmount` to set it.
	 * @returns An object `{ userOperation, tokenQuote? }`. `tokenQuote` is absent
	 *   when called under the `finalize` signing phase (no cost recomputation).
	 * @throws AbstractionKitError with code "PAYMASTER_ERROR" when the paymaster
	 *   part fails: the token is not a valid address or is not supported
	 *   (`context.supportedTokens` lists the ones that are), an RPC error such
	 *   as an unsupported EntryPoint (the `cause`), a paymaster that differs
	 *   from the one the approval was built for, or an `overrides.approveAmount`
	 *   below the quoted token cost (`context.tokenCost`).
	 * @throws AbstractionKitError with code "PAYMASTER_ERROR" when gas estimation
	 *   fails because the paymaster rejected the operation (an EntryPoint
	 *   `AA3x` / `AA50` code, or bundler code -32501 / -32508). The bundler's
	 *   error is the `cause`; `aaCode` and `errno` are copied to the top.
	 * @throws AbstractionKitError with code "BUNDLER_ERROR" when gas estimation
	 *   fails for any other reason (e.g. `AA23`, the account's own validation),
	 *   as from an account's `createUserOperation`; `aaCode` names the
	 *   EntryPoint error.
	 * @throws RangeError for invalid UserOperation input, e.g. a negative gas
	 *   override.
	 */
	async createTokenPaymasterUserOperation<T extends AnyUserOperation>(
		smartAccount: PrependTokenPaymasterApproveAccount,
		userOperation: T,
		tokenAddress: string,
		bundlerRpc: string | Transport | Bundler,
		context?: CandidePaymasterContext,
		overrides?: GasPaymasterUserOperationOverrides,
	): Promise<{ userOperation: SameUserOp<T>; tokenQuote?: TokenQuote }> {
		try {
			const userOp = { ...userOperation } as T;
			context = {
				...(context || {}),
				token: tokenAddress,
			};
			// The token is paymaster context, so an invalid one is a
			// PAYMASTER_ERROR like an unsupported one, not a RangeError.
			if (!context.token || context.token.trim().length === 0 || !isAddress(context.token)) {
				throw new AbstractionKitError(
					"PAYMASTER_ERROR",
					`Invalid token ${context.token ?? "undefined"}`,
					{ context: { token: context.token } },
				);
			}
			// The finalize phase builds no approval and ignores approveAmount.
			if (context.signingPhase !== "finalize") {
				assertValidApproveAmountOverride(overrides?.approveAmount);
			}
			const entrypoint = overrides?.entrypoint ?? this.resolveEntrypoint(smartAccount, userOp);
			await this.ensureInitialized(entrypoint);
			let tokenQuote: TokenQuote | undefined;
			if (context.signingPhase !== "finalize") {
				const epData = this.requireEntrypointData(entrypoint);
				this.setDummyPaymasterFields(userOp, epData);
				// Prepend an infinite approval and re-estimate gas; a proper
				// allowance is calculated later and replaces the infinite one.
				const oldCallData = userOp.callData;
				const requiresAllowanceReset =
					overrides?.resetApproval ??
					TOKENS_REQUIRING_ALLOWANCE_RESET.includes(context.token.toLowerCase());
				let callDataWithApprove = smartAccount.prependTokenPaymasterApproveToCallData(
					userOp.callData,
					context.token,
					epData.paymasterMetadata.address,
					UINT256_MAX,
				);
				if (requiresAllowanceReset) {
					callDataWithApprove = smartAccount.prependTokenPaymasterApproveToCallData(
						callDataWithApprove,
						context.token,
						epData.paymasterMetadata.address,
						0n,
					);
				}
				userOp.callData = callDataWithApprove;

				await this.estimateAndApplyGasLimits(userOp, bundlerRpc, entrypoint, overrides ?? {});

				const exchangeRate = await this.fetchTokenPaymasterExchangeRate(context.token, entrypoint);
				const tokenCost = calculateUserOperationErc20TokenCost(userOp, exchangeRate);
				const approveAmount = resolveTokenApproveAmount(tokenCost, overrides?.approveAmount);
				tokenQuote = {
					token: context.token,
					exchangeRate,
					tokenCost,
					paymaster: epData.paymasterMetadata.address,
					approveAmount,
				};
				callDataWithApprove = smartAccount.prependTokenPaymasterApproveToCallData(
					oldCallData,
					context.token,
					epData.paymasterMetadata.address,
					approveAmount,
				);
				if (requiresAllowanceReset) {
					callDataWithApprove = smartAccount.prependTokenPaymasterApproveToCallData(
						callDataWithApprove,
						context.token,
						epData.paymasterMetadata.address,
						0n,
					);
				}
				userOp.callData = callDataWithApprove;
			}
			const _overrides = { ...(overrides || {}), entrypoint: entrypoint };
			const { userOperation: resultUserOp } = await this.createPaymasterUserOperation(
				smartAccount,
				userOp,
				context,
				_overrides,
			);
			// The approval was built for the metadata address; the paymaster on
			// the operation comes from pm_getPaymasterData (applyPaymasterResult
			// assigns the response fields unconditionally, so the operation
			// reflects the raw payload). They must agree.
			const epMetadata = this.requireEntrypointData(entrypoint);
			assertPaymasterMatchesApproveSpender(
				getUserOperationPaymaster(resultUserOp),
				epMetadata.paymasterMetadata.address,
			);
			return { userOperation: resultUserOp, tokenQuote };
		} catch (err) {
			throw toPaymasterError("createTokenPaymasterUserOperation failed", err);
		}
	}

	/**
	 * Calculate the maximum ERC-20 token cost for a UserOperation's gas.
	 * Uses the token's exchange rate from the paymaster to convert from wei.
	 *
	 * @param smartAccount - The smart account instance
	 * @param userOperation - The UserOperation to calculate the cost for
	 * @param erc20TokenAddress - The ERC-20 token contract address
	 * @param overrides - Optional entrypoint override
	 * @returns Maximum token cost as a bigint (in token's smallest unit)
	 * @throws AbstractionKitError with code "PAYMASTER_ERROR" if the token is not supported
	 */
	async calculateUserOperationErc20TokenMaxGasCost(
		smartAccount: SmartAccountWithEntrypoint,
		userOperation: AnyUserOperation,
		erc20TokenAddress: string,
		overrides: { entrypoint?: string | null } = {},
	): Promise<bigint> {
		try {
			const entrypoint =
				overrides.entrypoint ?? this.resolveEntrypoint(smartAccount, userOperation);
			await this.ensureInitialized(entrypoint);
			const exchangeRate = await this.fetchTokenPaymasterExchangeRate(
				erc20TokenAddress,
				entrypoint,
			);
			return calculateUserOperationErc20TokenCost(userOperation, exchangeRate);
		} catch (err) {
			throw toPaymasterError("calculateUserOperationErc20TokenMaxGasCost failed", err);
		}
	}

	/**
	 * Fetch the current exchange rate for an ERC-20 token from the paymaster.
	 *
	 * @param erc20TokenAddress - The ERC-20 token contract address
	 * @param entrypoint - Target EntryPoint address (default: ENTRYPOINT_V7)
	 * @returns The exchange rate as a bigint
	 * @throws AbstractionKitError with code "PAYMASTER_ERROR" if the token is not supported
	 */
	async fetchTokenPaymasterExchangeRate(
		erc20TokenAddress: string,
		entrypoint: string = ENTRYPOINT_V7,
	): Promise<bigint> {
		try {
			await this.ensureInitialized(entrypoint);

			const jsonRpcResult = (await this.fetchSupportedTokensRpc(
				entrypoint,
			)) as SupportedERC20TokensAndMetadataWithExchangeRate;

			const gasToken = jsonRpcResult.tokens.find(
				(token) => token.address.toLowerCase() === erc20TokenAddress.toLowerCase(),
			);

			if (!gasToken) {
				throw new AbstractionKitError(
					"PAYMASTER_ERROR",
					`${erc20TokenAddress} token is not supported by the paymaster.`,
					{
						context: {
							entrypoint,
							supportedTokens: jsonRpcResult.tokens.map((t) => t.address),
						},
					},
				);
			}
			const exchangeRate = BigInt(gasToken.exchangeRate);
			if (exchangeRate <= 0n) {
				throw new AbstractionKitError(
					"PAYMASTER_ERROR",
					`pm_supportedERC20Tokens returned a non-positive exchangeRate for token ${erc20TokenAddress} (got ${exchangeRate})`,
				);
			}
			return exchangeRate;
		} catch (err) {
			throw toPaymasterError("fetchTokenPaymasterExchangeRate failed", err);
		}
	}

	/**
	 * Fetch fresh supported ERC-20 tokens with exchange rates and paymaster metadata.
	 * Unlike the cached version, this always makes an RPC call.
	 *
	 * @param entrypoint - Target EntryPoint address (default: ENTRYPOINT_V7)
	 * @returns Supported tokens with exchange rates and paymaster metadata
	 * @throws AbstractionKitError with code "PAYMASTER_ERROR" if the call fails
	 */
	async fetchSupportedERC20TokensAndPaymasterMetadata(
		entrypoint: string = ENTRYPOINT_V7,
	): Promise<SupportedERC20TokensAndMetadataWithExchangeRate> {
		try {
			await this.ensureInitialized(entrypoint);

			this.requireEntrypointData(entrypoint);

			const result = (await this.fetchSupportedTokensRpc(
				entrypoint,
			)) as SupportedERC20TokensAndMetadataWithExchangeRate;
			return {
				tokens: CandidePaymaster.mapTokensWithExchangeRate(result.tokens),
				paymasterMetadata: CandidePaymaster.normalizePaymasterMetadata(result.paymasterMetadata),
			};
		} catch (err) {
			throw toPaymasterError("fetchSupportedERC20TokensAndPaymasterMetadata failed", err);
		}
	}
}
