// Offline tests for HTTP/JSON-RPC error handling: error:null successes,
// non-JSON error bodies, and enveloped-but-empty responses must surface
// useful diagnostics instead of TypeErrors or JSON parse errors.

const ak = require("../../dist/index.cjs");

function mockFetch(status, body, statusText = "") {
	return async () => ({
		ok: status >= 200 && status < 300,
		status,
		statusText,
		text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
		json: async () => JSON.parse(typeof body === "string" ? body : JSON.stringify(body)),
	});
}

function transportWith(status, body, statusText) {
	return new ak.HttpTransport("https://example.test/rpc", {
		fetch: mockFetch(status, body, statusText),
	});
}

describe("HttpTransport error handling", () => {
	test("treats error:null alongside result as success", async () => {
		const t = transportWith(200, { jsonrpc: "2.0", id: 1, result: "0x1", error: null });
		expect(await t.request({ method: "eth_chainId", params: [] })).toBe("0x1");
	});

	test("surfaces the HTTP status for a non-JSON error body", async () => {
		const t = transportWith(502, "<html>Bad Gateway</html>", "Bad Gateway");
		await expect(t.request({ method: "eth_chainId", params: [] })).rejects.toMatchObject({
			name: "TransportRpcError",
			message: expect.stringContaining("502"),
		});
	});

	test("surfaces the HTTP status for a JSON error body without an envelope", async () => {
		const t = transportWith(401, { message: "unauthorized" }, "Unauthorized");
		await expect(t.request({ method: "eth_chainId", params: [] })).rejects.toMatchObject({
			name: "TransportRpcError",
			message: expect.stringContaining("401"),
		});
	});

	test("still reports the server's JSON-RPC error from an HTTP failure", async () => {
		const t = transportWith(429, {
			jsonrpc: "2.0",
			id: 1,
			error: { code: -32005, message: "rate limited" },
		});
		await expect(t.request({ method: "eth_chainId", params: [] })).rejects.toMatchObject({
			code: -32005,
			message: "rate limited",
		});
	});
});

describe("sendJsonRpcRequest error handling", () => {
	const realFetch = globalThis.fetch;
	afterEach(() => {
		globalThis.fetch = realFetch;
	});

	test("surfaces the HTTP status instead of crashing on a non-envelope body", async () => {
		globalThis.fetch = mockFetch(401, { message: "unauthorized" }, "Unauthorized");
		await expect(
			ak.sendJsonRpcRequest("https://example.test/rpc", "eth_chainId", []),
		).rejects.toMatchObject({
			name: "TransportRpcError",
			message: expect.stringContaining("401"),
		});
	});

	test("surfaces the HTTP status for a non-JSON body", async () => {
		globalThis.fetch = mockFetch(502, "<html>Bad Gateway</html>", "Bad Gateway");
		await expect(
			ak.sendJsonRpcRequest("https://example.test/rpc", "eth_chainId", []),
		).rejects.toMatchObject({
			name: "TransportRpcError",
			message: expect.stringContaining("502"),
		});
	});
});
