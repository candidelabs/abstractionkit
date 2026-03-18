const ak = require("../../dist/index.umd");
const { hashMessage } = require("ethers");

describe("getSafeMessageEip712Data", () => {
	const accountAddress = "0x1234567890AbcdEF1234567890aBcdef12345678";
	const chainId = 1n;
	const message = "Hello, World!";

	test("returns domain, types, and messageValue", () => {
		const result = ak.getSafeMessageEip712Data(
			accountAddress,
			chainId,
			message,
		);
		expect(result).toHaveProperty("domain");
		expect(result).toHaveProperty("types");
		expect(result).toHaveProperty("messageValue");
	});

	test("domain has correct chainId", () => {
		const result = ak.getSafeMessageEip712Data(
			accountAddress,
			chainId,
			message,
		);
		expect(result.domain.chainId).toBe(1);
	});

	test("domain has correct verifyingContract", () => {
		const result = ak.getSafeMessageEip712Data(
			accountAddress,
			chainId,
			message,
		);
		expect(result.domain.verifyingContract).toBe(accountAddress);
	});

	test("types has SafeMessage with bytes message field", () => {
		const result = ak.getSafeMessageEip712Data(
			accountAddress,
			chainId,
			message,
		);
		expect(result.types).toEqual({
			SafeMessage: [{ type: "bytes", name: "message" }],
		});
	});

	test("messageValue.message is hashMessage of input", () => {
		const result = ak.getSafeMessageEip712Data(
			accountAddress,
			chainId,
			message,
		);
		expect(result.messageValue.message).toBe(hashMessage(message));
	});

	test("different messages produce different messageValue", () => {
		const result1 = ak.getSafeMessageEip712Data(
			accountAddress,
			chainId,
			"message1",
		);
		const result2 = ak.getSafeMessageEip712Data(
			accountAddress,
			chainId,
			"message2",
		);
		expect(result1.messageValue.message).not.toBe(
			result2.messageValue.message,
		);
	});

	test("converts bigint chainId to number", () => {
		const result = ak.getSafeMessageEip712Data(
			accountAddress,
			11155111n,
			message,
		);
		expect(result.domain.chainId).toBe(11155111);
		expect(typeof result.domain.chainId).toBe("number");
	});
});
