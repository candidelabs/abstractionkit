// Regression tests for the URL path of sendJsonRpcRequest, which has its own
// fetch code and had drifted from HttpTransport:
// - a JSON-RPC error lost its `data` (the revert bytes of a failed eth_call)
// - a `result` delivered next to an error object won over the error
// - custom headers replaced the default Content-Type, so the JSON body went
//   out as text/plain
// Offline: global fetch is mocked.

const ak = require("../../dist/index.cjs");

const URL = "https://example.test/rpc";
const REVERT_DATA = "0x08c379a0" + "00".repeat(32);

function mockFetch(status, body) {
	const calls = [];
	const fetchImpl = async (url, init) => {
		calls.push({ url, init });
		return {
			ok: status >= 200 && status < 300,
			status,
			statusText: "",
			text: async () => JSON.stringify(body),
			json: async () => body,
		};
	};
	return { fetchImpl, calls };
}

describe("sendJsonRpcRequest with a URL", () => {
	const originalFetch = global.fetch;
	afterEach(() => {
		global.fetch = originalFetch;
	});

	async function both(status, body) {
		const { fetchImpl } = mockFetch(status, body);
		global.fetch = fetchImpl;
		const viaUrl = await ak.sendJsonRpcRequest(URL, "eth_call", []).then(
			(result) => ({ result }),
			(error) => ({ error }),
		);
		const viaTransport = await new ak.HttpTransport(URL, { fetch: fetchImpl })
			.request({ method: "eth_call", params: [] })
			.then(
				(result) => ({ result }),
				(error) => ({ error }),
			);
		return { viaUrl, viaTransport };
	}

	test.each([
		["HTTP 200", 200],
		["an HTTP failure status", 500],
	])("a JSON-RPC error keeps its data on %s", async (_name, status) => {
		const { viaUrl, viaTransport } = await both(status, {
			jsonrpc: "2.0",
			id: 1,
			error: { code: 3, message: "execution reverted", data: REVERT_DATA },
		});
		expect(viaUrl.error).toBeInstanceOf(ak.TransportRpcError);
		expect(viaUrl.error).toMatchObject({ code: 3, message: "execution reverted", data: REVERT_DATA });
		expect(viaTransport.error).toMatchObject({ code: 3, data: REVERT_DATA });
	});

	test("an error object wins over a result delivered next to it", async () => {
		const { viaUrl, viaTransport } = await both(200, {
			jsonrpc: "2.0",
			id: 1,
			result: null,
			error: { code: -32000, message: "boom" },
		});
		expect(viaUrl.error).toMatchObject({ code: -32000, message: "boom" });
		expect(viaTransport.error).toMatchObject({ code: -32000, message: "boom" });
	});

	test("error: null next to a result is still a success", async () => {
		const { viaUrl, viaTransport } = await both(200, { jsonrpc: "2.0", id: 1, result: "0x1", error: null });
		expect(viaUrl.result).toBe("0x1");
		expect(viaTransport.result).toBe("0x1");
	});

	test("custom headers keep the JSON Content-Type", async () => {
		const { fetchImpl, calls } = mockFetch(200, { jsonrpc: "2.0", id: 1, result: "0x1" });
		global.fetch = fetchImpl;
		await ak.sendJsonRpcRequest(URL, "eth_chainId", [], { Authorization: "Bearer k" });
		expect(calls[0].init.headers).toEqual({ Authorization: "Bearer k", "Content-Type": "application/json" });
	});

	test("a caller's own content type is left alone, in any letter case", async () => {
		const { fetchImpl, calls } = mockFetch(200, { jsonrpc: "2.0", id: 1, result: "0x1" });
		global.fetch = fetchImpl;
		await ak.sendJsonRpcRequest(URL, "eth_chainId", [], { "content-type": "application/json; charset=utf-8" });
		expect(calls[0].init.headers).toEqual({ "content-type": "application/json; charset=utf-8" });
		await ak.sendJsonRpcRequest(URL, "eth_chainId", []);
		expect(calls[1].init.headers).toEqual({ "Content-Type": "application/json" });
	});
});
