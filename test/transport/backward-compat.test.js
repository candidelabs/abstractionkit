// Instance-construction smoke tests that don't hit the network.
// Verifies the BC-preserved patterns from FEATURE_TRANSPORT_PLAN.md §4.

const ak = require("../../dist/index.cjs");

describe("Backward-compatibility: instance construction", () => {
	test("new Bundler(url) — transport is an HttpTransport with the URL", () => {
		const b = new ak.Bundler("https://example.test/rpc");
		expect(ak.isHttpTransport(b.transport)).toBe(true);
		expect(b.transport.url).toBe("https://example.test/rpc");
	});

	test("Bundler.from(existingBundler) returns the same instance", () => {
		const b = new ak.Bundler("https://example.test/rpc");
		expect(ak.Bundler.from(b)).toBe(b);
	});

	test("new CandidePaymaster(url) — synchronous chainId inference from Candide URL", () => {
		const p = new ak.CandidePaymaster("https://api.candide.dev/public/v3/11155111");
		// The cached `chainId` field is private — we just check via internal access via
		// the `transport` field that the URL was preserved as HttpTransport.
		expect(ak.isHttpTransport(p.transport)).toBe(true);
		expect(p.transport.url).toBe("https://api.candide.dev/public/v3/11155111");
	});

	test("new CandidePaymaster(transport) — no URL to infer chainId from", () => {
		const fakeTransport = { request: async () => null };
		const p = new ak.CandidePaymaster(fakeTransport);
		expect(p.transport).toBe(fakeTransport);
	});

	test("CandidePaymaster.from(existing) returns the same instance", () => {
		const p = new ak.CandidePaymaster("https://api.candide.dev/public/v3/11155111");
		expect(ak.CandidePaymaster.from(p)).toBe(p);
	});

	test("new Erc7677Paymaster(pimlico url) auto-detects provider === 'pimlico'", () => {
		const p = new ak.Erc7677Paymaster("https://api.pimlico.io/v2/sepolia/rpc?apikey=test");
		expect(p.provider).toBe("pimlico");
	});

	test("new Erc7677Paymaster(candide url) auto-detects provider === 'candide'", () => {
		const p = new ak.Erc7677Paymaster("https://api.candide.dev/public/v3/11155111");
		expect(p.provider).toBe("candide");
	});

	test("new Erc7677Paymaster(transport) defaults provider to null", () => {
		const fakeTransport = { request: async () => null };
		const p = new ak.Erc7677Paymaster(fakeTransport);
		expect(p.provider).toBeNull();
	});

	test("new Erc7677Paymaster(transport, { provider: 'candide' }) honors override", () => {
		const fakeTransport = { request: async () => null };
		const p = new ak.Erc7677Paymaster(fakeTransport, { provider: "candide" });
		expect(p.provider).toBe("candide");
	});

	test("Erc7677Paymaster.from(existing) returns the same instance", () => {
		const p = new ak.Erc7677Paymaster("https://api.candide.dev/public/v3/11155111");
		expect(ak.Erc7677Paymaster.from(p)).toBe(p);
	});

	test("JsonRpcNode constructor wraps URL strings", () => {
		const n = new ak.JsonRpcNode("https://example.test/rpc");
		expect(ak.isHttpTransport(n.transport)).toBe(true);
	});

	test("JsonRpcNode.from(existing) returns the same instance", () => {
		const n = new ak.JsonRpcNode("https://example.test/rpc");
		expect(ak.JsonRpcNode.from(n)).toBe(n);
	});

	test("Bundler / Paymaster / JsonRpcNode all implement Transport.request", () => {
		const fakeTransport = { request: async () => "ok" };
		const b = new ak.Bundler(fakeTransport);
		const cp = new ak.CandidePaymaster(fakeTransport);
		const ep = new ak.Erc7677Paymaster(fakeTransport);
		const n = new ak.JsonRpcNode(fakeTransport);

		// All have the .request method (Transport contract).
		expect(typeof b.request).toBe("function");
		expect(typeof cp.request).toBe("function");
		expect(typeof ep.request).toBe("function");
		expect(typeof n.request).toBe("function");
	});

	test("Transport delegation: Bundler.request forwards to underlying transport", async () => {
		const calls = [];
		const fakeTransport = {
			request: async (args, options) => {
				calls.push({ args, options });
				return "0x1";
			},
		};
		const b = new ak.Bundler(fakeTransport);
		const result = await b.request({ method: "custom_method", params: [1, 2] });
		expect(result).toBe("0x1");
		expect(calls).toHaveLength(1);
		expect(calls[0].args.method).toBe("custom_method");
		expect(calls[0].args.params).toEqual([1, 2]);
	});
});
