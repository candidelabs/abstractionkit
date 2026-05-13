// Unit tests for JsonRpcNode. Uses a hand-rolled mock Transport so no network
// is required and the params/method are inspected directly.

const ak = require("../../dist/index.cjs");

describe("JsonRpcNode", () => {
	function makeMockTransport(handler) {
		const calls = [];
		return {
			request: async (args, options) => {
				calls.push({ args, options });
				return handler(args);
			},
			calls,
		};
	}

	function tx(handler) {
		return makeMockTransport(handler);
	}

	function rpcError(code, message, data) {
		const err = new Error(message);
		err.code = code;
		err.data = data;
		err.name = "TransportRpcError";
		return err;
	}

	test("constructor wraps a string in HttpTransport", () => {
		const node = new ak.JsonRpcNode("https://example.test/rpc");
		expect(ak.isHttpTransport(node.transport)).toBe(true);
		expect(node.transport.url).toBe("https://example.test/rpc");
	});

	test("constructor accepts a Transport instance directly", () => {
		const mock = tx(() => "0x1");
		const node = new ak.JsonRpcNode(mock);
		expect(node.transport).toBe(mock);
	});

	test("from() returns the same instance when input is JsonRpcNode", () => {
		const node = new ak.JsonRpcNode("https://example.test/rpc");
		expect(ak.JsonRpcNode.from(node)).toBe(node);
	});

	test("from() wraps a string", () => {
		const node = ak.JsonRpcNode.from("https://example.test/rpc");
		expect(node).toBeInstanceOf(ak.JsonRpcNode);
		expect(ak.isHttpTransport(node.transport)).toBe(true);
	});

	test("from() wraps a Transport", () => {
		const mock = tx(() => "0x1");
		const node = ak.JsonRpcNode.from(mock);
		expect(node).toBeInstanceOf(ak.JsonRpcNode);
		expect(node.transport).toBe(mock);
	});

	test("chainId() sends eth_chainId and returns the hex string", async () => {
		const mock = tx(({ method }) => {
			expect(method).toBe("eth_chainId");
			return "0xaa36a7";
		});
		const node = new ak.JsonRpcNode(mock);
		expect(await node.chainId()).toBe("0xaa36a7");
	});

	test("chainId() throws BAD_DATA when the transport returns a non-string", async () => {
		const mock = tx(() => 12345);
		const node = new ak.JsonRpcNode(mock);
		await expect(node.chainId()).rejects.toMatchObject({
			name: "AbstractionKitError",
			code: "BAD_DATA",
		});
	});

	test("blockNumber() returns a bigint", async () => {
		const mock = tx(({ method }) => {
			expect(method).toBe("eth_blockNumber");
			return "0x100";
		});
		const node = new ak.JsonRpcNode(mock);
		expect(await node.blockNumber()).toBe(256n);
	});

	test("getCode() sends eth_getCode with the expected params", async () => {
		const mock = tx(({ method, params }) => {
			expect(method).toBe("eth_getCode");
			expect(params).toEqual(["0xdead", "latest"]);
			return "0xef01001234567890123456789012345678901234567890";
		});
		const node = new ak.JsonRpcNode(mock);
		const code = await node.getCode("0xdead");
		expect(typeof code).toBe("string");
	});

	test("call() sends eth_call without state overrides", async () => {
		const mock = tx(({ method, params }) => {
			expect(method).toBe("eth_call");
			expect(params).toHaveLength(2);
			expect(params[1]).toBe("latest");
			return "0x0";
		});
		const node = new ak.JsonRpcNode(mock);
		await node.call({ to: "0xdead" });
	});

	test("call() includes state overrides as a third param when provided", async () => {
		const mock = tx(({ method, params }) => {
			expect(method).toBe("eth_call");
			expect(params).toHaveLength(3);
			expect(params[2]).toEqual({ "0xdead": { balance: "0x1" } });
			return "0x0";
		});
		const node = new ak.JsonRpcNode(mock);
		await node.call({ to: "0xdead" }, "latest", { "0xdead": { balance: "0x1" } });
	});

	test("getFeeData() applies the gasLevel multiplier and returns bigints", async () => {
		// eth_gasPrice and eth_maxPriorityFeePerGas both available
		const mock = tx(({ method }) => {
			if (method === "eth_gasPrice") return "0x3b9aca00"; // 1 gwei
			if (method === "eth_maxPriorityFeePerGas") return "0x77359400"; // 2 gwei
			return null;
		});
		const node = new ak.JsonRpcNode(mock);
		const [maxFee, priority] = await node.getFeeData(ak.GasOption.Medium); // 1.2x
		// 1e9 * 1.2 = 1.2e9, 2e9 * 1.2 = 2.4e9
		expect(maxFee).toBe(1_200_000_000n);
		expect(priority).toBe(2_400_000_000n);
	});

	test("getFeeData() falls back to a default when neither call is supported", async () => {
		const mock = {
			request: async () => {
				const err = new Error("not supported");
				err.code = -32601;
				err.name = "TransportRpcError";
				throw err;
			},
		};
		const node = new ak.JsonRpcNode(mock);
		const [maxFee, priority] = await node.getFeeData(ak.GasOption.Slow); // 1.0x
		expect(maxFee).toBe(1_000_000_000n); // 1 gwei floor
		expect(priority).toBe(maxFee);
	});

	test("getFeeData() preserves BigInt precision above Number.MAX_SAFE_INTEGER", async () => {
		// Number.MAX_SAFE_INTEGER + 1 = 2^53 is the boundary where doubles
		// start skipping integers (the next representable integer is 2^53 + 2).
		// We pick 2^53 + 1, which Number rounds DOWN to 2^53, so the lossy
		// path produces a strictly smaller result than the BigInt-correct one.
		const largeGasPrice = 9_007_199_254_740_993n; // 2^53 + 1
		// BigInt-correct: ceil(value * 1.2 in BigInt space).
		const expected = (largeGasPrice * 1200n + 999n) / 1000n;
		// Lossy reference path: how the old `Number(...)` implementation
		// behaved. Demonstrates the precision drop we're guarding against.
		const lossy = BigInt(Math.ceil(Number(largeGasPrice) * 1.2));
		expect(lossy).toBeLessThan(expected); // sanity: the two paths really differ

		const hexPrice = `0x${largeGasPrice.toString(16)}`;
		const mock = tx(({ method }) => {
			if (method === "eth_gasPrice") return hexPrice;
			if (method === "eth_maxPriorityFeePerGas") return hexPrice;
			return null;
		});
		const node = new ak.JsonRpcNode(mock);
		const [maxFee, priority] = await node.getFeeData(ak.GasOption.Medium); // 1.2x
		expect(maxFee).toBe(expected);
		expect(priority).toBe(expected);
		expect(maxFee).not.toBe(lossy);
	});

	test("getTransactionCount() returns bigint", async () => {
		const mock = tx(({ method, params }) => {
			expect(method).toBe("eth_getTransactionCount");
			expect(params).toEqual(["0xdead", "latest"]);
			return "0xa";
		});
		const node = new ak.JsonRpcNode(mock);
		expect(await node.getTransactionCount("0xdead")).toBe(10n);
	});

	test("getDelegatedAddress() returns null when bytecode is not the EIP-7702 prefix", async () => {
		const mock = tx(() => "0x");
		const node = new ak.JsonRpcNode(mock);
		expect(await node.getDelegatedAddress("0xdead")).toBeNull();
	});

	test("getDelegatedAddress() returns the checksummed delegatee address when delegated", async () => {
		const delegatee = "0x1234567890123456789012345678901234567890";
		const mock = tx(() => `0xef0100${delegatee.slice(2)}`);
		const node = new ak.JsonRpcNode(mock);
		const result = await node.getDelegatedAddress("0xdead");
		expect(result).not.toBeNull();
		expect(result.toLowerCase()).toBe(delegatee.toLowerCase());
	});

	test("getEntryPointNonce() decodes the eth_call result as a bigint", async () => {
		const entryPoint = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
		const account = "0x1234567890123456789012345678901234567890";
		const mock = tx(({ method, params }) => {
			expect(method).toBe("eth_call");
			expect(params[0].to).toBe(entryPoint);
			// data should start with the getNonce selector
			expect(params[0].data.startsWith("0x35567e1a")).toBe(true);
			return "0x0000000000000000000000000000000000000000000000000000000000000005";
		});
		const node = new ak.JsonRpcNode(mock);
		expect(await node.getEntryPointNonce(entryPoint, account)).toBe(5n);
	});

	test("forwards AbortSignal to the transport", async () => {
		let receivedOptions = null;
		const mock = {
			request: async (_args, options) => {
				receivedOptions = options;
				return "0x1";
			},
		};
		const node = new ak.JsonRpcNode(mock);
		const controller = new AbortController();
		await node.chainId({ signal: controller.signal });
		expect(receivedOptions).toBeDefined();
		expect(receivedOptions.signal).toBe(controller.signal);
	});

	test("error mapping: known JSON-RPC code becomes NODE_ERROR with named inner code", async () => {
		const mock = {
			request: async () => {
				throw rpcError(-32601, "method not found");
			},
		};
		const node = new ak.JsonRpcNode(mock);
		try {
			await node.chainId();
			throw new Error("expected throw");
		} catch (err) {
			expect(err.code).toBe("NODE_ERROR");
			expect(err.errno).toBe(-32601);
			expect(err.cause).toBeDefined();
			expect(err.cause.code).toBe("METHOD_NOT_FOUND");
			expect(err.cause.errno).toBe(-32601);
		}
	});

	test("error mapping: unknown JSON-RPC code falls back to UNKNOWN_ERROR", async () => {
		const mock = {
			request: async () => {
				throw rpcError(-99999, "wat");
			},
		};
		const node = new ak.JsonRpcNode(mock);
		try {
			await node.chainId();
			throw new Error("expected throw");
		} catch (err) {
			expect(err.code).toBe("NODE_ERROR");
			expect(err.cause.code).toBe("UNKNOWN_ERROR");
			expect(err.cause.errno).toBe(-99999);
		}
	});

	test("JsonRpcNode itself is a Transport (implements request)", async () => {
		const mock = tx(({ method }) => (method === "eth_blockNumber" ? "0x42" : null));
		const node = new ak.JsonRpcNode(mock);
		const result = await node.request({ method: "eth_blockNumber" });
		expect(result).toBe("0x42");
		expect(mock.calls).toHaveLength(1);
	});
});
