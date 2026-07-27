// getUserOperationByHash must convert the wire-format hex strings of the
// returned userOperation into the bigints its declared type promises,
// like getUserOperationReceipt and estimateUserOperationGas already do.

const ak = require("../../dist/index.cjs");

const WIRE_V7_OP = {
	sender: "0x1a02592A3484c2077d2E5D24482497F85e1980C6",
	nonce: "0x0",
	callData: "0x",
	callGasLimit: "0x5208",
	verificationGasLimit: "0x186a0",
	preVerificationGas: "0xb3b0",
	maxFeePerGas: "0x3b9aca00",
	maxPriorityFeePerGas: "0x3b9aca00",
	paymaster: "0x084f4dB6bae8fBb7fb9709c0A25532E21C7A097E",
	paymasterVerificationGasLimit: "0x30d40",
	paymasterPostOpGasLimit: "0xafc8",
	paymasterData: "0x",
	signature: "0x",
};

describe("Bundler.getUserOperationByHash", () => {
	function mockTransport(result) {
		return { request: async () => result };
	}

	test("converts numeric userOperation fields to bigint", async () => {
		const b = new ak.Bundler(
			mockTransport({
				userOperation: WIRE_V7_OP,
				entryPoint: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
				blockNumber: "0x10",
				blockHash: "0x" + "ab".repeat(32),
				transactionHash: "0x" + "cd".repeat(32),
			}),
		);
		const res = await b.getUserOperationByHash("0x" + "11".repeat(32));
		expect(res.blockNumber).toBe(16n);
		expect(res.userOperation.nonce).toBe(0n);
		expect(res.userOperation.callGasLimit).toBe(0x5208n);
		expect(res.userOperation.verificationGasLimit).toBe(0x186a0n);
		expect(res.userOperation.preVerificationGas).toBe(0xb3b0n);
		expect(res.userOperation.maxFeePerGas).toBe(1000000000n);
		expect(res.userOperation.maxPriorityFeePerGas).toBe(1000000000n);
		expect(res.userOperation.paymasterVerificationGasLimit).toBe(0x30d40n);
		expect(res.userOperation.paymasterPostOpGasLimit).toBe(0xafc8n);
		// non-numeric fields untouched
		expect(res.userOperation.sender).toBe(WIRE_V7_OP.sender);
		expect(res.userOperation.signature).toBe("0x");
	});

	test("returns null for an unknown hash and keeps pending blockNumber null", async () => {
		const bNull = new ak.Bundler(mockTransport(null));
		expect(await bNull.getUserOperationByHash("0x" + "22".repeat(32))).toBeNull();

		const bPending = new ak.Bundler(
			mockTransport({
				userOperation: WIRE_V7_OP,
				entryPoint: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
				blockNumber: null,
				blockHash: null,
				transactionHash: null,
			}),
		);
		const res = await bPending.getUserOperationByHash("0x" + "33".repeat(32));
		expect(res.blockNumber).toBeNull();
		expect(res.userOperation.nonce).toBe(0n);
	});
});
