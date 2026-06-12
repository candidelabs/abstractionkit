// Live test for issue #182: sendJsonRpcRequest (URL path) must keep
// accepting Tenderly-style responses that return the payload under
// `simulation_results` instead of `result`. Runs a real local HTTP
// server so the fetch-based code path is exercised end to end.

const http = require("node:http");
const ak = require("../../dist/index.cjs");

function startServer(body) {
	return new Promise((resolve) => {
		const server = http.createServer((_req, res) => {
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify(body));
		});
		server.listen(0, "127.0.0.1", () => {
			resolve({ server, url: `http://127.0.0.1:${server.address().port}` });
		});
	});
}

describe("sendJsonRpcRequest non-standard simulation_results responses (#182)", () => {
	let server;

	afterEach((done) => {
		if (server) {
			server.close(done);
			server = null;
		} else {
			done();
		}
	});

	test("returns the simulation_results payload instead of throwing", async () => {
		const payload = [{ transaction: { status: true } }];
		let url;
		({ server, url } = await startServer({
			id: 1,
			jsonrpc: "2.0",
			simulation_results: payload,
		}));
		const result = await ak.sendJsonRpcRequest(url, "tenderly_simulateBundle", [], {
			"Content-Type": "application/json",
		});
		expect(result).toEqual(payload);
	});

	test("standard result responses still work", async () => {
		let url;
		({ server, url } = await startServer({ id: 1, jsonrpc: "2.0", result: "0x1" }));
		const result = await ak.sendJsonRpcRequest(url, "eth_chainId", []);
		expect(result).toBe("0x1");
	});

	test("error responses still throw TransportRpcError", async () => {
		let url;
		({ server, url } = await startServer({
			id: 1,
			jsonrpc: "2.0",
			error: { code: -32601, message: "method not found" },
		}));
		await expect(ak.sendJsonRpcRequest(url, "eth_nope", [])).rejects.toMatchObject({
			code: -32601,
			message: "method not found",
		});
	});
});
