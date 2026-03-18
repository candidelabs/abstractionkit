const ak = require("../../dist/index.umd");
const { Wallet, JsonRpcProvider } = require("ethers");
const { ANVIL_RPC, ANVIL_CHAIN_ID, ANVIL_ACCOUNTS } = require("./anvil-setup");

jest.setTimeout(120000);

// Use account[1] for funding to avoid nonce conflicts with eip7702 tests
const owner = ANVIL_ACCOUNTS[1];
const owner2 = ANVIL_ACCOUNTS[2];

// Hardcoded expected addresses for account[0] (used in unit tests too)
const OWNER_0 = ANVIL_ACCOUNTS[0].address; // 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
const EXPECTED_V0_3_0_OWNER0 = "0xFD8A78aE7924A1097C048672da0C131dC5e68C01";
const EXPECTED_V0_2_0_OWNER0 = "0x3c1A37C27F1482793c77739060Be8C40D8df1BE1";

describe("SafeAccount address computation", () => {
	test("V0_3_0 matches hardcoded expected address", () => {
		const addr = ak.SafeAccountV0_3_0.createAccountAddress([OWNER_0]);
		expect(addr).toBe(EXPECTED_V0_3_0_OWNER0);
	});

	test("V0_2_0 matches hardcoded expected address", () => {
		const addr = ak.SafeAccountV0_2_0.createAccountAddress([OWNER_0]);
		expect(addr).toBe(EXPECTED_V0_2_0_OWNER0);
	});

	test("V0_3_0 and V0_2_0 produce different addresses for same owner", () => {
		const addrV3 = ak.SafeAccountV0_3_0.createAccountAddress([OWNER_0]);
		const addrV2 = ak.SafeAccountV0_2_0.createAccountAddress([OWNER_0]);
		expect(addrV3).toBe(EXPECTED_V0_3_0_OWNER0);
		expect(addrV2).toBe(EXPECTED_V0_2_0_OWNER0);
		expect(addrV3).not.toBe(addrV2);
	});

	test("multi-owner address differs from single-owner", () => {
		const single = ak.SafeAccountV0_3_0.createAccountAddress([
			owner.address,
		]);
		const multi = ak.SafeAccountV0_3_0.createAccountAddress([
			owner.address,
			owner2.address,
		]);
		expect(single).not.toBe(multi);
	});

	test("owner order matters for address computation", () => {
		const addr1 = ak.SafeAccountV0_3_0.createAccountAddress([
			owner.address,
			owner2.address,
		]);
		const addr2 = ak.SafeAccountV0_3_0.createAccountAddress([
			owner2.address,
			owner.address,
		]);
		expect(addr1).not.toBe(addr2);
	});
});

describe("SafeAccount initialization", () => {
	test("initializeNewAccount V0_3_0 returns account with correct address", () => {
		const expectedAddr = ak.SafeAccountV0_3_0.createAccountAddress([
			owner.address,
		]);
		const account = ak.SafeAccountV0_3_0.initializeNewAccount([
			owner.address,
		]);
		expect(account.accountAddress).toBe(expectedAddr);
	});

	test("initializeNewAccount V0_2_0 returns account with correct address", () => {
		const expectedAddr = ak.SafeAccountV0_2_0.createAccountAddress([
			owner.address,
		]);
		const account = ak.SafeAccountV0_2_0.initializeNewAccount([
			owner.address,
		]);
		expect(account.accountAddress).toBe(expectedAddr);
	});
});

