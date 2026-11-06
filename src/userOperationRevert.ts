import {decodeAbiParameters, id} from "./ethereUtils";
import type {Log, UserOperationReceiptResult} from "./types";

/**
 * Why a mined UserOperation reverted, decoded from its receipt.
 */
export type UserOperationRevert = {
	/** True when the receipt's `success` is false. */
	reverted: boolean;
	/**
	 * The inner call left no revert data. Usually out-of-gas, though a bare
	 * `revert()`/`assert` or a call to a non-contract also produce empty data.
	 * With {@link postOpReverted} set, it is the paymaster's postOp that left
	 * no revert data.
	 */
	outOfGas: boolean;
	/**
	 * The paymaster's `postOp` reverted (EntryPoint v0.7+). The account call is
	 * undone even if it succeeded. `errorMessage`, `panicCode` and `revertData`
	 * then describe the postOp revert, not the account call.
	 */
	postOpReverted?: boolean;
	/**
	 * The EntryPoint emitted `UserOperationPrefundTooLow`: the prefund did not
	 * cover the actual gas cost (EntryPoint v0.7+).
	 */
	prefundTooLow?: boolean;
	/** Decoded `Error("...")` string, when the call reverted with a reason. */
	errorMessage?: string;
	/** Decoded `Panic(uint256)` code (0x11 overflow, 0x12 divide-by-zero, ...). */
	panicCode?: number;
	/** The raw revert data bytes, for custom errors or further decoding. */
	revertData: string;
};

// EntryPoint event:
//   UserOperationRevertReason(bytes32 userOpHash, address sender, uint256 nonce, bytes revertReason)
const REVERT_REASON_TOPIC = id(
	"UserOperationRevertReason(bytes32,address,uint256,bytes)",
).toLowerCase();
// EntryPoint v0.7+ events for a failure outside the account call:
//   PostOpRevertReason(bytes32 userOpHash, address sender, uint256 nonce, bytes revertReason)
//   UserOperationPrefundTooLow(bytes32 userOpHash, address sender, uint256 nonce)
const POST_OP_REVERT_REASON_TOPIC = id(
	"PostOpRevertReason(bytes32,address,uint256,bytes)",
).toLowerCase();
const PREFUND_TOO_LOW_TOPIC = id(
	"UserOperationPrefundTooLow(bytes32,address,uint256)",
).toLowerCase();
// PostOpRevertReason carries the EntryPoint's own PostOpReverted(bytes) error,
// which wraps what the paymaster reverted with.
const POST_OP_REVERTED_SELECTOR = id("PostOpReverted(bytes)").slice(0, 10).toLowerCase();
const ERROR_SELECTOR = "0x08c379a0"; // Error(string)
const PANIC_SELECTOR = "0x4e487b71"; // Panic(uint256)

/**
 * Decode why a mined UserOperation reverted, using only its receipt.
 *
 * A receipt's `success: false` says the inner call reverted but not why. This
 * reads the EntryPoint's `UserOperationRevertReason` log and decodes the revert
 * data into a reason string, a panic code, or empty data (usually out-of-gas),
 * with no extra RPC call. A paymaster `postOp` revert (`PostOpRevertReason`)
 * and a prefund that was too low (`UserOperationPrefundTooLow`) are reported
 * through `postOpReverted` and `prefundTooLow` rather than as out-of-gas.
 *
 * To be certain about out-of-gas (rather than a bare revert with no data), trace
 * the bundle transaction with debug_traceTransaction or a simulation provider.
 *
 * @param receipt - A UserOperation receipt (non-null)
 * @returns The decoded revert: reason string, panic code, or out-of-gas
 */
