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

	it("reverted without a reason when there is no revert log", () => {
		const r = decodeUserOperationRevertReason({ success: false, logs: [], receipt: { logs: [] } });
		expect(r.reverted).toBe(true);
		expect(r.outOfGas).toBe(false);
		expect(r.errorMessage).toBeUndefined();
	});

	it("tolerates the legacy JSON-string logs form", () => {
		const real = receiptWithRevert(errorData("legacy"));
		const legacy = { success: false, logs: JSON.stringify(real.logs), receipt: { logs: "[]" } };
		const r = decodeUserOperationRevertReason(legacy);
		expect(r.errorMessage).toBe("legacy");
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
});

describe("AbstractionKitError.aaCode", () => {
	it("carries the aaCode option", () => {
		const err = new AbstractionKitError("SIMULATE_VALIDATION", "AA21 didn't pay prefund", { aaCode: "AA21" });
		expect(err.aaCode).toBe("AA21");
		expect(JSON.parse(err.stringify()).aaCode).toBe("AA21");
	});
});
