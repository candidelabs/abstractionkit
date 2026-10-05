import {AbstractionKitError} from "../errors";
import {getAddress} from "../ethereUtils";
import {calculateUserOperationMaxGasCost} from "../utils";
import {getUserOperationPaymaster} from "./Paymaster";
import type {AnyUserOperation} from "./types";

/** Token paymaster providers whose signed paymaster data can be decoded. */
export type TokenPaymasterProvider = "candide" | "pimlico";

/** Layout of a known token paymaster deployment. */
export type KnownTokenPaymaster = {
	provider: TokenPaymasterProvider;
	/**
	 * Set for Candide's EntryPoint v0.9 paymaster, whose data carries an extra
	 * `allowOnlyTrustedBundlers` byte after the markup mode.
	 */
	hasTrustedBundlersFlag?: boolean;
};

/**
 * The token payment a finished UserOperation commits to, read from the
 * paymaster data the paymaster signed. See {@link Erc7677Paymaster.decodeTokenQuote}.
 */
export type DecodedTokenQuote = {
	/** Provider operating the paymaster */
	provider: TokenPaymasterProvider;
	/** Paymaster address set on the operation, checksummed */
	paymaster: string;
	/**
	 * ERC-20 token paying for gas, checksummed. Pimlico only: its paymaster
	 * data carries the token address. `null` for Candide, whose data names the
	 * token by slot (see `gasTokenSlot`).
	 */
	token: string | null;
	/**
	 * Candide only: the token slot the paymaster signed, which decides the
	 * token it charges. Calling `getTokens([gasTokenSlot])` on the paymaster
	 * contract returns that token.
	 */
	gasTokenSlot?: number;
	/**
	 * Exchange rate the paymaster signed: token smallest-units per 1 ETH
	 * (10^18 wei). Before any price markup.
	 */
	exchangeRate: bigint;
	/**
	 * The most this paymaster's contract can charge for the operation, in the
	 * token's smallest unit, including its post-operation overhead (and markup
	 * or constant fee when present). Usually a bit higher than the builder's
	 * `TokenQuote.tokenCost`, which leaves the overhead out. `null` when it
	 * depends on on-chain state (Candide's on-chain markup mode).
	 */
	maxTokenCost: bigint | null;
	/** Unix timestamp (seconds) after which the paymaster data is rejected. 0 means no expiry. */
	validUntil: number;
	/** Unix timestamp (seconds) before which the paymaster data is rejected. Pimlico only. */
	validAfter?: number;
};

/** Options for {@link Erc7677Paymaster.decodeTokenQuote}. */
export type DecodeTokenQuoteOverrides = {
	/**
	 * Additional paymaster deployments to accept, keyed by address, for custom
	 * deployments that keep a known layout
	 */
	paymasterAddresses?: Record<string, KnownTokenPaymaster>;
};

/** Known token paymaster deployments; the same address on every chain. */
const KNOWN_TOKEN_PAYMASTERS: Record<string, KnownTokenPaymaster> = {
	"0x36f4aa64673568782461bf03c75462f8ef0a1b76": { provider: "candide" }, // EntryPoint v0.6
	"0x8b1f6cb5d062aa2ce8d581942bbb960420d875ba": { provider: "candide" }, // EntryPoint v0.7
	"0xa8151918eac3818deb713d3dbbb7930329fe86ed": { provider: "candide" }, // EntryPoint v0.8
	"0xca944fb73fa5191969014ded9bb075381d59c7de": { provider: "candide", hasTrustedBundlersFlag: true }, // EntryPoint v0.9
	"0x6666666666667849c56f2850848ce1c4da65c68b": { provider: "pimlico" }, // EntryPoint v0.6
	"0x777777777777aec03fd955926dbf81597e66834c": { provider: "pimlico" }, // EntryPoint v0.7
	"0x888888888888ec68a58ab8094cc1ad20ba3d2402": { provider: "pimlico" }, // EntryPoint v0.8
};

/** Candide paymaster post-operation gas overhead (`COST_OF_POST`). */
const CANDIDE_COST_OF_POST = 35000n;
/** Candide price markup denominator (`PRICE_DENOMINATOR`). */
const CANDIDE_PRICE_DENOMINATOR = 10n ** 26n;

/** Cursor over paymaster data hex (no 0x prefix). */
class ByteReader {
	private offset = 0;
	constructor(
		private readonly hex: string,
		private readonly provider: TokenPaymasterProvider,
	) {}

