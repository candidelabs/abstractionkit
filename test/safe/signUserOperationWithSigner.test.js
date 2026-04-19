const { SafeAccountV0_3_0, SafeAccountV0_2_0 } = require('../../dist/index.cjs');
const { Wallet } = require('ethers');

jest.setTimeout(30000);

// Well-known test key — never used on mainnet.
const TEST_PRIVATE_KEY =
	'0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const TEST_WALLET = new Wallet(TEST_PRIVATE_KEY);
const CHAIN_ID = 11155111n; // Sepolia

function v7UserOp(overrides = {}) {
	return {
		sender: '0x' + '1'.repeat(40),
		nonce: 0n,
		callData: '0xdeadbeef',
		callGasLimit: 10000n,
		verificationGasLimit: 20000n,
		preVerificationGas: 30000n,
		maxFeePerGas: 1_000_000_000n,
		maxPriorityFeePerGas: 100_000_000n,
		signature: '0x',
		factory: null,
		factoryData: null,
		paymaster: null,
		paymasterVerificationGasLimit: null,
		paymasterPostOpGasLimit: null,
		paymasterData: null,
		...overrides,
	};
}

function v6UserOp(overrides = {}) {
	return {
		sender: '0x' + '1'.repeat(40),
		nonce: 0n,
		callData: '0xdeadbeef',
		callGasLimit: 10000n,
		verificationGasLimit: 20000n,
		preVerificationGas: 30000n,
		maxFeePerGas: 1_000_000_000n,
		maxPriorityFeePerGas: 100_000_000n,
		signature: '0x',
		initCode: '0x',
		paymasterAndData: '0x',
		...overrides,
	};
}

describe('SafeAccountV0_3_0.signUserOperationWithSigner', () => {
	test('produces same signature as signUserOperation with matching key', async () => {
		const account = SafeAccountV0_3_0.initializeNewAccount([
			TEST_WALLET.address,
		]);
		const userOp = v7UserOp();

		// Sign with the existing string-key method.
		const expected = account.signUserOperation(
			userOp,
			[TEST_PRIVATE_KEY],
			CHAIN_ID,
		);

		// Sign with the new callback method.
		// The callback receives the EIP-712 hash and returns an ECDSA signature.
		const actual = await account.signUserOperationWithSigner(
			userOp,
			async (hash) => {
				return TEST_WALLET.signingKey.sign(hash).serialized;
			},
			CHAIN_ID,
		);

		expect(actual).toBe(expected);
	});

	test('works with validAfter and validUntil overrides', async () => {
		const account = SafeAccountV0_3_0.initializeNewAccount([
			TEST_WALLET.address,
		]);
		const userOp = v7UserOp();
		const overrides = { validAfter: 1000n, validUntil: 2000n };

		const expected = account.signUserOperation(
			userOp,
			[TEST_PRIVATE_KEY],
			CHAIN_ID,
			overrides,
		);

		const actual = await account.signUserOperationWithSigner(
			userOp,
			async (hash) => TEST_WALLET.signingKey.sign(hash).serialized,
			CHAIN_ID,
			overrides,
		);

		expect(actual).toBe(expected);
	});

	test('works with an already-deployed account (no factory)', async () => {
		const account = new SafeAccountV0_3_0(
			'0xA3B60390b4F0223714bbAB69226AC7A81B3f111C',
		);
		const userOp = v7UserOp();

		const actual = await account.signUserOperationWithSigner(
			userOp,
			async (hash) => TEST_WALLET.signingKey.sign(hash).serialized,
			CHAIN_ID,
		);

		// Signature should be a valid hex string with the Safe 4337 format:
		// uint48 validAfter + uint48 validUntil + 65-byte ECDSA signature
		expect(actual).toMatch(/^0x[0-9a-f]+$/i);
		// 12 bytes (validAfter + validUntil) + 65 bytes (signature) = 77 bytes
		// = 154 hex chars + 2 for '0x' prefix
		expect(actual.length).toBe(2 + 154);
	});

	test('signer receives the EIP-712 hash, not the raw UserOp hash', async () => {
		const account = SafeAccountV0_3_0.initializeNewAccount([
			TEST_WALLET.address,
		]);
		const userOp = v7UserOp();

		let receivedHash = null;
		await account.signUserOperationWithSigner(
			userOp,
			async (hash) => {
				receivedHash = hash;
				return TEST_WALLET.signingKey.sign(hash).serialized;
			},
			CHAIN_ID,
		);

		// The hash should be the Safe EIP-712 hash, not the EntryPoint userOp hash.
		const expectedHash = SafeAccountV0_3_0.getUserOperationEip712Hash(
			userOp,
			CHAIN_ID,
		);
		expect(receivedHash).toBe(expectedHash);
	});
});

describe('SafeAccountV0_2_0.signUserOperationWithSigner', () => {
	test('produces same signature as signUserOperation with matching key', async () => {
		const account = SafeAccountV0_2_0.initializeNewAccount([
			TEST_WALLET.address,
		]);
		const userOp = v6UserOp();

		const expected = account.signUserOperation(
			userOp,
			[TEST_PRIVATE_KEY],
			CHAIN_ID,
		);

		const actual = await account.signUserOperationWithSigner(
			userOp,
			async (hash) => TEST_WALLET.signingKey.sign(hash).serialized,
			CHAIN_ID,
		);

		expect(actual).toBe(expected);
	});
});
