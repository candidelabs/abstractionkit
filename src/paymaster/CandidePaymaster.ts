import { isAddress } from "ethers";
import { Bundler } from "src/Bundler";
import { ENTRYPOINT_V6, ENTRYPOINT_V7, ENTRYPOINT_V8 } from "src/constants";
import { AbstractionKitError, ensureError } from "src/errors";
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
} from "../types";
import { calculateUserOperationMaxGasCost, sendJsonRpcRequest } from "../utils";
import { Paymaster } from "./Paymaster";
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
/** Multiplier for token approve amount to cover paymasterAndData cost variance */
const TOKEN_APPROVE_AMOUNT_MULTIPLIER = 2n;

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
 * const [sponsoredOp] = await paymaster.createSponsorPaymasterUserOperation(userOp, bundlerRpcUrl);
 */
export class CandidePaymaster extends Paymaster {
	/** The paymaster JSON-RPC endpoint URL */
	readonly rpcUrl: string;
	/** Cached token/metadata per EntryPoint address (lowercase keys) */
	private entrypointData = new Map<string, SupportedERC20TokensAndMetadata>();
	/** Per-entrypoint initialization promises (lowercase keys) */
	private initPromises = new Map<string, Promise<void>>();
	/** Cached chain ID (hex string), resolved from URL or pm_chainId RPC */
	private chainId: string | null = null;
	private chainIdPromise: Promise<string> | null = null;