	read(length: number): string {
		const end = this.offset + length * 2;
		if (end > this.hex.length) {
			throw new AbstractionKitError(
				"BAD_DATA",
				`${this.provider} paymaster data is truncated`,
				{ context: { paymasterData: `0x${this.hex}` } },
			);
		}
		const value = this.hex.slice(this.offset, end);
		this.offset = end;
		return value;
	}

	uint(length: number): bigint {
		return BigInt(`0x${this.read(length)}`);
	}
}

type ParsedPaymasterData = {
	token: string | null;
	gasTokenSlot?: number;
	exchangeRate: bigint;
	maxTokenCost: bigint | null;
	validUntil: number;
	validAfter?: number;
};

/**
 * Paymaster data without the paymaster address (and, on v0.7+, without the
 * packed paymaster gas limits), as the paymaster contract parses it.
 */
function paymasterDataHex(userOperation: AnyUserOperation): string {
	const hex =
		"initCode" in userOperation
			? userOperation.paymasterAndData.slice(42)
			: (userOperation.paymasterData ?? "0x").replace(/^0x/, "");
	if (!/^([0-9a-fA-F]{2})*$/.test(hex)) {
		throw new AbstractionKitError("BAD_DATA", "paymaster data is not valid hex", {
			context: { paymasterData: `0x${hex}` },
		});
	}
	return hex.toLowerCase();
}

/**
 * Parse Candide paymaster data (CandidePaymaster06/07/08/09V4). Returns
 * `null` for sponsored (FREE) mode.
 */
function parseCandide(
	hex: string,
	known: KnownTokenPaymaster,
	maxGasCost: bigint,
	maxFeePerGas: bigint,
): ParsedPaymasterData | null {
	const reader = new ByteReader(hex, "candide");
	const mode = Number(reader.uint(1));
	const markupMode = Number(reader.uint(1));
	if (known.hasTrustedBundlersFlag) reader.read(1);
	if (mode === 2) return null; // FREE: sponsored, no token payment
	if (mode !== 0) {
		// 1 = TOKEN (rate cached on-chain), 3 = TOKEN_WITH_FIXED_FEE (v0.9)
		throw new AbstractionKitError("BAD_DATA", `unsupported Candide paymaster mode ${mode}`, {
			context: { mode },
		});
	}
	const gasTokenSlot = Number(reader.uint(1));
	const validUntil = Number(reader.uint(6));
	const exchangeRate = reader.uint(32);

	let effectiveRate: bigint | null;
	if (markupMode === 0) {
		effectiveRate = exchangeRate;
	} else if (markupMode === 1) {
		effectiveRate = null; // INCLUDE: markup lives in on-chain token config
	} else if (markupMode === 2) {
		const priceMarkup = reader.uint(32); // INCLUDE_CUSTOM
		effectiveRate = (exchangeRate * priceMarkup) / CANDIDE_PRICE_DENOMINATOR;
	} else {
		throw new AbstractionKitError(
			"BAD_DATA",
			`unsupported Candide paymaster markup mode ${markupMode}`,
			{ context: { markupMode } },
		);
	}

	let maxTokenCost: bigint | null = null;
	if (effectiveRate != null) {
		maxTokenCost =
			((maxGasCost + CANDIDE_COST_OF_POST * maxFeePerGas) * effectiveRate) / 10n ** 18n;
		if (maxTokenCost === 0n) maxTokenCost = 1n;
	}
	return { token: null, gasTokenSlot, exchangeRate, maxTokenCost, validUntil };
}

/**
 * Parse Pimlico paymaster data (SingletonPaymasterV6/V7/V8). Returns `null`
 * for verifying (sponsored) mode.
 */
