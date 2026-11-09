const { AbiCoder, id } = require("ethers");
const ak = require("../dist/index.cjs");

const { decodeUserOperationRevertReason, parseAaCode, AbstractionKitError } = ak;

const coder = AbiCoder.defaultAbiCoder();
const REVERT_TOPIC = id("UserOperationRevertReason(bytes32,address,uint256,bytes)");

// Build a receipt whose UserOperationRevertReason log carries `revertReason` bytes.
function receiptWithRevert(revertReason, success = false) {
	const data = coder.encode(["uint256", "bytes"], [0n, revertReason]);
	const log = { topics: [REVERT_TOPIC, "0xhash", "0xsender"], data };
	return { success, logs: [log], receipt: { logs: [], transactionHash: "0xtx" } };
}

const errorData = (msg) => "0x08c379a0" + coder.encode(["string"], [msg]).slice(2);
const panicData = (code) => "0x4e487b71" + coder.encode(["uint256"], [code]).slice(2);

const POST_OP_TOPIC = id("PostOpRevertReason(bytes32,address,uint256,bytes)");
const PREFUND_TOPIC = id("UserOperationPrefundTooLow(bytes32,address,uint256)");
// The EntryPoint wraps what the paymaster reverted with in its own error.
const postOpReverted = (inner) => id("PostOpReverted(bytes)").slice(0, 10) + coder.encode(["bytes"], [inner]).slice(2);

function failedReceipt(logs) {
	return { success: false, userOpHash: "0xhash", logs, receipt: { logs: [], transactionHash: "0xtx" } };
}
const postOpLog = (revertReason, hash = "0xhash") => ({
	topics: [POST_OP_TOPIC, hash, "0xsender"],
	data: coder.encode(["uint256", "bytes"], [0n, revertReason]),
});

// A failed op whose only EntryPoint log is PostOpRevertReason or
// UserOperationPrefundTooLow used to be reported as out-of-gas: the decoder
// looked for UserOperationRevertReason only. The account call may well have
// succeeded, so raising gas limits is the wrong reaction.
describe("decodeUserOperationRevertReason for failures outside the account call", () => {
	it("reports a paymaster postOp revert with its reason", () => {
		const r = decodeUserOperationRevertReason(
			failedReceipt([postOpLog(postOpReverted(errorData("paymaster postOp failed")))]),
		);
		expect(r).toMatchObject({
			reverted: true,
			outOfGas: false,
			postOpReverted: true,
			errorMessage: "paymaster postOp failed",
		});
		expect(r.revertData).toBe(errorData("paymaster postOp failed"));
	});

	it("decodes a postOp panic and keeps a custom error as raw data", () => {
		const panic = decodeUserOperationRevertReason(failedReceipt([postOpLog(postOpReverted(panicData(0x11)))]));
		expect(panic).toMatchObject({ postOpReverted: true, panicCode: 0x11, outOfGas: false });
		const custom = decodeUserOperationRevertReason(failedReceipt([postOpLog(postOpReverted("0xdeadbeef"))]));
		expect(custom).toMatchObject({ postOpReverted: true, outOfGas: false, revertData: "0xdeadbeef" });
	});

	it("still decodes postOp data that is not wrapped in PostOpReverted", () => {
		const r = decodeUserOperationRevertReason(failedReceipt([postOpLog(errorData("bare"))]));
		expect(r).toMatchObject({ postOpReverted: true, errorMessage: "bare" });
	});

	it("flags a postOp that left no revert data, without hiding that it was the postOp", () => {
		const r = decodeUserOperationRevertReason(failedReceipt([postOpLog(postOpReverted("0x"))]));
		expect(r).toMatchObject({ reverted: true, postOpReverted: true, outOfGas: true, revertData: "0x" });
	});

	it("reports a prefund that was too low", () => {
		const r = decodeUserOperationRevertReason(
			failedReceipt([{ topics: [PREFUND_TOPIC, "0xhash", "0xsender"], data: coder.encode(["uint256"], [0n]) }]),
		);
		expect(r).toEqual({ reverted: true, outOfGas: false, prefundTooLow: true, revertData: "0x" });
	});

	it("ignores another operation's postOp log in the same bundle", () => {
		const r = decodeUserOperationRevertReason(
			failedReceipt([postOpLog(postOpReverted(errorData("someone else")), "0xother")]),
		);
		expect(r).toEqual({ reverted: true, outOfGas: true, revertData: "0x" });
	});

	it("an account revert is not marked as a postOp revert", () => {
		const r = decodeUserOperationRevertReason(receiptWithRevert(errorData("account")));
		expect(r.errorMessage).toBe("account");
		expect(r.postOpReverted).toBeUndefined();
		expect(r.prefundTooLow).toBeUndefined();
	});
});

