// Live timing tests for issue #130: SendUseroperationResponse.included()
// must poll immediately (not sleep a full interval first) and must not
// overshoot the timeout by a full polling interval. Uses a mock Transport
// and real timers; no network required.

const ak = require("../../dist/index.cjs");

const HASH = "0x1111111111111111111111111111111111111111111111111111111111111111";
const ENTRYPOINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";

const RAW_RECEIPT = {
	userOpHash: HASH,
	sender: "0x2222222222222222222222222222222222222222",
	nonce: "0x0",
	actualGasCost: "0x1",
	actualGasUsed: "0x1",
	success: true,
	logs: [],
	receipt: {
		blockNumber: "0x1",
		cumulativeGasUsed: "0x1",
		gasUsed: "0x1",
		transactionIndex: "0x0",
		transactionHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
	},
};

function makeResponse(receiptByAttempt) {
	let attempt = 0;
	const transport = {
		request: async ({ method }) => {
			if (method !== "eth_getUserOperationReceipt") {
				throw new Error(`unexpected method ${method}`);
			}
			const result = receiptByAttempt(attempt);
			attempt += 1;
			return result;
		},
	};
	return new ak.SendUseroperationResponse(HASH, new ak.Bundler(transport), ENTRYPOINT);
}

describe("SendUseroperationResponse.included() polling (#130)", () => {
	test(
		"receipt available on the first poll resolves without sleeping an interval",
		async () => {
			const response = makeResponse(() => RAW_RECEIPT);
			const start = Date.now();
			const receipt = await response.included(10, 3);
			const elapsed = Date.now() - start;
			expect(receipt.userOpHash).toBe(HASH);
			// Pre-fix this slept the full 3s interval before the first poll.
			expect(elapsed).toBeLessThan(1500);
		},
		15000,
	);

	test(
		"timeout does not overshoot by a full interval",
		async () => {
			const response = makeResponse(() => null);
			const start = Date.now();
			await expect(response.included(2, 2)).rejects.toMatchObject({ code: "TIMEOUT" });
			const elapsed = Date.now() - start;
			// Pre-fix included(2, 2) took ~4s (two full sleeps) before throwing.
			expect(elapsed).toBeLessThan(3200);
		},
		15000,
	);

	test(
		"receipt appearing on a later poll is returned",
		async () => {
			const response = makeResponse((attempt) => (attempt < 2 ? null : RAW_RECEIPT));
			const receipt = await response.included(10, 1);
			expect(receipt.userOpHash).toBe(HASH);
			expect(receipt.receipt.blockNumber).toBe(1n);
		},
		15000,
	);

	test("non-finite timeout or interval is rejected up front", async () => {
		const response = makeResponse(() => null);
		// NaN slips past <= comparisons (every NaN comparison is false) and
		// previously turned the sleep into a ~1ms timer polling indefinitely.
		await expect(response.included(NaN, 2)).rejects.toThrow(RangeError);
		await expect(response.included(10, NaN)).rejects.toThrow(RangeError);
		await expect(response.included(Infinity, 2)).rejects.toThrow(RangeError);
		await expect(response.included(10, Infinity)).rejects.toThrow(RangeError);
	});
});
