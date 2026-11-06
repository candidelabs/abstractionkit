// Unit tests for issue #128: the legacy transaction v field was computed
// with Number(chainId), losing precision for chain IDs above 2^53 and
// producing an unrecoverable signature. Verified independently by parsing
// the raw transaction with ethers and checking the recovered sender.

const ak = require("../dist/index.cjs");
const { Transaction, Wallet, keccak256, toUtf8Bytes, recoverAddress, toBeHex } = require("ethers");

const DESTINATION = "0x1111111111111111111111111111111111111111";

function signAndParse(chainId) {
	const wallet = Wallet.createRandom();
	const raw = ak.createAndSignLegacyRawTransaction(
		chainId,
		1n, // nonce
		1000000000n, // gas price
		21000n, // gas limit
		DESTINATION,
		0n, // value
		"0x",
		wallet.privateKey,
	);
	return { wallet, tx: Transaction.from(raw) };
}

describe("createAndSignLegacyRawTransaction v computation (#128)", () => {
	test("chainId above 2^53 keeps exact EIP-155 v and recovers the sender", () => {
		const chainId = 4337433743374337433n; // > 2^53, not float-representable
		const { wallet, tx } = signAndParse(chainId);
		expect(tx.chainId).toBe(chainId);
		expect(tx.from.toLowerCase()).toBe(wallet.address.toLowerCase());
	});

	test("small chainId still signs and recovers correctly", () => {
		const chainId = 11155111n; // Sepolia
		const { wallet, tx } = signAndParse(chainId);
		expect(tx.chainId).toBe(chainId);
		expect(tx.from.toLowerCase()).toBe(wallet.address.toLowerCase());
	});
});

describe("createAndSignLegacyRawTransaction canonical RLP r/s", () => {
	// These keys deterministically (RFC 6979) produce a signature whose r or s
	// has a leading zero byte for this payload; the raw tx must still encode
	// r/s as minimal integers or nodes reject it as non-canonical RLP.
	test.each([38, 63])(
		"key %i with a leading-zero r/s component encodes minimally and recovers",
		(i) => {
			const { decodeRlp, getBytes } = require("ethers");
			const pk = "0x" + i.toString(16).padStart(64, "0");
			const raw = ak.createAndSignLegacyRawTransaction(
				1n,
				0n,
				1000000000n,
				21000n,
				"0x" + "aa".repeat(20),
				0n,
				"0x",
				pk,
			);
			const fields = decodeRlp(raw);
			const r = getBytes(fields[7]);
			const s = getBytes(fields[8]);
			expect(r.length === 0 || r[0] !== 0).toBe(true);
			expect(s.length === 0 || s[0] !== 0).toBe(true);
			const tx = Transaction.from(raw);
			expect(tx.from.toLowerCase()).toBe(new Wallet(pk).address.toLowerCase());
		},
	);
});

describe("createAndSignEip7702DelegationAuthorization low-s normalization", () => {
	const N = BigInt(
		"0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141",
	);

	test("normalizes a high-s callback signature to the low-s complement", async () => {
		const { SigningKey } = require("ethers");
		const wallet = new Wallet("0x" + "11".repeat(32));
		const chainId = 1n;
		const delegatee = "0x" + "aa".repeat(20);
		const nonce = 0n;

		const authHash = ak.createEip7702DelegationAuthorizationHash(chainId, delegatee, nonce);
		const lowSig = wallet.signingKey.sign(authHash); // ethers always low-s
		// construct the complementary high-s signature with flipped parity
		const highS = N - BigInt(lowSig.s);
		const highV = lowSig.yParity === 0 ? 28 : 27;
		const highSig =
			"0x" +
			lowSig.r.slice(2) +
			highS.toString(16).padStart(64, "0") +
			highV.toString(16).padStart(2, "0");

		const auth = await ak.createAndSignEip7702DelegationAuthorization(
			chainId,
			delegatee,
			nonce,
			async () => highSig,
		);
		// must come back as the original low-s signature
		expect(BigInt(auth.s)).toBe(BigInt(lowSig.s));
		expect(Number(BigInt(auth.yParity))).toBe(lowSig.yParity);
		expect(BigInt(auth.s) <= N / 2n).toBe(true);
	});
});