describe("decodeUserOperationRevertReason", () => {
	it("decodes a revert reason string", () => {
		const r = decodeUserOperationRevertReason(receiptWithRevert(errorData("ERC20: transfer amount exceeds balance")));
		expect(r.reverted).toBe(true);
		expect(r.outOfGas).toBe(false);
		expect(r.errorMessage).toBe("ERC20: transfer amount exceeds balance");
	});

	it("decodes a panic code", () => {
		const r = decodeUserOperationRevertReason(receiptWithRevert(panicData(0x11)));
		expect(r.reverted).toBe(true);
		expect(r.panicCode).toBe(0x11);
		expect(r.errorMessage).toBeUndefined();
	});

	it("flags empty revert data as out-of-gas", () => {
		const r = decodeUserOperationRevertReason(receiptWithRevert("0x"));
		expect(r.reverted).toBe(true);
		expect(r.outOfGas).toBe(true);
	});

	it("reports not reverted when success is true", () => {
		const r = decodeUserOperationRevertReason({ success: true, logs: [], receipt: { logs: [] } });
		expect(r.reverted).toBe(false);
		expect(r.outOfGas).toBe(false);
	});

	it("flags out-of-gas when a failed op has no revert log", () => {
		// The EntryPoint emits UserOperationRevertReason only for non-empty
		// revert data, so a failed op with no such log left no revert data:
		// out-of-gas / bare revert() / call-to-non-contract.
		const r = decodeUserOperationRevertReason({ success: false, logs: [], receipt: { logs: [] } });
		expect(r.reverted).toBe(true);
		expect(r.outOfGas).toBe(true);
		expect(r.errorMessage).toBeUndefined();
	});

	it("tolerates the legacy JSON-string logs form", () => {
		const real = receiptWithRevert(errorData("legacy"));
		const legacy = { success: false, logs: JSON.stringify(real.logs), receipt: { logs: "[]" } };
		const r = decodeUserOperationRevertReason(legacy);
		expect(r.errorMessage).toBe("legacy");
	});

	it("returns best-effort fallback when the outer log.data is malformed", () => {
		// Outer decodeAbiParameters(uint256, bytes) sees garbage that isn't even
		// a complete 32-byte word. Used to throw; should now return a
		// reverted-with-unknown-reason result.
		const receipt = {
			success: false,
			logs: [{ topics: [REVERT_TOPIC, "0xhash", "0xsender"], data: "0xdeadbeef" }],
			receipt: { logs: [] },
		};
		const r = decodeUserOperationRevertReason(receipt);
		expect(r.reverted).toBe(true);
		expect(r.outOfGas).toBe(false);
		expect(r.revertData).toBe("0x");
		expect(r.errorMessage).toBeUndefined();
		expect(r.panicCode).toBeUndefined();
	});

	it("returns best-effort fallback when an Error(string) payload is truncated", () => {
		// Selector is the real Error(string) selector but the trailing payload
		// is too short to decode as `string`. Inner decode throws; we should
		// fall through to the custom-error shape (raw revertData, no message).
		const truncated = "0x08c379a0" + "00".repeat(16); // selector + 16 bytes of zeros
		const r = decodeUserOperationRevertReason(receiptWithRevert(truncated));
		expect(r.reverted).toBe(true);
		expect(r.outOfGas).toBe(false);
		expect(r.errorMessage).toBeUndefined();
		expect(r.revertData.toLowerCase()).toBe(truncated);
	});

	it("returns best-effort fallback when a Panic(uint256) payload is truncated", () => {
		const truncated = "0x4e487b71" + "00".repeat(16); // selector + 16 bytes of zeros
		const r = decodeUserOperationRevertReason(receiptWithRevert(truncated));
		expect(r.reverted).toBe(true);
		expect(r.outOfGas).toBe(false);
		expect(r.panicCode).toBeUndefined();
		expect(r.revertData.toLowerCase()).toBe(truncated);
	});

	it("picks this op's revert reason in a multi-op bundle", () => {
		const mine = "0x" + "a".repeat(64);
		const other = "0x" + "b".repeat(64);
		const logFor = (hash, msg) => ({
			topics: [REVERT_TOPIC, hash, "0xsender"],
			data: coder.encode(["uint256", "bytes"], [0n, errorData(msg)]),
		});
		// The bundle reverted two ops; the other op's log comes first.
		const receipt = {
			success: false,
			userOpHash: mine,
			logs: [logFor(other, "other op error"), logFor(mine, "my op error")],
			receipt: { logs: [], transactionHash: "0xtx" },
		};
		const r = decodeUserOperationRevertReason(receipt);
		expect(r.errorMessage).toBe("my op error");
	});
});

describe("parseAaCode", () => {
	it("extracts an AAxx code", () => {
		expect(parseAaCode("revert reason : AA21 didn't pay prefund")).toBe("AA21");
	});

	it("uppercases a lowercase code", () => {
		expect(parseAaCode("aa24 signature error")).toBe("AA24");
	});

	it("returns undefined when there is no code", () => {
		expect(parseAaCode("some unrelated bundler message")).toBeUndefined();
	});

	it("does not match digit pairs embedded in hex blobs", () => {
		// Bundler messages carry revert data, hashes, addresses and chain ids;
		// none of these should be misread as a FailedOp code.
		expect(parseAaCode("reverted with data 0x3aa21f00deadbeef")).toBeUndefined();
		expect(parseAaCode("wrong chain: expected 0xaa36a7")).toBeUndefined();
		expect(parseAaCode("paymaster 0xaa21cafebabe rejected")).toBeUndefined();
	});
});

describe("AbstractionKitError.aaCode", () => {
	it("carries the aaCode option", () => {
		const err = new AbstractionKitError("SIMULATE_VALIDATION", "AA21 didn't pay prefund", { aaCode: "AA21" });
		expect(err.aaCode).toBe("AA21");
		expect(JSON.parse(err.stringify()).aaCode).toBe("AA21");
	});
});
