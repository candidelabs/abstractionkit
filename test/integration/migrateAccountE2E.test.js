const ak = require("../../dist/index.umd");
const { Wallet, JsonRpcProvider } = require("ethers");
const {
	ANVIL_RPC,
	ANVIL_CHAIN_ID,
	ANVIL_ACCOUNTS,
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
			"Voltaire bundler not reachable — skipping migration e2e tests",
		);
	}
});

// Use account[8] for migration tests to avoid nonce conflicts
const funder = ANVIL_ACCOUNTS[8];

async function fundAccount(toAddress, amountWei) {
	const provider = new JsonRpcProvider(ANVIL_RPC);
	const wallet = new Wallet(funder.privateKey, provider);
	const tx = await wallet.sendTransaction({
		to: toAddress,
		value: amountWei,
	});
	await tx.wait();
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

describe("Safe account migration e2e", () => {
	test("migrate account from entrypoint v0.06 to entrypoint v0.07", async () => {
		

		// Create a random signer for isolation
		const randomSigner = Wallet.createRandom();

		const accountToMigrate =
			ak.SafeAccountV0_2_0.initializeNewAccount([
				randomSigner.address,
			]);

		// Fund the account
		await fundAccount(
			accountToMigrate.accountAddress,
			5000000000000000000n, // 5 ETH
		);

		// Deploy the account with a no-op UserOp
		const testMetaTransaction = {
			to: accountToMigrate.accountAddress,
			value: 0n,
			data: "0x",
		};

		let deployUserOp = await accountToMigrate.createUserOperation(
			[testMetaTransaction],
			ANVIL_RPC,
			BUNDLER_RPC,
			{
				// Safe V0_2_0 deployment on Sepolia fork needs extra verification gas
				verificationGasLimitPercentageMultiplier: 200,
			},
		);

		let receipt = await sendSignedUserOp(
			accountToMigrate,
			deployUserOp,
			randomSigner.privateKey,
		);
		expect(receipt.success).toBe(true);

		// Verify account is deployed
		const code = await ak.sendJsonRpcRequest(
			ANVIL_RPC,
			"eth_getCode",
			[accountToMigrate.accountAddress, "latest"],
		);
		expect(code).not.toBe("0x");

		// Create the migration meta-transactions
		const migrateMetaTransactions =
			await accountToMigrate.createMigrateToSafeAccountV0_3_0MetaTransactions(
				ANVIL_RPC,
			);

		let migrateUserOp = await accountToMigrate.createUserOperation(
			migrateMetaTransactions,
			ANVIL_RPC,
			BUNDLER_RPC,
		);

		receipt = await sendSignedUserOp(
			accountToMigrate,
			migrateUserOp,
			randomSigner.privateKey,
		);
		expect(receipt.success).toBe(true);

		// Should fail after migration if still using SafeAccountV0_2_0
		await expect(
			accountToMigrate.createUserOperation(
				[testMetaTransaction],
				ANVIL_RPC,
				BUNDLER_RPC,
			),
		).rejects.toThrow();

		// Should work after migration using SafeAccountV0_3_0
		const migratedAccount = new ak.SafeAccountV0_3_0(
			accountToMigrate.accountAddress,
		);

		let afterMigrationUserOp =
			await migratedAccount.createUserOperation(
				[testMetaTransaction],
				ANVIL_RPC,
				BUNDLER_RPC,
			);

		receipt = await sendSignedUserOp(
			migratedAccount,
			afterMigrationUserOp,
			randomSigner.privateKey,
		);
		expect(receipt.success).toBe(true);
	});
});