function parsePimlico(
	hex: string,
	maxGasCost: bigint,
	maxFeePerGas: bigint,
): ParsedPaymasterData | null {
	const reader = new ByteReader(hex, "pimlico");
	const mode = Number(reader.uint(1)) >> 1; // lowest bit is allowAllBundlers
	if (mode === 0) return null; // VERIFYING: sponsored, no token payment
	if (mode !== 1) {
		throw new AbstractionKitError("BAD_DATA", `unsupported Pimlico paymaster mode ${mode}`, {
			context: { mode },
		});
	}
	const flags = Number(reader.uint(1));
	const validUntil = Number(reader.uint(6));
	const validAfter = Number(reader.uint(6));
	const token = `0x${reader.read(20)}`;
	const postOpGas = reader.uint(16);
	const exchangeRate = reader.uint(32);
	reader.read(16); // paymasterValidationGasLimit
	reader.read(20); // treasury
	if (flags & 0x04) reader.read(16); // preFundInToken: only splits when the cost is taken
	const constantFee = flags & 0x01 ? reader.uint(16) : 0n;

	// getCostInToken over the maximum gas, plus the constant fee. Also bounds
	// the recipient top-up, which never exceeds the prefund at this rate.
	const maxTokenCost =
		((maxGasCost + postOpGas * maxFeePerGas) * exchangeRate) / 10n ** 18n + constantFee;
	return { token, exchangeRate, maxTokenCost, validUntil, validAfter };
}

/**
 * Implementation behind the public statics {@link Erc7677Paymaster.decodeTokenQuote}
 * and {@link CandidePaymaster.decodeTokenQuote}.
 *
 * Read the token payment a finished UserOperation commits to, entirely
 * offline, from the paymaster data the paymaster signed: the exchange rate,
 * the most it can charge, the validity window, and the token (Pimlico) or
 * token slot (Candide). It reads nothing from `callData`, so it works for any
 * account.
 *
 * Meant for co-signers who did not build the operation and so never saw its
 * `TokenQuote`. Supports Candide's (EntryPoint v0.6 to v0.9) and Pimlico's
 * (v0.6 to v0.8) token paymasters, identified by address.
 *
 * @param userOperation - The finished UserOperation
 * @param overrides - overrides for the default values
 * @param overrides.paymasterAddresses - Additional paymaster deployments to
 *   accept, keyed by address, for custom deployments that keep a known layout
 * @returns The decoded quote, or `null` when the operation has no paymaster
 *   or its paymaster sponsors it (no token payment)
 * @throws AbstractionKitError with code "PAYMASTER_ERROR" if the paymaster is
 *   not a known deployment
 * @throws AbstractionKitError with code "BAD_DATA" if the paymaster data is in
 *   an unsupported mode, truncated, or not valid hex
 */
export function decodeTokenQuote(
	userOperation: AnyUserOperation,
	overrides: DecodeTokenQuoteOverrides = {},
): DecodedTokenQuote | null {
	const paymaster = getUserOperationPaymaster(userOperation);
	if (paymaster == null || /^0x0*$/.test(paymaster)) return null;

	const customPaymasters = new Map(
		Object.entries(overrides.paymasterAddresses ?? {}).map(([address, known]) => [
			address.toLowerCase(),
			known,
		]),
	);
	const key = paymaster.toLowerCase();
	const known = !/^0x[0-9a-f]{40}$/.test(key)
		? undefined
		: (customPaymasters.get(key) ??
			(Object.prototype.hasOwnProperty.call(KNOWN_TOKEN_PAYMASTERS, key)
				? KNOWN_TOKEN_PAYMASTERS[key]
				: undefined));
	if (known == null) {
		throw new AbstractionKitError(
			"PAYMASTER_ERROR",
			`paymaster ${paymaster} is not a known token paymaster; its data cannot be decoded. ` +
				"Pass overrides.paymasterAddresses for a custom deployment.",
			{ context: { paymaster } },
		);
	}
	const maxGasCost = calculateUserOperationMaxGasCost(userOperation);
	const hex = paymasterDataHex(userOperation);
	const parsed =
		known.provider === "candide"
			? parseCandide(hex, known, maxGasCost, userOperation.maxFeePerGas)
			: parsePimlico(hex, maxGasCost, userOperation.maxFeePerGas);
	if (parsed == null) return null;

	const quote: DecodedTokenQuote = {
		provider: known.provider,
		// Lowercase first: getAddress rejects mixed case with a wrong checksum.
		paymaster: getAddress(key),
		token: parsed.token == null ? null : getAddress(parsed.token.toLowerCase()),
		exchangeRate: parsed.exchangeRate,
		maxTokenCost: parsed.maxTokenCost,
		validUntil: parsed.validUntil,
	};
	if (parsed.gasTokenSlot != null) quote.gasTokenSlot = parsed.gasTokenSlot;
	if (parsed.validAfter != null) quote.validAfter = parsed.validAfter;
	return quote;
}
