const ak = require("../../dist/index.umd");
const { Wallet, JsonRpcProvider } = require("ethers");
const { ANVIL_RPC, ANVIL_CHAIN_ID, ANVIL_ACCOUNTS } = require("./anvil-setup");

jest.setTimeout(120000);

// Use account[0] for EIP-7702 tests
const sender = ANVIL_ACCOUNTS[0];

describe("EIP-7702 delegation authorization with Anvil", () => {
	test("creates valid delegation authorization", () => {
		const delegationTarget =
			"0xAbCdEf1234567890AbCdEf1234567890AbCdEf12";
		const auth = ak.createAndSignEip7702DelegationAuthorization(
			BigInt(ANVIL_CHAIN_ID),
			delegationTarget,
			0n,
			sender.privateKey,
		);

		expect(auth.address).toBe(delegationTarget);
		expect(BigInt(auth.chainId)).toBe(BigInt(ANVIL_CHAIN_ID));
		expect(BigInt(auth.nonce)).toBe(0n);
		expect(auth.r).toMatch(/^0x/);
		expect(auth.s).toMatch(/^0x/);
		expect(auth.yParity).toMatch(/^0x/);
	});

	test("authorization hash is deterministic for same inputs", () => {
		const hash1 = ak.createEip7702DelegationAuthorizationHash(
			BigInt(ANVIL_CHAIN_ID),
			"0xAbCdEf1234567890AbCdEf1234567890AbCdEf12",
			0n,
		);
		const hash2 = ak.createEip7702DelegationAuthorizationHash(
			BigInt(ANVIL_CHAIN_ID),
			"0xAbCdEf1234567890AbCdEf1234567890AbCdEf12",
			0n,
		);
		expect(hash1).toBe(hash2);
	});
});

describe("EIP-7702 raw transaction creation with Anvil", () => {
	test("creates signed transaction with correct prefix", () => {
		const tx = ak.createAndSignEip7702RawTransaction(
			BigInt(ANVIL_CHAIN_ID),
			0n,
			1000000000n,
			2000000000n,
			21000n,
			"0x0000000000000000000000000000000000000000",
			0n,
			"0x",
			[],
			[],
			sender.privateKey,
		);

		expect(tx).toMatch(/^0x04/);
		expect(tx.length).toBeGreaterThan(10);
	});

	test("transaction with authorization list is longer", () => {
		const auth = {
			chainId: BigInt(ANVIL_CHAIN_ID),
			address: "0xAbCdEf1234567890AbCdEf1234567890AbCdEf12",
			nonce: 0n,
			yParity: 0,
			r: 1n,
			s: 2n,
		};

		const txNoAuth = ak.createAndSignEip7702RawTransaction(
			BigInt(ANVIL_CHAIN_ID),
			0n,
			1000000000n,
			2000000000n,
			100000n,
			"0x0000000000000000000000000000000000000000",
			0n,
			"0x",
			[],
			[],
			sender.privateKey,
		);

		const txWithAuth = ak.createAndSignEip7702RawTransaction(
			BigInt(ANVIL_CHAIN_ID),
			0n,
			1000000000n,
			2000000000n,
			100000n,
			"0x0000000000000000000000000000000000000000",
			0n,
			"0x",
			[],
			[auth],
			sender.privateKey,
		);

		expect(txWithAuth.length).toBeGreaterThan(txNoAuth.length);
	});

	test("transaction hash is deterministic", () => {
		const hash1 = ak.createEip7702TransactionHash(
			BigInt(ANVIL_CHAIN_ID),
			0n,
			1000000000n,
			2000000000n,
			21000n,
			"0x0000000000000000000000000000000000000000",
			0n,
			"0x",
			[],
			[],
		);
		const hash2 = ak.createEip7702TransactionHash(
			BigInt(ANVIL_CHAIN_ID),
			0n,
			1000000000n,
			2000000000n,
			21000n,
			"0x0000000000000000000000000000000000000000",
			0n,
			"0x",
			[],
			[],
		);
		expect(hash1).toBe(hash2);
	});
});

describe("Legacy transaction with Anvil", () => {
	test("creates and signs a legacy transaction", () => {
		const tx = ak.createAndSignLegacyRawTransaction(
			BigInt(ANVIL_CHAIN_ID),
			0n,
			20000000000n,
			21000n,
			"0x0000000000000000000000000000000000000000",
			0n,
			"0x",
			sender.privateKey,
		);
		expect(tx).toMatch(/^0x/);
		expect(tx.length).toBeGreaterThan(10);
	});

	test("can submit legacy transaction to Anvil", async () => {
		const provider = new JsonRpcProvider(ANVIL_RPC);
		const nonce = await provider.getTransactionCount(sender.address);
		const feeData = await provider.getFeeData();

		const tx = ak.createAndSignLegacyRawTransaction(
			BigInt(ANVIL_CHAIN_ID),
			BigInt(nonce),
			feeData.gasPrice || 20000000000n,
			21000n,
			ANVIL_ACCOUNTS[2].address,
			1000000000000000n, // 0.001 ETH
			"0x",
			sender.privateKey,
		);

		const result = await ak.sendJsonRpcRequest(
			ANVIL_RPC,
			"eth_sendRawTransaction",
			[tx],
		);
		expect(result).toMatch(/^0x[0-9a-f]{64}$/);
	});
});
