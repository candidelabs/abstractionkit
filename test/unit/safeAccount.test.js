const ak = require("../../dist/index.umd");
const { Wallet } = require("ethers");

const TEST_PRIVATE_KEY =
	"0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const TEST_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const TEST_ADDRESS_2 = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const TEST_PRIVATE_KEY_2 =
	"0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

// Hardcoded expected deterministic addresses (CREATE2)
const EXPECTED_V0_3_0_SINGLE = "0xFD8A78aE7924A1097C048672da0C131dC5e68C01";
const EXPECTED_V0_2_0_SINGLE = "0x3c1A37C27F1482793c77739060Be8C40D8df1BE1";
const EXPECTED_V0_3_0_MULTI = "0x8d5490dFA3742920a33D311eB89685e9F23E06CE";
const EXPECTED_V0_2_0_MULTI = "0x68E2B9bE82BB2E65f6991D833C13b30e526A30dF";

describe("SafeAccountV0_3_0", () => {
	test("createAccountAddress returns expected hardcoded address", () => {
		const address = ak.SafeAccountV0_3_0.createAccountAddress([
			TEST_ADDRESS,
		]);
		expect(address).toBe(EXPECTED_V0_3_0_SINGLE);
	});

	test("createAccountAddress is deterministic", () => {
		const address1 = ak.SafeAccountV0_3_0.createAccountAddress([
			TEST_ADDRESS,
		]);
		const address2 = ak.SafeAccountV0_3_0.createAccountAddress([
			TEST_ADDRESS,
		]);
		expect(address1).toBe(address2);
		expect(address1).toBe(EXPECTED_V0_3_0_SINGLE);
	});

	test("different owners produce different addresses", () => {
		const addr1 = ak.SafeAccountV0_3_0.createAccountAddress([
			TEST_ADDRESS,
		]);
		const addr2 = ak.SafeAccountV0_3_0.createAccountAddress([
			TEST_ADDRESS_2,
		]);
		expect(addr1).not.toBe(addr2);
	});

	test("initializeNewAccount returns expected hardcoded address", () => {
		const account = ak.SafeAccountV0_3_0.initializeNewAccount([
			TEST_ADDRESS,
		]);
		expect(account).toHaveProperty("accountAddress");
		expect(account.accountAddress).toBe(EXPECTED_V0_3_0_SINGLE);
	});

	test("constructor creates instance with given address", () => {
		const address = ak.SafeAccountV0_3_0.createAccountAddress([
			TEST_ADDRESS,
		]);
		const account = new ak.SafeAccountV0_3_0(address);
		expect(account.accountAddress).toBe(address);
	});

	test("has DEFAULT_ENTRYPOINT_ADDRESS", () => {
		expect(ak.SafeAccountV0_3_0.DEFAULT_ENTRYPOINT_ADDRESS).toBeDefined();
		expect(ak.SafeAccountV0_3_0.DEFAULT_ENTRYPOINT_ADDRESS).toMatch(
			/^0x[0-9a-fA-F]{40}$/,
		);
	});

	test("signUserOperation returns hex signature", () => {
		const address = ak.SafeAccountV0_3_0.createAccountAddress([
			TEST_ADDRESS,
		]);
		const account = new ak.SafeAccountV0_3_0(address);
		const userOp = {
			sender: address,
			nonce: 0n,
			factory: null,
			factoryData: null,
			callData: "0x",
			callGasLimit: 100000n,
			verificationGasLimit: 200000n,
			preVerificationGas: 50000n,
			maxFeePerGas: 1000000000n,
			maxPriorityFeePerGas: 100000000n,
			paymaster: null,
			paymasterVerificationGasLimit: null,
			paymasterPostOpGasLimit: null,
			paymasterData: null,
			signature: "0x",
		};
		const signature = account.signUserOperation(
			userOp,
			[TEST_PRIVATE_KEY],
			"1",
		);
		expect(signature).toMatch(/^0x[0-9a-fA-F]+$/);
	});

	test("signUserOperation with validAfter and validUntil", () => {
		const address = ak.SafeAccountV0_3_0.createAccountAddress([
			TEST_ADDRESS,
		]);
		const account = new ak.SafeAccountV0_3_0(address);
		const userOp = {
			sender: address,
			nonce: 0n,
			factory: null,
			factoryData: null,
			callData: "0x",
			callGasLimit: 100000n,
			verificationGasLimit: 200000n,
			preVerificationGas: 50000n,
			maxFeePerGas: 1000000000n,
			maxPriorityFeePerGas: 100000000n,
			paymaster: null,
			paymasterVerificationGasLimit: null,
			paymasterPostOpGasLimit: null,
			paymasterData: null,
			signature: "0x",
		};
		const now = BigInt(Math.ceil(Date.now() / 1000));
		const sig = account.signUserOperation(
			userOp,
			[TEST_PRIVATE_KEY],
			"1",
			now - 300n,
			now + 3000n,
		);
		expect(sig).toMatch(/^0x[0-9a-fA-F]+$/);
		// Signature should be non-trivial
		expect(sig.length).toBeGreaterThan(10);
	});

	test("multi-owner address matches expected hardcoded address", () => {
		const multiOwnerAddr = ak.SafeAccountV0_3_0.createAccountAddress([
			TEST_ADDRESS,
			TEST_ADDRESS_2,
		]);
		expect(multiOwnerAddr).toBe(EXPECTED_V0_3_0_MULTI);
		expect(multiOwnerAddr).not.toBe(EXPECTED_V0_3_0_SINGLE);
	});

	test("owner order matters for address computation", () => {
		const addr1 = ak.SafeAccountV0_3_0.createAccountAddress([
			TEST_ADDRESS,
			TEST_ADDRESS_2,
		]);
		const addr2 = ak.SafeAccountV0_3_0.createAccountAddress([
			TEST_ADDRESS_2,
			TEST_ADDRESS,
		]);
		expect(addr1).toBe(EXPECTED_V0_3_0_MULTI);
		expect(addr1).not.toBe(addr2);
	});

	test("different signers produce different signatures", () => {
		const address = ak.SafeAccountV0_3_0.createAccountAddress([
			TEST_ADDRESS,
		]);
		const account = new ak.SafeAccountV0_3_0(address);
		const userOp = {
			sender: address,
			nonce: 0n,
			factory: null,
			factoryData: null,
			callData: "0x",
			callGasLimit: 100000n,
			verificationGasLimit: 200000n,
			preVerificationGas: 50000n,
			maxFeePerGas: 1000000000n,
			maxPriorityFeePerGas: 100000000n,
			paymaster: null,
			paymasterVerificationGasLimit: null,
			paymasterPostOpGasLimit: null,
			paymasterData: null,
			signature: "0x",
		};
		const sig1 = account.signUserOperation(
			userOp,
			[TEST_PRIVATE_KEY],
			"1",
		);
		const sig2 = account.signUserOperation(userOp, [TEST_PRIVATE_KEY_2], "1");
		expect(sig1).not.toBe(sig2);
	});
});

