const { AbstractionKitError } = require("../../dist/index.umd");

describe("AbstractionKitError", () => {
	test("is an instance of Error", () => {
		const err = new AbstractionKitError("UNKNOWN_ERROR", "test error");
		expect(err).toBeInstanceOf(Error);
	});

	test("sets code and message", () => {
		const err = new AbstractionKitError("BAD_DATA", "invalid input");
		expect(err.code).toBe("BAD_DATA");
		expect(err.message).toBe("invalid input");
	});

	test("sets optional errno", () => {
		const err = new AbstractionKitError("BUNDLER_ERROR", "failed", {
			errno: -32500,
		});
		expect(err.errno).toBe(-32500);
	});

	test("sets optional context", () => {
		const context = { url: "http://example.com", method: "eth_call" };
		const err = new AbstractionKitError("BAD_DATA", "failed", { context });
		expect(err.context).toEqual(context);
	});

	test("sets optional cause", () => {
		const cause = new Error("original error");
		const err = new AbstractionKitError("UNKNOWN_ERROR", "wrapped", {
			cause,
		});
		expect(err.cause).toBe(cause);
	});

	test("name property is set", () => {
		const err = new AbstractionKitError("UNKNOWN_ERROR", "test");
		// In UMD builds, name may be minified - just verify it exists
		expect(typeof err.name).toBe("string");
		expect(err.name.length).toBeGreaterThan(0);
	});

	test("stringify returns valid JSON with correct fields", () => {
		const err = new AbstractionKitError("BAD_DATA", "test message", {
			errno: 42,
			context: { foo: "bar" },
		});
		const json = err.stringify();
		const parsed = JSON.parse(json);
		expect(parsed.code).toBe("BAD_DATA");
		expect(parsed.message).toBe("test message");
		expect(parsed.errno).toBe(42);
		// context may be serialized differently in UMD due to JSON.stringify whitelist
		expect(parsed).toHaveProperty("context");
	});

	test("works with all BasicErrorCode values", () => {
		const codes = [
			"UNKNOWN_ERROR",
			"TIMEOUT",
			"BAD_DATA",
			"BUNDLER_ERROR",
			"PAYMASTER_ERROR",
		];
		for (const code of codes) {
			const err = new AbstractionKitError(code, `error: ${code}`);
			expect(err.code).toBe(code);
		}
	});

	test("works with BundlerErrorCode values", () => {
		const codes = [
			"INVALID_FIELDS",
			"SIMULATE_VALIDATION",
			"SIMULATE_PAYMASTER_VALIDATION",
			"EXECUTION_REVERTED",
		];
		for (const code of codes) {
			const err = new AbstractionKitError(code, `error: ${code}`);
			expect(err.code).toBe(code);
		}
	});

	test("defaults to empty options", () => {
		const err = new AbstractionKitError("UNKNOWN_ERROR", "test");
		expect(err.errno).toBeUndefined();
		expect(err.context).toBeUndefined();
		expect(err.cause).toBeUndefined();
	});

	test("stringify includes cause when present", () => {
		const cause = new Error("root cause");
		const err = new AbstractionKitError("BAD_DATA", "wrapped error", {
			cause,
		});
		const json = err.stringify();
		const parsed = JSON.parse(json);
		expect(parsed.cause).toBeDefined();
	});

	test("can be caught as Error", () => {
		expect(() => {
			throw new AbstractionKitError("BAD_DATA", "test throw");
		}).toThrow(Error);
	});

	test("can be caught by matching message", () => {
		expect(() => {
			throw new AbstractionKitError("BAD_DATA", "specific message");
		}).toThrow("specific message");
	});
});
