// Unit tests for the BundlerErrorCodeDict translation that moved out of
// sendJsonRpcRequest into the Bundler class. Uses a mock Transport.

const ak = require("../../dist/index.cjs");

describe("Bundler error mapping (moved from sendJsonRpcRequest)", () => {
	function rpcError(code, message) {
		const err = new Error(message);
		err.code = code;
		err.name = "TransportRpcError";
		return err;
	}

	function mockTransportThatThrows(err) {
		return { request: async () => { throw err; } };
	}

	test("constructor wraps a URL in HttpTransport", () => {
		const b = new ak.Bundler("https://example.test/rpc");
		expect(ak.isHttpTransport(b.transport)).toBe(true);
	});

	test("from() returns same instance for existing Bundler", () => {
		const b = new ak.Bundler("https://example.test/rpc");
		expect(ak.Bundler.from(b)).toBe(b);
	});

	test("-32500 → outer BUNDLER_ERROR, inner SIMULATE_VALIDATION", async () => {
		const t = mockTransportThatThrows(rpcError(-32500, "simulate validation failed"));
		const b = new ak.Bundler(t);
		try {
			await b.chainId();
			throw new Error("expected throw");
		} catch (err) {
			expect(err.code).toBe("BUNDLER_ERROR");
			expect(err.errno).toBe(-32500);
			expect(err.cause).toBeDefined();
			expect(err.cause.code).toBe("SIMULATE_VALIDATION");
			expect(err.cause.errno).toBe(-32500);
		}
	});

	test("-32601 → outer BUNDLER_ERROR, inner INVALID_USEROPERATION_HASH (Bundler-specific override of the standard JSON-RPC meaning)", async () => {
		const t = mockTransportThatThrows(rpcError(-32601, "not found"));
		const b = new ak.Bundler(t);
		try {
			await b.getUserOperationReceipt("0xabc");
			throw new Error("expected throw");
		} catch (err) {
			expect(err.code).toBe("BUNDLER_ERROR");
			expect(err.cause.code).toBe("INVALID_USEROPERATION_HASH");
		}
	});

	test("unknown JSON-RPC code → outer BUNDLER_ERROR, inner UNKNOWN_ERROR", async () => {
		const t = mockTransportThatThrows(rpcError(-99999, "wat"));
		const b = new ak.Bundler(t);
		try {
			await b.chainId();
			throw new Error("expected throw");
		} catch (err) {
			expect(err.code).toBe("BUNDLER_ERROR");
			expect(err.cause.code).toBe("UNKNOWN_ERROR");
			expect(err.cause.errno).toBe(-99999);
		}
	});

	test("each Bundler method goes through the same translation (sample)", async () => {
		const methods = [
			() => b.chainId(),
			() => b.supportedEntryPoints(),
			() =>
				b.estimateUserOperationGas(
					{ sender: "0x0", nonce: 0n, callData: "0x", initCode: "0x", callGasLimit: 0n, verificationGasLimit: 0n, preVerificationGas: 0n, maxFeePerGas: 0n, maxPriorityFeePerGas: 0n, paymasterAndData: "0x", signature: "0x" },
					"0x0",
				),
			() =>
				b.sendUserOperation(
					{ sender: "0x0", nonce: 0n, callData: "0x", initCode: "0x", callGasLimit: 0n, verificationGasLimit: 0n, preVerificationGas: 0n, maxFeePerGas: 0n, maxPriorityFeePerGas: 0n, paymasterAndData: "0x", signature: "0x" },
					"0x0",
				),
			() => b.getUserOperationReceipt("0xhash"),
			() => b.getUserOperationByHash("0xhash"),
		];
		const t = mockTransportThatThrows(rpcError(-32500, "test"));
		const b = new ak.Bundler(t);

		for (const m of methods) {
			try {
				await m();
				throw new Error("expected throw");
			} catch (err) {
				expect(err.code).toBe("BUNDLER_ERROR");
				expect(err.cause.code).toBe("SIMULATE_VALIDATION");
			}
		}
	});
});
