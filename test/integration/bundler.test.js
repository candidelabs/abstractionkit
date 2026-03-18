const ak = require("../../dist/index.umd");
const { Wallet } = require("ethers");
const {
	ANVIL_RPC,
	ANVIL_CHAIN_ID,
	BUNDLER_RPC,
} = require("./anvil-setup");

jest.setTimeout(120000);

let bundlerAvailable = false;
let bundler;

beforeAll(async () => {
	try {
		const res = await fetch(BUNDLER_RPC, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				jsonrpc: "2.0",
				method: "eth_chainId",
				params: [],
				id: 1,
			}),
		});
		const data = await res.json();
		bundlerAvailable = !!data.result;
	} catch {
		bundlerAvailable = false;
	}
	if (!bundlerAvailable) {
		console.warn(
			"Voltaire bundler not reachable — skipping bundler tests",
		);
	}
	bundler = new ak.Bundler(BUNDLER_RPC);
});

// Use random wallets to avoid nonce conflicts with other test files
const ownerV03 = Wallet.createRandom();
const ownerV02 = Wallet.createRandom();

async function fundViaAnvil(address, amountHex) {
	await fetch(ANVIL_RPC, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			jsonrpc: "2.0",
			method: "anvil_setBalance",
			params: [address, amountHex],
			id: 1,
		}),
	});
}

describe("Bundler.chainId", () => {
	test("returns correct chain ID", async () => {
		
		const chainId = await bundler.chainId();
		expect(BigInt(chainId)).toBe(BigInt(ANVIL_CHAIN_ID));
	});
});

describe("Bundler.supportedEntryPoints", () => {
	test("returns an array of entrypoint addresses", async () => {
		
		const entryPoints = await bundler.supportedEntryPoints();
		expect(Array.isArray(entryPoints)).toBe(true);
		expect(entryPoints.length).toBeGreaterThan(0);
		for (const ep of entryPoints) {
			expect(ep).toMatch(/^0x[0-9a-fA-F]{40}$/);
		}
	});

	test("includes the v0.7 entrypoint", async () => {
		
		const entryPoints = await bundler.supportedEntryPoints();
		const v7 = ak.SafeAccountV0_3_0.DEFAULT_ENTRYPOINT_ADDRESS;
		const normalized = entryPoints.map((e) => e.toLowerCase());
		expect(normalized).toContain(v7.toLowerCase());
	});

	test("includes the v0.6 entrypoint", async () => {
		
		const entryPoints = await bundler.supportedEntryPoints();
		const v6 = ak.SafeAccountV0_2_0.DEFAULT_ENTRYPOINT_ADDRESS;
		const normalized = entryPoints.map((e) => e.toLowerCase());
		expect(normalized).toContain(v6.toLowerCase());
	});
});

describe("Bundler.getUserOperationReceipt", () => {
	test("returns null for non-existent hash", async () => {
		
		const fakeHash =
			"0x0000000000000000000000000000000000000000000000000000000000000001";
		const receipt = await bundler.getUserOperationReceipt(fakeHash);
		expect(receipt).toBeNull();
	});
});

describe("Bundler.getUserOperationByHash", () => {
	test("returns null for non-existent hash", async () => {
		
		const fakeHash =
			"0x0000000000000000000000000000000000000000000000000000000000000001";
		const result = await bundler.getUserOperationByHash(fakeHash);
		expect(result).toBeNull();
	});
});

