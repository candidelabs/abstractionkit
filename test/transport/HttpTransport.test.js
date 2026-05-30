// Unit tests for HttpTransport. Mocks fetch via the constructor's
// `fetch` option so no network is required.

const ak = require("../../dist/index.cjs");

describe("HttpTransport", () => {
	function makeMockFetch(handler) {
		const calls = [];
		const fn = async (url, init) => {
			calls.push({ url, init });
			return handler({ url, init });
		};
		fn.calls = calls;
		return fn;
	}

	function jsonResponse(body, status = 200) {
		return {
			ok: status < 400,
			status,
			json: async () => body,
		};
	}

	test("posts a JSON-RPC envelope and returns the result", async () => {
		const fetch = makeMockFetch(() => jsonResponse({ jsonrpc: "2.0", id: 1, result: "0xaa36a7" }));
		const t = new ak.HttpTransport("https://example.test/rpc", { fetch });

		const result = await t.request({ method: "eth_chainId" });
		expect(result).toBe("0xaa36a7");

		const call = fetch.calls[0];
		expect(call.url).toBe("https://example.test/rpc");
		expect(call.init.method).toBe("POST");
		expect(call.init.headers["Content-Type"]).toBe("application/json");
		expect(call.init.redirect).toBe("follow");

		const body = JSON.parse(call.init.body);
		expect(body.jsonrpc).toBe("2.0");
		expect(body.method).toBe("eth_chainId");
		expect(typeof body.id).toBe("number");
		// params is optional; envelope may omit it when not provided
	});

	test("serializes bigints in params as 0x-prefixed hex", async () => {
		const fetch = makeMockFetch(() => jsonResponse({ jsonrpc: "2.0", id: 1, result: "0x" }));
		const t = new ak.HttpTransport("https://example.test/rpc", { fetch });

		await t.request({ method: "eth_call", params: [{ value: 12345n }, "latest"] });

		const body = JSON.parse(fetch.calls[0].init.body);
		expect(body.params[0].value).toBe("0x3039");
		expect(body.params[1]).toBe("latest");
	});

	test("assigns incrementing ids to consecutive requests", async () => {
		const fetch = makeMockFetch(() => jsonResponse({ jsonrpc: "2.0", id: 1, result: "0x1" }));
		const t = new ak.HttpTransport("https://example.test/rpc", { fetch });

		await t.request({ method: "a" });
		await t.request({ method: "b" });
		await t.request({ method: "c" });

		const ids = fetch.calls.map((c) => JSON.parse(c.init.body).id);
		expect(new Set(ids).size).toBe(3); // all distinct
	});

	test("throws TransportRpcError on JSON-RPC error response", async () => {
		const fetch = makeMockFetch(() =>
			jsonResponse({
				jsonrpc: "2.0",
				id: 1,
				error: { code: -32601, message: "method not found", data: { detail: "extra" } },
			}),
		);
		const t = new ak.HttpTransport("https://example.test/rpc", { fetch });

		await expect(t.request({ method: "wat" })).rejects.toMatchObject({
			name: "TransportRpcError",
			code: -32601,
			message: "method not found",
			data: { detail: "extra" },
		});
	});

	test("throws TransportRpcError on malformed response", async () => {
		const fetch = makeMockFetch(() => jsonResponse({ jsonrpc: "2.0", id: 1 }));
		const t = new ak.HttpTransport("https://example.test/rpc", { fetch });

		await expect(t.request({ method: "eth_chainId" })).rejects.toMatchObject({
			name: "TransportRpcError",
			code: -32603,
		});
	});

	test("throws on non-2xx HTTP responses before parsing JSON-RPC", async () => {
		const fetch = makeMockFetch(() => jsonResponse({ error: "rate limited" }, 429));
		const t = new ak.HttpTransport("https://example.test/rpc", { fetch });

		await expect(t.request({ method: "eth_chainId" })).rejects.toThrow("HTTP 429");
	});

	test("merges user-supplied headers and pins Content-Type", async () => {
		const fetch = makeMockFetch(() => jsonResponse({ jsonrpc: "2.0", id: 1, result: "0x" }));
		const t = new ak.HttpTransport("https://example.test/rpc", {
			fetch,
			headers: {
				Authorization: "Bearer xyz",
				"Content-Type": "text/plain", // should be overridden
			},
		});

		await t.request({ method: "eth_chainId" });

		const headers = fetch.calls[0].init.headers;
		expect(headers["Authorization"]).toBe("Bearer xyz");
		expect(headers["Content-Type"]).toBe("application/json");
	});

	test("forwards AbortSignal into fetch", async () => {
		let receivedSignal = null;
		const fetch = async (_url, init) => {
			receivedSignal = init.signal;
			return jsonResponse({ jsonrpc: "2.0", id: 1, result: "0x" });
		};
		const t = new ak.HttpTransport("https://example.test/rpc", { fetch });

		const controller = new AbortController();
		await t.request({ method: "eth_chainId" }, { signal: controller.signal });

		expect(receivedSignal).toBe(controller.signal);
	});

	test("isHttpTransport narrows correctly", () => {
		const t = new ak.HttpTransport("https://example.test/rpc");
		expect(ak.isHttpTransport(t)).toBe(true);
		const plain = { request: async () => null };
		expect(ak.isHttpTransport(plain)).toBe(false);
	});

	test("exposes the URL on the instance", () => {
		const t = new ak.HttpTransport("https://example.test/rpc");
		expect(t.url).toBe("https://example.test/rpc");
	});
});
