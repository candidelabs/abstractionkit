// Regression tests: JsonRpcNode and Bundler translate a failed request into
// NODE_ERROR / BUNDLER_ERROR with a coded inner error. They used to build
// that inner error from the message alone and drop the error they caught, so
// - the JSON-RPC `data` (the revert bytes of a failed eth_call, the data the
//   bundler spec defines for -32501 / -32521 and friends) was unreachable,
// - a failed fetch surfaced as "fetch failed" with no reason,
// - a cancelled request could not be told apart from a failed one.
// The transport error is now the cause of the inner error. Offline.

const ak = require("../../dist/index.cjs");

const REVERT_DATA = "0x08c379a0" + "00".repeat(32);
const ADDRESS = "0x" + "11".repeat(20);
const throwing = (error) => ({
	request: async () => {
		throw error;
	},
});
const caught = (promise) =>
	promise.then(
		() => {
			throw new Error("expected a rejection");
		},
		(error) => error,
	);

describe("JsonRpcNode keeps the transport error", () => {
	test("the revert data of a failed eth_call is reachable", async () => {
		const transportError = new ak.TransportRpcError(3, "execution reverted", REVERT_DATA);
		const error = await caught(new ak.JsonRpcNode(throwing(transportError)).call({ to: ADDRESS, data: "0x" }));
		// the documented shape is unchanged
		expect(error).toBeInstanceOf(ak.AbstractionKitError);
		expect(error.code).toBe("NODE_ERROR");
		expect(error.errno).toBe(3);
		expect(error.cause.code).toBe("UNKNOWN_ERROR");
		expect(error.cause.message).toBe("execution reverted");
		// and the transport error is still there
		expect(error.cause.cause).toBe(transportError);
		expect(error.cause.cause.data).toBe(REVERT_DATA);
		expect(JSON.parse(error.stringify()).cause.cause.data).toBe(REVERT_DATA);
	});

	test("the reason behind a failed fetch is reachable", async () => {
		const reason = new Error("connect ECONNREFUSED 127.0.0.1:9");
		const fetchError = new TypeError("fetch failed", { cause: reason });
		const error = await caught(new ak.JsonRpcNode(throwing(fetchError)).chainId());
		expect(error.code).toBe("NODE_ERROR");
		expect(error.cause.cause).toBe(fetchError);
		expect(error.cause.cause.cause).toBe(reason);
	});

	test("a cancelled request can be told apart from a failed one", async () => {
		const abort = new Error("This operation was aborted");
		abort.name = "AbortError";
		const error = await caught(new ak.JsonRpcNode(throwing(abort)).chainId());
		expect(error.code).toBe("NODE_ERROR");
		expect(error.cause.cause.name).toBe("AbortError");
	});
});

describe("Bundler keeps the transport error", () => {
	const userOperation = {
		sender: ADDRESS,
		nonce: 0n,
		factory: null,
		factoryData: null,
		callData: "0x",
		callGasLimit: 0n,
		verificationGasLimit: 0n,
		preVerificationGas: 0n,
		maxFeePerGas: 0n,
		maxPriorityFeePerGas: 0n,
		paymaster: null,
		paymasterVerificationGasLimit: null,
		paymasterPostOpGasLimit: null,
		paymasterData: null,
		signature: "0x",
	};

	test("the data of a bundler error is reachable, and the codes are unchanged", async () => {
		const data = { revertData: REVERT_DATA };
		const transportError = new ak.TransportRpcError(-32521, "execution reverted", data);
		const error = await caught(
			new ak.Bundler(throwing(transportError)).estimateUserOperationGas(userOperation, ak.ENTRYPOINT_V7),
		);
		expect(error.code).toBe("BUNDLER_ERROR");
		expect(error.errno).toBe(-32521);
		expect(error.cause.code).toBe("EXECUTION_REVERTED");
		expect(error.cause.cause).toBe(transportError);
		expect(error.cause.cause.data).toEqual(data);
	});

	test("the AA code is still parsed from the message", async () => {
		const transportError = new ak.TransportRpcError(-32500, "AA23 reverted", "0xdeadbeef");
		const error = await caught(
			new ak.Bundler(throwing(transportError)).estimateUserOperationGas(userOperation, ak.ENTRYPOINT_V7),
		);
		expect(error.aaCode).toBe("AA23");
		expect(error.cause.code).toBe("SIMULATE_VALIDATION");
		expect(error.cause.cause.data).toBe("0xdeadbeef");
	});

	test("the reason behind a failed fetch is reachable", async () => {
		const reason = new Error("getaddrinfo ENOTFOUND bundler.invalid");
		const fetchError = new TypeError("fetch failed", { cause: reason });
		const error = await caught(new ak.Bundler(throwing(fetchError)).chainId());
		expect(error.code).toBe("BUNDLER_ERROR");
		expect(error.cause.cause.cause).toBe(reason);
	});
});