describe("SafeAccountV0_3_0 UserOp via Bundler", () => {
	const owner = ownerV03;

	test("createUserOperation returns a valid UserOp with gas estimates", async () => {
		
		const account = ak.SafeAccountV0_3_0.initializeNewAccount([
			owner.address,
		]);

		// Fund the account via anvil_setBalance (no nonce needed)
		await fundViaAnvil(account.accountAddress, "0x1BC16D674EC80000"); // 2 ETH

		const userOp = await account.createUserOperation(
			[
				{
					to: owner.address,
					value: 0n,
					data: "0x",
				},
			],
			ANVIL_RPC,
			BUNDLER_RPC,
		);

		expect(userOp.sender).toBe(account.accountAddress);
		expect(typeof userOp.nonce).toBe("bigint");
		expect(typeof userOp.callGasLimit).toBe("bigint");
		expect(typeof userOp.verificationGasLimit).toBe("bigint");
		expect(typeof userOp.preVerificationGas).toBe("bigint");
		expect(userOp.callGasLimit).toBeGreaterThan(0n);
		expect(userOp.verificationGasLimit).toBeGreaterThan(0n);
		expect(userOp.preVerificationGas).toBeGreaterThan(0n);
		expect(typeof userOp.maxFeePerGas).toBe("bigint");
		expect(typeof userOp.maxPriorityFeePerGas).toBe("bigint");
	});

	test("sign and send UserOp through bundler", async () => {
		
		const account = ak.SafeAccountV0_3_0.initializeNewAccount([
			owner.address,
		]);

		// Fund the account
		await fundViaAnvil(account.accountAddress, "0x1BC16D674EC80000"); // 2 ETH

		// Create UserOp
		const userOp = await account.createUserOperation(
			[{ to: owner.address, value: 0n, data: "0x" }],
			ANVIL_RPC,
			BUNDLER_RPC,
		);

		// Sign UserOp
		userOp.signature = account.signUserOperation(
			userOp,
			[owner.privateKey],
			String(ANVIL_CHAIN_ID),
		);
		expect(userOp.signature).toMatch(/^0x[0-9a-fA-F]+$/);

		// Send UserOp through bundler
		const entrypoint = ak.SafeAccountV0_3_0.DEFAULT_ENTRYPOINT_ADDRESS;
		const userOpHash = await bundler.sendUserOperation(
			userOp,
			entrypoint,
		);
		expect(userOpHash).toMatch(/^0x[0-9a-f]{64}$/);

		// Wait for the bundler to include it
		const response = new ak.SendUseroperationResponse(
			userOpHash,
			bundler,
			entrypoint,
		);
		const receipt = await response.included();

		expect(receipt).toBeDefined();
		expect(receipt.success).toBe(true);
	});
});

describe("SafeAccountV0_2_0 UserOp via Bundler", () => {
	const owner = ownerV02;

	test("createUserOperation returns a valid V0_2_0 UserOp", async () => {
		
		const account = ak.SafeAccountV0_2_0.initializeNewAccount([
			owner.address,
		]);

		await fundViaAnvil(account.accountAddress, "0x1BC16D674EC80000"); // 2 ETH

		const userOp = await account.createUserOperation(
			[{ to: owner.address, value: 0n, data: "0x" }],
			ANVIL_RPC,
			BUNDLER_RPC,
		);

		expect(userOp.sender).toBe(account.accountAddress);
		expect(typeof userOp.nonce).toBe("bigint");
		expect(typeof userOp.callGasLimit).toBe("bigint");
		expect(typeof userOp.verificationGasLimit).toBe("bigint");
		expect(typeof userOp.preVerificationGas).toBe("bigint");
		expect(userOp.callGasLimit).toBeGreaterThan(0n);
	});
});

describe("Bundler.estimateUserOperationGas", () => {
	const owner = ownerV03;

	test("returns gas estimates for a funded account", async () => {
		
		const account = ak.SafeAccountV0_3_0.initializeNewAccount([
			owner.address,
		]);

		await fundViaAnvil(account.accountAddress, "0x1BC16D674EC80000"); // 2 ETH

		// Build a minimal UserOp for estimation
		const userOp = await account.createUserOperation(
			[{ to: owner.address, value: 0n, data: "0x" }],
			ANVIL_RPC,
			BUNDLER_RPC,
		);

		const entrypoint = ak.SafeAccountV0_3_0.DEFAULT_ENTRYPOINT_ADDRESS;
		const gas = await bundler.estimateUserOperationGas(
			userOp,
			entrypoint,
		);

		expect(typeof gas.callGasLimit).toBe("bigint");
		expect(typeof gas.verificationGasLimit).toBe("bigint");
		expect(typeof gas.preVerificationGas).toBe("bigint");
		expect(gas.callGasLimit).toBeGreaterThan(0n);
		expect(gas.verificationGasLimit).toBeGreaterThan(0n);
		expect(gas.preVerificationGas).toBeGreaterThan(0n);
	});
});
