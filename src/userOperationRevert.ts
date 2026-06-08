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
	 */
	outOfGas: boolean;
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
const ERROR_SELECTOR = "0x08c379a0"; // Error(string)
const PANIC_SELECTOR = "0x4e487b71"; // Panic(uint256)

/**
 * Decode why a mined UserOperation reverted, using only its receipt.
 *
 * A receipt's `success: false` says the inner call reverted but not why. This
 * reads the EntryPoint's `UserOperationRevertReason` log and decodes the revert
 * data into a reason string, a panic code, or empty data (usually out-of-gas),
 * with no extra RPC call.
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

	// UserOperationRevertReason is indexed by userOpHash (topic[1]). A bundle can
	// contain several reverted ops, so match this op's hash as well as the event
	// topic; otherwise we could pick up another op's revert reason from the bundle
	// logs. The guard keeps it working if a caller passes a receipt without the
	// top-level userOpHash. (Inner-call logs of this op do not carry the hash and
	// would have to be located by logIndex range, which is out of scope here.)
	const userOpHash = (receipt as {userOpHash?: string}).userOpHash?.toLowerCase();
	const log = collectLogs(receipt).find(
		(l) =>
			l?.topics?.[0]?.toLowerCase() === REVERT_REASON_TOPIC &&
			(userOpHash == null || l?.topics?.[1]?.toLowerCase() === userOpHash),
	);
	if (log == null) {
		return {reverted: true, outOfGas: false, revertData: "0x"};
	}

	// log.data is abi.encode(uint256 nonce, bytes revertReason)
	const [, revertData] = decodeAbiParameters<[bigint, string]>(["uint256", "bytes"], log.data);
	const data = revertData.toLowerCase();

	if (data === "0x" || data === "") {
		return {reverted: true, outOfGas: true, revertData: "0x"};
	}
	if (data.startsWith(ERROR_SELECTOR)) {
		const [errorMessage] = decodeAbiParameters<[string]>(["string"], "0x" + data.slice(10));
		return {reverted: true, outOfGas: false, errorMessage, revertData};
	}
	if (data.startsWith(PANIC_SELECTOR)) {
		const [code] = decodeAbiParameters<[bigint]>(["uint256"], "0x" + data.slice(10));
		return {reverted: true, outOfGas: false, panicCode: Number(code), revertData};
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
