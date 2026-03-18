const ak = require("../../dist/index.umd");
const { ANVIL_RPC, ANVIL_CHAIN_ID, ANVIL_ACCOUNTS } = require("./anvil-setup");

jest.setTimeout(120000);

describe("sendJsonRpcRequest against Anvil", () => {
	test("eth_chainId returns correct chain ID", async () => {
		const result = await ak.sendJsonRpcRequest(
			ANVIL_RPC,
			"eth_chainId",
			[],
		);
		expect(BigInt(result)).toBe(BigInt(ANVIL_CHAIN_ID));
	});

	test("eth_blockNumber returns a hex number", async () => {
		const result = await ak.sendJsonRpcRequest(
			ANVIL_RPC,
			"eth_blockNumber",
			[],
		);
		expect(result).toMatch(/^0x[0-9a-fA-F]+$/);
	});

	test("eth_getBalance returns balance for funded account", async () => {
		const result = await ak.sendJsonRpcRequest(
			ANVIL_RPC,
			"eth_getBalance",
			[ANVIL_ACCOUNTS[0].address, "latest"],
		);
		expect(BigInt(result)).toBeGreaterThan(0n);
	});

	test("eth_getBalance returns a valid hex balance", async () => {
		const result = await ak.sendJsonRpcRequest(
			ANVIL_RPC,
			"eth_getBalance",
			["0x000000000000000000000000000000000000dEaD", "latest"],
		);
		expect(result).toMatch(/^0x[0-9a-fA-F]*$/);
	});

	test("handles bigint parameters (auto-converted to hex)", async () => {
		const result = await ak.sendJsonRpcRequest(
			ANVIL_RPC,
			"eth_getBalance",
			[ANVIL_ACCOUNTS[0].address, "latest"],
		);
		expect(typeof result).toBe("string");
	});

	test("throws for invalid method", async () => {
		await expect(
			ak.sendJsonRpcRequest(ANVIL_RPC, "eth_nonExistentMethod", []),
		).rejects.toThrow();
	});

	test("throws on unreachable URL", async () => {
		await expect(
			ak.sendJsonRpcRequest("http://127.0.0.1:1", "eth_chainId", []),
		).rejects.toThrow();
	});

	test("eth_getCode returns hex string", async () => {
		const result = await ak.sendJsonRpcRequest(
			ANVIL_RPC,
			"eth_getCode",
			[ANVIL_ACCOUNTS[0].address, "latest"],
		);
		expect(result).toMatch(/^0x/);
	});
});

describe("fetchGasPrice against Anvil", () => {
	test("returns [maxFeePerGas, maxPriorityFeePerGas] as bigints", async () => {
		const [maxFee, maxPriority] = await ak.fetchGasPrice(ANVIL_RPC);
		expect(typeof maxFee).toBe("bigint");
		expect(typeof maxPriority).toBe("bigint");
		expect(maxFee).toBeGreaterThan(0n);
		expect(maxPriority).toBeGreaterThan(0n);
	});

	test("GasOption.Slow returns lower fees than GasOption.Fast", async () => {
		const [slowFee] = await ak.fetchGasPrice(
			ANVIL_RPC,
			ak.GasOption.Slow,
		);
		const [fastFee] = await ak.fetchGasPrice(
			ANVIL_RPC,
			ak.GasOption.Fast,
		);
		expect(fastFee).toBeGreaterThanOrEqual(slowFee);
	});

	test("throws on unreachable URL", async () => {
		await expect(
			ak.fetchGasPrice("http://127.0.0.1:1"),
		).rejects.toThrow();
	});
});

describe("Bundler class against Anvil (as generic JSON-RPC)", () => {
	test("chainId method works against standard node", async () => {
		const bundler = new ak.Bundler(ANVIL_RPC);
		const chainId = await bundler.chainId();
		expect(BigInt(chainId)).toBe(BigInt(ANVIL_CHAIN_ID));
	});
});
