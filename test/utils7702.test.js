// Unit tests for issue #128: the legacy transaction v field was computed
// with Number(chainId), losing precision for chain IDs above 2^53 and
// producing an unrecoverable signature. Verified independently by parsing
// the raw transaction with ethers and checking the recovered sender.

const ak = require("../dist/index.cjs");
const { Transaction, Wallet } = require("ethers");

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
