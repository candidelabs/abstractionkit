// Offline tests for SendUseroperationResponse.included() polling:
// interval-delayed first poll (by design), wall-clock timeout, and
// transient-error tolerance.

const ak = require("../../dist/index.cjs");

const HASH = "0x" + "11".repeat(32);
const ENTRYPOINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
const RECEIPT = { success: true };

function responseWith(getReceipt) {
	const bundler = new ak.Bundler({ request: async () => null });
	bundler.getUserOperationReceipt = getReceipt;
	return new ak.SendUseroperationResponse(HASH, bundler, ENTRYPOINT);
}

describe("SendUseroperationResponse.included", () => {
	test("waits one interval before the first poll by design", async () => {
		const response = responseWith(async () => RECEIPT);
		const start = Date.now();
		expect(await response.included(5, 0.5)).toBe(RECEIPT);
		const elapsed = Date.now() - start;
		expect(elapsed).toBeGreaterThanOrEqual(450);
		expect(elapsed).toBeLessThan(2000);
	});

	test("keeps polling through a transient RPC error", async () => {
		let calls = 0;
		const response = responseWith(async () => {
			calls += 1;
			if (calls === 1) throw new Error("502 bad gateway");
			return RECEIPT;
		});
		expect(await response.included(5, 0.1)).toBe(RECEIPT);
		expect(calls).toBe(2);
	});

	test.each([-32601, -32602])(
		"rethrows deterministic protocol error %i immediately instead of polling to timeout",
		async (errno) => {
			let calls = 0;
			const response = responseWith(async () => {
				calls += 1;
				throw Object.assign(new Error("deterministic failure"), { errno });
			});
			await expect(response.included(5, 0.1)).rejects.toMatchObject({ errno });
			expect(calls).toBe(1);
		},
	);

	test.each([NaN, Infinity, -Infinity])(
		"rejects non-finite timeout/interval %p instead of looping forever",
		async (bad) => {
			const response = responseWith(async () => null);
			await expect(response.included(bad, 1)).rejects.toThrow(RangeError);
			await expect(response.included(60, bad)).rejects.toThrow(RangeError);
		},
	);

	test("times out against wall-clock time and reports the last error", async () => {
		const response = responseWith(async () => {
			throw new Error("still failing");
		});
		const start = Date.now();
		await expect(response.included(0.5, 0.1)).rejects.toMatchObject({
			code: "TIMEOUT",
			cause: expect.objectContaining({ message: "still failing" }),
		});
		const elapsed = Date.now() - start;
		expect(elapsed).toBeGreaterThanOrEqual(450);
		expect(elapsed).toBeLessThan(2000);
	});
});