describe("signHash", () => {
	// secp256k1 group order; a canonical (low-s) signature has s <= N / 2.
	const HALF_N = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n;

	test("signs an arbitrary 32-byte hash so the key's address is recovered", () => {
		const wallet = Wallet.createRandom();
		const hash = keccak256(toUtf8Bytes("abstractionkit signHash"));
		const { yParity, r, s } = ak.signHash(hash, wallet.privateKey);

		expect([0, 1]).toContain(yParity);
		expect(typeof r).toBe("bigint");
		expect(typeof s).toBe("bigint");
		expect(s).toBeLessThanOrEqual(HALF_N);

		const recovered = recoverAddress(hash, { r: toBeHex(r, 32), s: toBeHex(s, 32), yParity });
		expect(recovered.toLowerCase()).toBe(wallet.address.toLowerCase());
	});

	test("different keys give different signatures over the same hash", () => {
		const hash = keccak256(toUtf8Bytes("same hash"));
		const a = ak.signHash(hash, Wallet.createRandom().privateKey);
		const b = ak.signHash(hash, Wallet.createRandom().privateKey);
		expect(a.r === b.r && a.s === b.s).toBe(false);
	});
});

// A malformed private key used to be echoed into the error message by every
// helper that signs through signHash: 14 nibbles of an odd-length hex key, or
// the whole of a short non-hex secret. privateKeyToAddress already redacted.
describe("a malformed private key is not echoed into the error", () => {
	const ak = require("../dist/index.cjs");
	const HASH = "0x" + "ab".repeat(32);
	const ADDRESS = "0x" + "11".repeat(20);
	const ODD_LENGTH_KEY = "0x" + "123456789abcdef".repeat(4) + "654"; // 63 nibbles
	const NOT_HEX = "my secret seed phrase words go here ok";
	const OP = {
		sender: ADDRESS,
		nonce: 0n,
		factory: null,
		factoryData: null,
		callData: "0x",
		callGasLimit: 1n,
		verificationGasLimit: 1n,
		preVerificationGas: 1n,
		maxFeePerGas: 1n,
		maxPriorityFeePerGas: 1n,
		paymaster: null,
		paymasterVerificationGasLimit: null,
		paymasterPostOpGasLimit: null,
		paymasterData: null,
		signature: "0x",
		eip7702Auth: null,
	};

	const SIGNERS = [
		["signHash", (key) => ak.signHash(HASH, key)],
		["createAndSignEip7702DelegationAuthorization", (key) =>
			ak.createAndSignEip7702DelegationAuthorization(1n, ADDRESS, 0n, key)],
		["createAndSignLegacyRawTransaction", (key) =>
			ak.createAndSignLegacyRawTransaction(1n, 0n, 1n, 21000n, ADDRESS, 0n, "0x", key)],
		["createAndSignEip7702RawTransaction", (key) =>
			ak.createAndSignEip7702RawTransaction(1n, 0n, 1n, 1n, 100000n, ADDRESS, 0n, "0x", [], [], key)],
		["Simple7702Account.signUserOperation", (key) => new ak.Simple7702Account(ADDRESS).signUserOperation(OP, key, 1n)],
		["Calibur7702Account.signUserOperation", (key) => new ak.Calibur7702Account(ADDRESS).signUserOperation(OP, key, 1n)],
	];

	test.each(SIGNERS)("%s", (_name, sign) => {
		for (const key of [ODD_LENGTH_KEY, NOT_HEX]) {
			let message;
			try {
				sign(key);
			} catch (error) {
				message = error.message;
			}
			expect(message).toBeDefined();
			expect(message).toContain("[REDACTED]");
			// neither the start nor the end of the secret, nor the phrase
			expect(message).not.toContain(key.replace("0x", "").slice(0, 8));
			expect(message).not.toContain(key.slice(-6));
			expect(message).not.toContain("seed phrase");
		}
	});
});