describe("SafeAccountV0_2_0", () => {
	test("createAccountAddress returns expected hardcoded address", () => {
		const address = ak.SafeAccountV0_2_0.createAccountAddress([
			TEST_ADDRESS,
		]);
		expect(address).toBe(EXPECTED_V0_2_0_SINGLE);
	});

	test("multi-owner address matches expected hardcoded address", () => {
		const multiOwnerAddr = ak.SafeAccountV0_2_0.createAccountAddress([
			TEST_ADDRESS,
			TEST_ADDRESS_2,
		]);
		expect(multiOwnerAddr).toBe(EXPECTED_V0_2_0_MULTI);
	});

	test("has DEFAULT_ENTRYPOINT_ADDRESS", () => {
		expect(ak.SafeAccountV0_2_0.DEFAULT_ENTRYPOINT_ADDRESS).toBeDefined();
		expect(ak.SafeAccountV0_2_0.DEFAULT_ENTRYPOINT_ADDRESS).toMatch(
			/^0x[0-9a-fA-F]{40}$/,
		);
	});

	test("V0_2_0 and V0_3_0 produce different addresses for same owner", () => {
		const addrV2 = ak.SafeAccountV0_2_0.createAccountAddress([
			TEST_ADDRESS,
		]);
		const addrV3 = ak.SafeAccountV0_3_0.createAccountAddress([
			TEST_ADDRESS,
		]);
		expect(addrV2).toBe(EXPECTED_V0_2_0_SINGLE);
		expect(addrV3).toBe(EXPECTED_V0_3_0_SINGLE);
		expect(addrV2).not.toBe(addrV3);
	});

	test("signUserOperation returns hex signature", () => {
		const address = ak.SafeAccountV0_2_0.createAccountAddress([
			TEST_ADDRESS,
		]);
		const account = new ak.SafeAccountV0_2_0(address);
		const userOp = {
			sender: address,
			nonce: 0n,
			initCode: "0x",
			callData: "0x",
			callGasLimit: 100000n,
			verificationGasLimit: 200000n,
			preVerificationGas: 50000n,
			maxFeePerGas: 1000000000n,
			maxPriorityFeePerGas: 100000000n,
			paymasterAndData: "0x",
			signature: "0x",
		};
		const signature = account.signUserOperation(
			userOp,
			[TEST_PRIVATE_KEY],
			"1",
		);
		expect(signature).toMatch(/^0x[0-9a-fA-F]+$/);
	});
});

describe("SafeAccountFactory", () => {
	test("has DEFAULT_FACTORY_ADDRESS", () => {
		expect(ak.SafeAccountFactory.DEFAULT_FACTORY_ADDRESS).toMatch(
			/^0x[0-9a-fA-F]{40}$/,
		);
	});
});
