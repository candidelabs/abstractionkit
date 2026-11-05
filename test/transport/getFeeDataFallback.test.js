// Regression tests: getFeeData falls back to a 1 gwei floor when the node
// does not serve the fee methods. "Does not serve" was decided by a substring
// match on any error message ("not supported", "unsupported"), so unrelated
// failures were swallowed and turned into a made-up price: an HTTP 415
// "Unsupported Media Type", or "chain not supported on this plan". On an L2
// that price is hundreds of times too high and is really charged. Offline.

const ak = require("../../dist/index.cjs");

const GWEI = 1_000_000_000n;
function node(handlers) {
	return new ak.JsonRpcNode({
		request: async ({ method }) => {
			const handler = handlers[method];
			if (handler instanceof Error) throw handler;
			return handler;
		},
	});
}
const rpcError = (code, message) => new ak.TransportRpcError(code, message);
const fees = (handlers) => node(handlers).getFeeData(ak.GasOption.Slow);

describe("getFeeData falls back only when the method is missing", () => {
	test.each([
		["code -32601", rpcError(-32601, "whatever the node says")],
		["method not found, other code", rpcError(-32000, "Method not found")],
		["the method is named as unsupported", rpcError(-32000, "eth_maxPriorityFeePerGas is not supported")],
		["the method does not exist", rpcError(-32600, "the method eth_maxPriorityFeePerGas does not exist/is not available")],
		["unsupported method", rpcError(-32004, "Unsupported method")],
	])("%s: the priority fee falls back to the gas price", async (_name, error) => {
		const [maxFeePerGas, maxPriorityFeePerGas] = await fees({
			eth_gasPrice: "0x" + (30n * GWEI).toString(16),
			eth_maxPriorityFeePerGas: error,
		});
		expect(maxFeePerGas).toBe(30n * GWEI);
		expect(maxPriorityFeePerGas).toBe(30n * GWEI);
	});

	test("both methods missing still gives the 1 gwei floor", async () => {
		const missing = rpcError(-32601, "method not found");
		expect(await fees({ eth_gasPrice: missing, eth_maxPriorityFeePerGas: missing })).toEqual([GWEI, GWEI]);
	});

	test.each([
		["an HTTP 415", rpcError(-32603, "HTTP 415 Unsupported Media Type")],
		["a plan restriction", rpcError(-32000, "chain not supported on this plan")],
		["a rate limit", rpcError(-32005, "rate limited")],
		["an auth failure", rpcError(-32603, "HTTP 401 Unauthorized")],
		["a network failure", new TypeError("fetch failed")],
	])("%s is an error, not a price", async (_name, error) => {
		await expect(fees({ eth_gasPrice: error, eth_maxPriorityFeePerGas: error })).rejects.toThrow();
		// also when only one of the two calls fails
		await expect(fees({ eth_gasPrice: "0x1", eth_maxPriorityFeePerGas: error })).rejects.toThrow();
		await expect(fees({ eth_gasPrice: error, eth_maxPriorityFeePerGas: "0x1" })).rejects.toThrow();
	});
});