	/** @param rpcUrl - The Candide paymaster JSON-RPC endpoint URL */
	constructor(rpcUrl: string) {
		super();
		this.rpcUrl = rpcUrl;
		this.chainId = CandidePaymaster.extractChainIdFromUrl(rpcUrl);
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
			const result = await sendJsonRpcRequest(this.rpcUrl, "pm_chainId", []);
			return result as string;
		} catch (err) {
			const error = ensureError(err);
			throw new AbstractionKitError("PAYMASTER_ERROR", "pm_chainId failed", { cause: error });
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
				throw new RangeError(
					`Invalid data received during initialization for entrypoint ${entrypoint}.`,
				);
			}
			this.entrypointData.set(entrypoint.toLowerCase(), data);
		} catch (err) {
			const error = ensureError(err);

			throw new AbstractionKitError("PAYMASTER_ERROR", "failed initializing the paymaster", {
				cause: error,
			});
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
			const error = ensureError(err);

			throw new AbstractionKitError("PAYMASTER_ERROR", "fetchAndTransformTokenData failed", {
				cause: error,
			});
		}
	}

	private async fetchSupportedTokensRpc(entrypoint: string): Promise<unknown> {
		return await sendJsonRpcRequest(this.rpcUrl, "pm_supportedERC20Tokens", [entrypoint]);
	}

	/**
	 * Get the EntryPoint addresses supported by this paymaster.
	 *
	 * @returns Array of supported EntryPoint contract addresses
	 */
	async getSupportedEntrypoints(): Promise<string[]> {
		try {
			const result = await sendJsonRpcRequest(this.rpcUrl, "pm_supportedEntryPoints", []);
			return result as string[];
		} catch (err) {
			const error = ensureError(err);

			throw new AbstractionKitError("PAYMASTER_ERROR", "pm_supportedEntryPoints failed", {
				cause: error,
			});
		}
	}

	/**
	 * Get the paymaster contract metadata for a specific EntryPoint.
	 * Auto-initializes if not yet initialized.
	 *
	 * @param entrypoint - Target EntryPoint address
	 * @returns The paymaster metadata (name, address, icons, dummyPaymasterAndData, etc.)
	 * @throws RangeError if the entrypoint is not supported
	 */
	async getPaymasterMetaData(entrypoint: string): Promise<PaymasterMetadata | null> {
		await this.ensureInitialized(entrypoint);

		const data = this.getEntrypointData(entrypoint);
		if (data == null) {
			throw new RangeError("unsupported entrypoint.");
		}
		return data.paymasterMetadata;
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
	 * @throws RangeError if the entrypoint is not supported
	 */
	async getSupportedERC20TokenData(
		erc20TokenAddress: string,
		entrypoint: string = ENTRYPOINT_V7,
	): Promise<ERC20Token | null> {
		await this.ensureInitialized(entrypoint);

		const data = this.getEntrypointData(entrypoint);
		if (data == null) {
			throw new RangeError("unsupported entrypoint.");
		}

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
					"bundlerRpc can't be null if preVerificationGas,verificationGasLimit and callGasLimit are not overridden",
				);
			}
			const bundler = new Bundler(bundlerRpc);

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

		if (entrypoint === ENTRYPOINT_V6) {
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

		// Set version-specific paymaster fields (gas limits/prices are not overridden)
		if ("initCode" in userOp) {
			const v6Result = jsonRpcResult as PmUserOperationV6Result;
			userOp.paymasterAndData = v6Result.paymasterAndData;
		} else {
			const v7Result = jsonRpcResult as PmUserOperationV7Result;
			userOp.paymaster = v7Result.paymaster;
			userOp.paymasterVerificationGasLimit = BigInt(v7Result.paymasterVerificationGasLimit);
			userOp.paymasterPostOpGasLimit = BigInt(v7Result.paymasterPostOpGasLimit);
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
	): Promise<[SameUserOp<T>, SponsorMetadata | undefined]> {
		try {
			const entrypoint =
				overrides.entrypoint ?? this.resolveEntrypoint(smartAccount, userOperation);
			const chainId = await this.getChainId();
			const jsonRpcResult = await sendJsonRpcRequest(this.rpcUrl, "pm_getPaymasterData", [
				userOperation,
				entrypoint,
				chainId,
				context,
			]);
			const sponsorMetadata = this.applyPaymasterResult(userOperation, jsonRpcResult);
			return [userOperation as unknown as SameUserOp<T>, sponsorMetadata];
		} catch (err) {
			const error = ensureError(err);
			throw new AbstractionKitError("PAYMASTER_ERROR", "pm_getPaymasterData failed", {
				cause: error,
			});
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
	 * @param overrides - Override gas limits, multipliers, and optional context
	 * @returns A tuple of [UserOperation, SponsorMetadata | undefined]
	 * @throws AbstractionKitError with code "PAYMASTER_ERROR" if sponsorship fails
	 */
	async createSponsorPaymasterUserOperation<T extends AnyUserOperation>(
		smartAccount: SmartAccountWithEntrypoint,
		userOperation: T,
		bundlerRpc: string,
		sponsorshipPolicyId?: string,
		overrides?: GasPaymasterUserOperationOverrides,
	): Promise<[SameUserOp<T>, SponsorMetadata | undefined]> {
		const userOp = { ...userOperation } as T;
		const context: CandidePaymasterContext = { sponsorshipPolicyId, ...(overrides?.context || {}) };
		const entrypoint = overrides?.entrypoint ?? this.resolveEntrypoint(smartAccount, userOp);
		await this.ensureInitialized(entrypoint);
		const epData = this.getEntrypointData(entrypoint);
		if (epData == null) {
			throw new RangeError(`UserOperation for entrypoint ${entrypoint} is not supported`);
		}
		if (context.signingPhase !== "finalize") {
			this.setDummyPaymasterFields(userOp, epData);
			await this.estimateAndApplyGasLimits(userOp, bundlerRpc, entrypoint, overrides ?? {});
		}
		const _overrides = { ...(overrides || {}), entrypoint: entrypoint };
		return await this.createPaymasterUserOperation(smartAccount, userOp, context, _overrides);
	}

	/**
	 * Create a UserOperation that pays for gas with an ERC-20 token.
	 * Automatically prepends a token approval to the calldata and sets paymaster fields.
	 *
	 * @param smartAccount - The smart account instance (must implement prependTokenPaymasterApproveToCallData)
	 * @param userOperation - The UserOperation to modify for token payment
	 * @param tokenAddress - The ERC-20 token contract address to pay gas with
	 * @param bundlerRpc - Bundler RPC URL for gas estimation
	 * @param overrides - Override gas limits, multipliers, and optional context
	 * @returns The UserOperation with token approval prepended and paymaster fields set
	 * @throws AbstractionKitError with code "PAYMASTER_ERROR" if the token is not supported
	 */
	async createTokenPaymasterUserOperation<T extends AnyUserOperation>(
		smartAccount: PrependTokenPaymasterApproveAccount,
		userOperation: T,
		tokenAddress: string,
		bundlerRpc: string,
		overrides?: GasPaymasterUserOperationOverrides,
	): Promise<SameUserOp<T>> {
		try {
			const userOp = { ...userOperation } as T;
			const context: CandidePaymasterContext = {
				token: tokenAddress,
				...(overrides?.context || {}),
			};
			if (!context.token || context.token.trim().length === 0 || !isAddress(context.token)) {
				throw new RangeError(`Invalid token ${context.token ?? "undefined"}`);
			}
			const entrypoint = overrides?.entrypoint ?? this.resolveEntrypoint(smartAccount, userOp);
			await this.ensureInitialized(entrypoint);
			if (context.signingPhase !== "finalize") {
				const epData = this.getEntrypointData(entrypoint);
				if (epData == null) {
					throw new RangeError(`UserOperation for entrypoint ${entrypoint} is not supported`);
				}
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

				const maxErc20Cost = await this.calculateUserOperationErc20TokenMaxGasCost(
					smartAccount,
					userOp,
					context.token,
				);
				const approveAmount = maxErc20Cost * TOKEN_APPROVE_AMOUNT_MULTIPLIER;
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
			const [resultUserOp] = await this.createPaymasterUserOperation(
				smartAccount,
				userOp,
				context,
				_overrides,
			);
			return resultUserOp;
		} catch (err) {
			const error = ensureError(err);

			throw new AbstractionKitError("PAYMASTER_ERROR", "createTokenPaymasterUserOperation failed", {
				cause: error,
			});
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
			const cost = calculateUserOperationMaxGasCost(userOperation);
			return (exchangeRate * cost) / BigInt(10 ** 18);
		} catch (err) {
			const error = ensureError(err);

			throw new AbstractionKitError(
				"PAYMASTER_ERROR",
				"calculateUserOperationErc20TokenMaxGasCost failed",
				{
					cause: error,
				},
			);
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
			} else {
				return BigInt(gasToken.exchangeRate);
			}
		} catch (err) {
			const error = ensureError(err);

			throw new AbstractionKitError("PAYMASTER_ERROR", "fetchTokenPaymasterExchangeRate failed", {
				cause: error,
			});
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

			if (this.getEntrypointData(entrypoint) == null) {
				throw new RangeError("unsupported entrypoint.");
			}

			const result = (await this.fetchSupportedTokensRpc(
				entrypoint,
			)) as SupportedERC20TokensAndMetadataWithExchangeRate;
			return {
				tokens: CandidePaymaster.mapTokensWithExchangeRate(result.tokens),
				paymasterMetadata: CandidePaymaster.normalizePaymasterMetadata(result.paymasterMetadata),
			};
		} catch (err) {
			const error = ensureError(err);

			throw new AbstractionKitError(
				"PAYMASTER_ERROR",
				"fetchSupportedERC20TokensAndPaymasterMetadata failed",
				{
					cause: error,
				},
			);
		}
	}
}
