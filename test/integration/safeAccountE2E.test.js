const ak = require("../../dist/index.umd");
const { Wallet } = require("ethers");
const {
	ANVIL_RPC,
	ANVIL_CHAIN_ID,
	BUNDLER_RPC,
} = require("./anvil-setup");

jest.setTimeout(300000);

let bundlerAvailable = false;

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
			"Voltaire bundler not reachable — skipping Safe V0_3_0 e2e tests",
		);
	}
});

const owner = Wallet.createRandom();
const owner2 = Wallet.createRandom();
const owner3 = Wallet.createRandom();

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

async function sendSignedUserOp(smartAccount, userOp, ownerPrivateKey) {
	userOp.signature = smartAccount.signUserOperation(
		userOp,
		[ownerPrivateKey],
		BigInt(ANVIL_CHAIN_ID),
	);

	const response = await smartAccount.sendUserOperation(userOp, BUNDLER_RPC);
	const receipt = await response.included();
	return receipt;
}

describe("Safe account e2e — V0_3_0", () => {
	let smartAccount;
	let accountAddress;

	beforeAll(async () => {
		accountAddress = ak.SafeAccountV0_3_0.createAccountAddress([
			owner.address,
		]);

		
		await fundViaAnvil(accountAddress, "0x4563918244F40000"); // 5 ETH
	});

	test("initialization computes correct address", () => {
		const account = ak.SafeAccountV0_3_0.initializeNewAccount([
			owner.address,
		]);
		expect(account.accountAddress).toBe(accountAddress);
	});

	test("account is funded", async () => {
		
		const balance = await ak.sendJsonRpcRequest(
			ANVIL_RPC,
			"eth_getBalance",
			[accountAddress, "latest"],
		);
		expect(BigInt(balance)).toBeGreaterThan(0n);
	});

	test("create, sign, and send UserOp to deploy account", async () => {
		

		smartAccount = ak.SafeAccountV0_3_0.initializeNewAccount([
			owner.address,
		]);

		const userOp = await smartAccount.createUserOperation(
			[{ to: owner.address, value: 0n, data: "0x" }],
			ANVIL_RPC,
			BUNDLER_RPC,
			{ verificationGasLimitPercentageMultiplier: 200 },
		);

		expect(userOp.sender).toBe(smartAccount.accountAddress);

		const receipt = await sendSignedUserOp(
			smartAccount,
			userOp,
			owner.privateKey,
		);

		expect(receipt).toBeDefined();
		expect(receipt.success).toBe(true);

		const code = await ak.sendJsonRpcRequest(
			ANVIL_RPC,
			"eth_getCode",
			[accountAddress, "latest"],
		);
		expect(code).not.toBe("0x");
	});

	test("add owner", async () => {
		

		smartAccount = new ak.SafeAccountV0_3_0(accountAddress);

		const addOwnerMetaTransactions =
			await smartAccount.createAddOwnerWithThresholdMetaTransactions(
				owner2.address,
				1,
			);

		const userOp = await smartAccount.createUserOperation(
			addOwnerMetaTransactions,
			ANVIL_RPC,
			BUNDLER_RPC,
		);

		const receipt = await sendSignedUserOp(
			smartAccount,
			userOp,
			owner.privateKey,
		);
		expect(receipt.success).toBe(true);

		const owners = await smartAccount.getOwners(ANVIL_RPC);
		expect(owners.map((o) => o.toLowerCase())).toContain(
			owner2.address.toLowerCase(),
		);
		expect(owners.map((o) => o.toLowerCase())).toContain(
			owner.address.toLowerCase(),
		);
	});

	test("swap owner", async () => {
		

		smartAccount = new ak.SafeAccountV0_3_0(accountAddress);

		const swapOwnerMetaTransactions =
			await smartAccount.createSwapOwnerMetaTransactions(
				ANVIL_RPC,
				owner3.address,
				owner2.address,
			);

		const userOp = await smartAccount.createUserOperation(
			swapOwnerMetaTransactions,
			ANVIL_RPC,
			BUNDLER_RPC,
		);

		const receipt = await sendSignedUserOp(
			smartAccount,
			userOp,
			owner.privateKey,
		);
		expect(receipt.success).toBe(true);

		const owners = await smartAccount.getOwners(ANVIL_RPC);
		expect(owners.map((o) => o.toLowerCase())).toContain(
			owner3.address.toLowerCase(),
		);
		expect(owners.map((o) => o.toLowerCase())).not.toContain(
			owner2.address.toLowerCase(),
		);
	});

	test("remove owner", async () => {
		

		smartAccount = new ak.SafeAccountV0_3_0(accountAddress);

		const removeOwnerMetaTransaction =
			await smartAccount.createRemoveOwnerMetaTransaction(
				ANVIL_RPC,
				owner3.address,
				1,
			);

		const userOp = await smartAccount.createUserOperation(
			[removeOwnerMetaTransaction],
			ANVIL_RPC,
			BUNDLER_RPC,
		);

		const receipt = await sendSignedUserOp(
			smartAccount,
			userOp,
			owner.privateKey,
		);
		expect(receipt.success).toBe(true);

		const owners = await smartAccount.getOwners(ANVIL_RPC);
		expect(owners.map((o) => o.toLowerCase())).toEqual([
			owner.address.toLowerCase(),
		]);
	});
});