export function decodeUserOperationRevertReason(
	receipt: NonNullable<UserOperationReceiptResult>,
): UserOperationRevert {
	if (receipt.success) {
		return {reverted: false, outOfGas: false, revertData: "0x"};
	}

	// The EntryPoint events are indexed by userOpHash (topic[1]). A bundle can
	// contain several reverted ops, so match this op's hash as well as the event
	// topic; otherwise we could pick up another op's revert reason from the bundle
	// logs. The guard keeps it working if a caller passes a receipt without the
	// top-level userOpHash. (Inner-call logs of this op do not carry the hash and
	// would have to be located by logIndex range, which is out of scope here.)
	const userOpHash = (receipt as {userOpHash?: string}).userOpHash?.toLowerCase();
	const logs = collectLogs(receipt);
	const findLog = (topic: string) =>
		logs.find(
			(l) =>
				l?.topics?.[0]?.toLowerCase() === topic &&
				(userOpHash == null || l?.topics?.[1]?.toLowerCase() === userOpHash),
		);

	const revertReasonLog = findLog(REVERT_REASON_TOPIC);
	if (revertReasonLog != null) {
		return decodeRevertReasonLog(revertReasonLog);
	}

	// The account call can succeed and the operation still fail: when the
	// paymaster's postOp reverts, the EntryPoint (v0.7+) undoes the call and
	// emits PostOpRevertReason instead. Raising gas limits does not help there.
	const postOpLog = findLog(POST_OP_REVERT_REASON_TOPIC);
	if (postOpLog != null) {
		return {...decodeRevertReasonLog(postOpLog, true), postOpReverted: true};
	}

	// The prefund did not cover the actual gas cost (EntryPoint v0.7+).
	if (findLog(PREFUND_TOO_LOW_TOPIC) != null) {
		return {reverted: true, outOfGas: false, prefundTooLow: true, revertData: "0x"};
	}

	// The EntryPoint emits UserOperationRevertReason only when the inner call
	// left non-empty revert data (`if (result.length > 0) emit ...`). So a
	// failed op with none of the logs above left no revert data at all, which
	// is the out-of-gas / bare-revert()/assert / call-to-non-contract case.
	return {reverted: true, outOfGas: true, revertData: "0x"};
}

/**
 * Decode the `(uint256 nonce, bytes revertReason)` data shared by the
 * UserOperationRevertReason and PostOpRevertReason events.
 * @param log - the EntryPoint event log
 * @param unwrapPostOpReverted - the EntryPoint wraps a postOp revert as
 *   `PostOpReverted(bytes)`; when set, decode the reason it carries
 */
function decodeRevertReasonLog(log: Log, unwrapPostOpReverted = false): UserOperationRevert {
	// A malformed or truncated payload would throw from decodeAbiParameters;
	// surface that as a best-effort "reverted, reason unknown" result rather
	// than letting the exception bubble.
	let revertData: string;
	try {
		[, revertData] = decodeAbiParameters<[bigint, string]>(["uint256", "bytes"], log.data);
		if (unwrapPostOpReverted && revertData.toLowerCase().startsWith(POST_OP_REVERTED_SELECTOR)) {
			[revertData] = decodeAbiParameters<[string]>(["bytes"], `0x${revertData.slice(10)}`);
		}
	} catch {
		return {reverted: true, outOfGas: false, revertData: "0x"};
	}
	const data = revertData.toLowerCase();

	if (data === "0x" || data === "") {
		return {reverted: true, outOfGas: true, revertData: "0x"};
	}
	if (data.startsWith(ERROR_SELECTOR)) {
		try {
			const [errorMessage] = decodeAbiParameters<[string]>(["string"], "0x" + data.slice(10));
			return {reverted: true, outOfGas: false, errorMessage, revertData};
		} catch {
			return {reverted: true, outOfGas: false, revertData};
		}
	}
	if (data.startsWith(PANIC_SELECTOR)) {
		try {
			const [code] = decodeAbiParameters<[bigint]>(["uint256"], "0x" + data.slice(10));
			return {reverted: true, outOfGas: false, panicCode: Number(code), revertData};
		} catch {
			return {reverted: true, outOfGas: false, revertData};
		}
	}
	return {reverted: true, outOfGas: false, revertData};
}

/**
 * Gather logs from the receipt. Logs are structured `Log[]`, but this also
 * tolerates the legacy JSON-string form so it keeps working if a caller passes
 * a receipt produced by an older SDK version.
 */
function collectLogs(receipt: NonNullable<UserOperationReceiptResult>): Log[] {
	const out: Log[] = [];
	const sources: unknown[] = [receipt.logs, receipt.receipt?.logs];
	for (const src of sources) {
		if (Array.isArray(src)) out.push(...(src as Log[]));
		else if (typeof src === "string") {
			try {
				out.push(...(JSON.parse(src) as Log[]));
			} catch {
				/* ignore malformed legacy logs */
			}
		}
	}
	return out;
}