describe("SafeAccount signing", () => {
	test("V0_3_0 signUserOperation produces valid signature", () => {
		const addr = ak.SafeAccountV0_3_0.createAccountAddress([
			owner.address,
		]);
		const account = new ak.SafeAccountV0_3_0(addr);
		const userOp = {
			sender: addr,
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
		const sig = account.signUserOperation(
			userOp,
			[owner.privateKey],
			String(ANVIL_CHAIN_ID),
		);
		expect(sig).toMatch(/^0x[0-9a-fA-F]+$/);
		expect(sig.length).toBeGreaterThan(10);
	});

	test("V0_2_0 signUserOperation produces valid signature", () => {
		const addr = ak.SafeAccountV0_2_0.createAccountAddress([
			owner.address,
		]);
		const account = new ak.SafeAccountV0_2_0(addr);
		const userOp = {
			sender: addr,
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
		const sig = account.signUserOperation(
			userOp,
			[owner.privateKey],
			String(ANVIL_CHAIN_ID),
		);
		expect(sig).toMatch(/^0x[0-9a-fA-F]+$/);
		expect(sig.length).toBeGreaterThan(10);
	});

	test("different signers produce different signatures", () => {
		const addr = ak.SafeAccountV0_3_0.createAccountAddress([
			owner.address,
		]);
		const account = new ak.SafeAccountV0_3_0(addr);
		const userOp = {
			sender: addr,
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
			[owner.privateKey],
			String(ANVIL_CHAIN_ID),
		);
		const sig2 = account.signUserOperation(
			userOp,
			[owner2.privateKey],
			String(ANVIL_CHAIN_ID),
		);
		expect(sig1).not.toBe(sig2);
	});
});

describe("SafeAccount with Anvil RPC", () => {
	test("computed account address has no code initially", async () => {
		const addr = ak.SafeAccountV0_3_0.createAccountAddress([
			owner.address,
		]);
		const code = await ak.sendJsonRpcRequest(
			ANVIL_RPC,
			"eth_getCode",
			[addr, "latest"],
		);
		expect(code).toBe("0x");
	});

	test("can fund the computed account address", async () => {
		const addr = ak.SafeAccountV0_3_0.createAccountAddress([
			owner.address,
		]);
		const provider = new JsonRpcProvider(ANVIL_RPC);
		const wallet = new Wallet(owner.privateKey, provider);

		const tx = await wallet.sendTransaction({
			to: addr,
			value: 1000000000000000000n, // 1 ETH
		});
		await tx.wait();

		const balance = await ak.sendJsonRpcRequest(
			ANVIL_RPC,
			"eth_getBalance",
			[addr, "latest"],
		);
		expect(BigInt(balance)).toBe(1000000000000000000n);
	});

	test("fetchGasPrice returns valid gas prices from Anvil", async () => {
		const [maxFeePerGas, maxPriorityFeePerGas] =
			await ak.fetchGasPrice(ANVIL_RPC);
		expect(typeof maxFeePerGas).toBe("bigint");
		expect(typeof maxPriorityFeePerGas).toBe("bigint");
		expect(maxFeePerGas).toBeGreaterThan(0n);
	});
});

describe("createCallData for Safe operations", () => {
	test("encodes mint(address) calldata", () => {
		const mintSelector = ak.getFunctionSelector("mint(address)");
		const addr = ak.SafeAccountV0_3_0.createAccountAddress([
			owner.address,
		]);
		const callData = ak.createCallData(
			mintSelector,
			["address"],
			[addr],
		);
		expect(callData).toMatch(/^0x6a627842/);
		expect(callData.length).toBe(10 + 64);
	});

	test("encodes transfer(address,uint256) calldata", () => {
		const transferSelector = ak.getFunctionSelector(
			"transfer(address,uint256)",
		);
		const callData = ak.createCallData(
			transferSelector,
			["address", "uint256"],
			[owner2.address, 1000000n],
		);
		expect(callData).toMatch(/^0xa9059cbb/);
	});
});

describe("UserOperation hash computation with Anvil chain ID", () => {
	test("V0_3_0 UserOp hash is consistent with chain ID", () => {
		const addr = ak.SafeAccountV0_3_0.createAccountAddress([
			owner.address,
		]);
		const userOp = {
			sender: addr,
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

		const entrypoint = ak.SafeAccountV0_3_0.DEFAULT_ENTRYPOINT_ADDRESS;
		const hash = ak.createUserOperationHash(
			userOp,
			entrypoint,
			BigInt(ANVIL_CHAIN_ID),
		);
		expect(hash).toMatch(/^0x[0-9a-f]{64}$/);

		const hash2 = ak.createUserOperationHash(
			userOp,
			entrypoint,
			BigInt(ANVIL_CHAIN_ID),
		);
		expect(hash).toBe(hash2);
	});
});
