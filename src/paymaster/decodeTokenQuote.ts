import {AbstractionKitError} from "../errors";
import type {TokenPaymasterApproval} from "../types";
import {calculateUserOperationMaxGasCost} from "../utils";
import {getUserOperationPaymaster} from "./Paymaster";
import type {AnyUserOperation, DecodeTokenPaymasterApprovalsAccount} from "./types";

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
 * operation itself. See {@link Erc7677Paymaster.decodeTokenQuote}.
 */
export type DecodedTokenQuote = {
	/** Provider operating the paymaster */
	provider: TokenPaymasterProvider;
	/** Paymaster address set on the operation */
	paymaster: string;
	/**
	 * ERC-20 token paying for gas. For Pimlico it comes from the signed
	 * paymaster data. Candide's data names the token by an on-chain slot, so
	 * for Candide it is taken from the approval to the paymaster and is not
	 * verified offline; compare it with the token you expect. `null` for a
	 * Candide operation that carries no such approval.
	 */
	token: string | null;
	/**
	 * Allowance the operation grants the paymaster: the most it can take.
	 * `null` when the operation carries no approval and the paymaster spends
	 * an allowance granted earlier, whose size (possibly unlimited) cannot be
	 * known offline.
	 */
	approveAmount: bigint | null;
	/**
	 * Exchange rate the paymaster signed: token smallest-units per 1 ETH
	 * (10^18 wei). Before any price markup.
	 */
	exchangeRate: bigint;
	/**
	 * Upper bound on what this paymaster's contract can charge for the
	 * operation, in the token's smallest unit, including its post-operation
	 * overhead (and markup or constant fee when present). Usually higher than
	 * the builder's `TokenQuote.tokenCost`, which leaves the overhead out.
	 * `null` when it depends on on-chain state (Candide's on-chain markup mode).
	 */
	maxTokenCost: bigint | null;
	/** Unix timestamp (seconds) after which the paymaster data is rejected. 0 means no expiry. */
	validUntil: number;
	/** Unix timestamp (seconds) before which the paymaster data is rejected. Pimlico only. */
	validAfter?: number;
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
	if ("initCode" in userOperation) return userOperation.paymasterAndData.slice(42);
	return (userOperation.paymasterData ?? "0x").replace(/^0x/, "");
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
	reader.read(1); // gas token slot
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
	return { token: null, exchangeRate, maxTokenCost, validUntil };
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
 * offline: the paymaster's signed exchange rate and validity window from its
 * paymaster data, and the allowance from the ERC-20 approval in `callData`.
 *
 * Meant for co-signers who did not build the operation and so never saw its
 * `TokenQuote`. Supports Candide's (EntryPoint v0.6 to v0.9) and Pimlico's
 * (v0.6 to v0.8) token paymasters, identified by address.
 *
 * @param smartAccount - Account that can decode its own approvals
 *   (currently the Safe accounts)
 * @param userOperation - The finished UserOperation
 * @param overrides - overrides for the default values
 * @param overrides.paymasterAddresses - Additional paymaster deployments to
 *   accept, keyed by address, for custom deployments that keep a known layout
 * @param overrides.multisendContractAddress - An additional MultiSend
 *   contract to accept when decoding the approvals, for custom deployments
 * @returns The decoded quote, or `null` when the operation has no paymaster
 *   or its paymaster sponsors it (no token payment)
 * @throws AbstractionKitError with code "PAYMASTER_ERROR" if the paymaster is
 *   not a known deployment, the account cannot decode its approvals, or a
 *   Candide operation approves the paymaster for more than one token
 * @throws AbstractionKitError with code "BAD_DATA" if the paymaster data is in
 *   an unsupported mode or truncated, or the approvals cannot be decoded
 */
export function decodeTokenQuote(
	smartAccount: DecodeTokenPaymasterApprovalsAccount,
	userOperation: AnyUserOperation,
	overrides: {
		paymasterAddresses?: Record<string, KnownTokenPaymaster>;
		multisendContractAddress?: string;
	} = {},
): DecodedTokenQuote | null {
	const paymaster = getUserOperationPaymaster(userOperation);
	if (paymaster == null || /^0x0*$/.test(paymaster)) return null;

	const customPaymasters = Object.fromEntries(
		Object.entries(overrides.paymasterAddresses ?? {}).map(([address, known]) => [
			address.toLowerCase(),
			known,
		]),
	);
	const known =
		customPaymasters[paymaster.toLowerCase()] ?? KNOWN_TOKEN_PAYMASTERS[paymaster.toLowerCase()];
	if (known == null) {
		throw new AbstractionKitError(
			"PAYMASTER_ERROR",
			`paymaster ${paymaster} is not a known token paymaster; its data cannot be decoded. ` +
				"Pass overrides.paymasterAddresses for a custom deployment.",
			{ context: { paymaster } },
		);
	}
	if (typeof smartAccount.decodeTokenPaymasterApprovals !== "function") {
		throw new AbstractionKitError(
			"PAYMASTER_ERROR",
			"this smart account does not implement decodeTokenPaymasterApprovals, " +
				"which decodeTokenQuote needs to read the token approval.",
		);
	}

	const maxGasCost = calculateUserOperationMaxGasCost(userOperation);
	const hex = paymasterDataHex(userOperation).toLowerCase();
	const parsed =
		known.provider === "candide"
			? parseCandide(hex, known, maxGasCost, userOperation.maxFeePerGas)
			: parsePimlico(hex, maxGasCost, userOperation.maxFeePerGas);
	if (parsed == null) return null;

	// Only approvals of the paid token count; for Candide the data names the
	// token by slot, so the approval is the source of the token address.
	const approvals: TokenPaymasterApproval[] = smartAccount
		.decodeTokenPaymasterApprovals(userOperation, {
			multisendContractAddress: overrides.multisendContractAddress,
		})
		.filter((a) => parsed.token == null || a.token.toLowerCase() === parsed.token.toLowerCase());
	// Without a token address in the paymaster data, approvals of more than one
	// token leave it ambiguous which one the paymaster's token slot charges.
	const approvedTokens = new Set(approvals.map((a) => a.token.toLowerCase()));
	if (approvedTokens.size > 1) {
		throw new AbstractionKitError(
			"PAYMASTER_ERROR",
			"UserOperation approves the paymaster for more than one token; " +
				"the token it pays with cannot be determined offline.",
			{ context: { tokens: [...approvedTokens] } },
		);
	}
	const lastApproval = approvals.length > 0 ? approvals[approvals.length - 1] : null;

	const quote: DecodedTokenQuote = {
		provider: known.provider,
		paymaster,
		token: parsed.token ?? lastApproval?.token ?? null,
		approveAmount: lastApproval?.amount ?? null,
		exchangeRate: parsed.exchangeRate,
		maxTokenCost: parsed.maxTokenCost,
		validUntil: parsed.validUntil,
	};
	if (parsed.validAfter != null) quote.validAfter = parsed.validAfter;
	return quote;
}
