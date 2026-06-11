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
