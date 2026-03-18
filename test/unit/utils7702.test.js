const ak = require("../../dist/index.umd");
const { Wallet, keccak256, encodeRlp, getBytes, toBeArray } = require("ethers");

// Deterministic test key (DO NOT use in production)
const TEST_PRIVATE_KEY =
	"0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

describe("createEip7702DelegationAuthorizationHash", () => {
	test("produces 32-byte hex hash", () => {
		const hash = ak.createEip7702DelegationAuthorizationHash(
			1n,
			"0x1234567890AbcdEF1234567890aBcdef12345678",
			0n,
		);
		expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
	});

	test("uses MAGIC prefix 0x05", () => {
		const chainId = 1n;
		const address = "0x1234567890AbcdEF1234567890aBcdef12345678";
		const nonce = 0n;

		const rlpEncoded = encodeRlp([
			getBytes(toBeArray(chainId)),
			address,
			getBytes(toBeArray(nonce)),
		]);
		const expected = keccak256("0x05" + rlpEncoded.slice(2));
		const actual = ak.createEip7702DelegationAuthorizationHash(
			chainId,
			address,
			nonce,
		);
		expect(actual).toBe(expected);
	});

	test("different chain IDs produce different hashes", () => {
		const address = "0x1234567890AbcdEF1234567890aBcdef12345678";
		const hash1 = ak.createEip7702DelegationAuthorizationHash(
			1n,
			address,
			0n,
		);
		const hash2 = ak.createEip7702DelegationAuthorizationHash(
			5n,
			address,
			0n,
		);
		expect(hash1).not.toBe(hash2);
	});

	test("different nonces produce different hashes", () => {
		const address = "0x1234567890AbcdEF1234567890aBcdef12345678";
		const hash1 = ak.createEip7702DelegationAuthorizationHash(
			1n,
			address,
			0n,
		);
		const hash2 = ak.createEip7702DelegationAuthorizationHash(
			1n,
			address,
			1n,
		);
		expect(hash1).not.toBe(hash2);
	});

	test("is deterministic", () => {
		const hash1 = ak.createEip7702DelegationAuthorizationHash(
			1n,
			"0x1234567890AbcdEF1234567890aBcdef12345678",
			5n,
		);
		const hash2 = ak.createEip7702DelegationAuthorizationHash(
			1n,
			"0x1234567890AbcdEF1234567890aBcdef12345678",
			5n,
		);
		expect(hash1).toBe(hash2);
	});
});

describe("signHash", () => {
	test("returns yParity, r, and s", () => {
		const hash = keccak256("0xdeadbeef");
		const sig = ak.signHash(hash, TEST_PRIVATE_KEY);
		expect(sig).toHaveProperty("yParity");
		expect(sig).toHaveProperty("r");
		expect(sig).toHaveProperty("s");
	});

	test("yParity is 0 or 1", () => {
		const hash = keccak256("0xdeadbeef");
		const sig = ak.signHash(hash, TEST_PRIVATE_KEY);
		expect([0, 1]).toContain(sig.yParity);
	});

	test("r and s are bigints", () => {
		const hash = keccak256("0xdeadbeef");
		const sig = ak.signHash(hash, TEST_PRIVATE_KEY);
		expect(typeof sig.r).toBe("bigint");
		expect(typeof sig.s).toBe("bigint");
	});

	test("r and s are positive and non-zero", () => {
		const hash = keccak256("0xdeadbeef");
		const sig = ak.signHash(hash, TEST_PRIVATE_KEY);
		expect(sig.r).toBeGreaterThan(0n);
		expect(sig.s).toBeGreaterThan(0n);
	});

	test("is deterministic for the same hash and key", () => {
		const hash = keccak256("0xdeadbeef");
		const sig1 = ak.signHash(hash, TEST_PRIVATE_KEY);
		const sig2 = ak.signHash(hash, TEST_PRIVATE_KEY);
		expect(sig1.r).toBe(sig2.r);
		expect(sig1.s).toBe(sig2.s);
		expect(sig1.yParity).toBe(sig2.yParity);
	});

	test("different hashes produce different signatures", () => {
		const sig1 = ak.signHash(keccak256("0xaa"), TEST_PRIVATE_KEY);
		const sig2 = ak.signHash(keccak256("0xbb"), TEST_PRIVATE_KEY);
		expect(sig1.r === sig2.r && sig1.s === sig2.s).toBe(false);
	});
});

describe("createAndSignEip7702DelegationAuthorization", () => {
	test("returns hex-encoded authorization fields", () => {
		const auth = ak.createAndSignEip7702DelegationAuthorization(
			1n,
			"0x1234567890AbcdEF1234567890aBcdef12345678",
			0n,
			TEST_PRIVATE_KEY,
		);
		expect(auth.chainId).toMatch(/^0x/);
		expect(auth.address).toBe(
			"0x1234567890AbcdEF1234567890aBcdef12345678",
		);
		expect(auth.nonce).toMatch(/^0x/);
		expect(auth.yParity).toMatch(/^0x/);
		expect(auth.r).toMatch(/^0x/);
		expect(auth.s).toMatch(/^0x/);
	});

	test("chainId and nonce are correctly hex-encoded", () => {
		const auth = ak.createAndSignEip7702DelegationAuthorization(
			11155111n,
			"0x1234567890AbcdEF1234567890aBcdef12345678",
			42n,
			TEST_PRIVATE_KEY,
		);
		expect(BigInt(auth.chainId)).toBe(11155111n);
		expect(BigInt(auth.nonce)).toBe(42n);
	});

	test("is deterministic", () => {
		const auth1 = ak.createAndSignEip7702DelegationAuthorization(
			1n,
			"0x1234567890AbcdEF1234567890aBcdef12345678",
			0n,
			TEST_PRIVATE_KEY,
		);
		const auth2 = ak.createAndSignEip7702DelegationAuthorization(
			1n,
			"0x1234567890AbcdEF1234567890aBcdef12345678",
			0n,
			TEST_PRIVATE_KEY,
		);
		expect(auth1).toEqual(auth2);
	});
});

describe("createEip7702TransactionHash", () => {
	test("produces 32-byte hex hash", () => {
		const hash = ak.createEip7702TransactionHash(
			1n,
			0n,
			100000000n,
			200000000n,
			21000n,
			"0x1234567890AbcdEF1234567890aBcdef12345678",
			0n,
			"0x",
			[],
			[],
		);
		expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
	});

	test("different chain IDs produce different hashes", () => {
		const args = [
			0n,
			100000000n,
			200000000n,
			21000n,
			"0x1234567890AbcdEF1234567890aBcdef12345678",
			0n,
			"0x",
			[],
			[],
		];
		const hash1 = ak.createEip7702TransactionHash(1n, ...args);
		const hash2 = ak.createEip7702TransactionHash(5n, ...args);
		expect(hash1).not.toBe(hash2);
	});

	test("is deterministic", () => {
		const args = [
			1n,
			0n,
			100000000n,
			200000000n,
			21000n,
			"0x1234567890AbcdEF1234567890aBcdef12345678",
			0n,
			"0x",
			[],
			[],
		];
		const hash1 = ak.createEip7702TransactionHash(...args);
		const hash2 = ak.createEip7702TransactionHash(...args);
		expect(hash1).toBe(hash2);
	});
});

describe("createAndSignEip7702RawTransaction", () => {
	test("returns 0x04-prefixed transaction", () => {
		const tx = ak.createAndSignEip7702RawTransaction(
			1n,
			0n,
			100000000n,
			200000000n,
			21000n,
			"0x1234567890AbcdEF1234567890aBcdef12345678",
			0n,
			"0x",
			[],
			[],
			TEST_PRIVATE_KEY,
		);
		expect(tx).toMatch(/^0x04/);
	});

	test("validates destination length", () => {
		expect(() =>
			ak.createAndSignEip7702RawTransaction(
				1n,
				0n,
				100000000n,
				200000000n,
				21000n,
				"0x1234",
				0n,
				"0x",
				[],
				[],
				TEST_PRIVATE_KEY,
			),
		).toThrow(RangeError);
	});

	test("validates chainId range", () => {
		expect(() =>
			ak.createAndSignEip7702RawTransaction(
				BigInt(2 ** 64),
				0n,
				100000000n,
				200000000n,
				21000n,
				"0x1234567890AbcdEF1234567890aBcdef12345678",
				0n,
				"0x",
				[],
				[],
				TEST_PRIVATE_KEY,
			),
		).toThrow(RangeError);
	});

	test("validates nonce range", () => {
		expect(() =>
			ak.createAndSignEip7702RawTransaction(
				1n,
				BigInt(2 ** 64),
				100000000n,
				200000000n,
				21000n,
				"0x1234567890AbcdEF1234567890aBcdef12345678",
				0n,
				"0x",
				[],
				[],
				TEST_PRIVATE_KEY,
			),
		).toThrow(RangeError);
	});

	test("includes authorization list in transaction", () => {
		const auth = {
			chainId: 1n,
			address: "0xAbCdEf1234567890AbCdEf1234567890AbCdEf12",
			nonce: 0n,
			yParity: 0,
			r: 1n,
			s: 2n,
		};
		const tx = ak.createAndSignEip7702RawTransaction(
			1n,
			0n,
			100000000n,
			200000000n,
			100000n,
			"0x1234567890AbcdEF1234567890aBcdef12345678",
			0n,
			"0x",
			[],
			[auth],
			TEST_PRIVATE_KEY,
		);
		const txNoAuth = ak.createAndSignEip7702RawTransaction(
			1n,
			0n,
			100000000n,
			200000000n,
			100000n,
			"0x1234567890AbcdEF1234567890aBcdef12345678",
			0n,
			"0x",
			[],
			[],
			TEST_PRIVATE_KEY,
		);
		expect(tx.length).toBeGreaterThan(txNoAuth.length);
	});
});

describe("createAndSignLegacyRawTransaction", () => {
	test("returns RLP-encoded transaction", () => {
		const tx = ak.createAndSignLegacyRawTransaction(
			1n,
			0n,
			20000000000n,
			21000n,
			"0x1234567890AbcdEF1234567890aBcdef12345678",
			0n,
			"0x",
			TEST_PRIVATE_KEY,
		);
		expect(tx).toMatch(/^0x/);
	});

	test("validates destination length", () => {
		expect(() =>
			ak.createAndSignLegacyRawTransaction(
				1n,
				0n,
				20000000000n,
				21000n,
				"0x1234",
				0n,
				"0x",
				TEST_PRIVATE_KEY,
			),
		).toThrow(RangeError);
	});

	test("validates chainId range", () => {
		expect(() =>
			ak.createAndSignLegacyRawTransaction(
				BigInt(2 ** 64),
				0n,
				20000000000n,
				21000n,
				"0x1234567890AbcdEF1234567890aBcdef12345678",
				0n,
				"0x",
				TEST_PRIVATE_KEY,
			),
		).toThrow(RangeError);
	});

	test("validates nonce range", () => {
		expect(() =>
			ak.createAndSignLegacyRawTransaction(
				1n,
				BigInt(2 ** 64),
				20000000000n,
				21000n,
				"0x1234567890AbcdEF1234567890aBcdef12345678",
				0n,
				"0x",
				TEST_PRIVATE_KEY,
			),
		).toThrow(RangeError);
	});
});
