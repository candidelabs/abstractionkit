// Unit tests for the per-signer ~55k verificationGasLimit compensation in
// SafeAccount.baseEstimateUserOperationGas (issue #152). Uses a mock
// Transport so no network is required.

const ak = require("../../dist/index.cjs");

const BUNDLER_VGL = 100000n;
const PER_SIGNER = 55000n;

function mockBundlerTransport() {
	return {
		request: async ({ method }) => {
			if (method === "eth_estimateUserOperationGas") {
				return {
					callGasLimit: "0x100",
					preVerificationGas: "0x200",
					verificationGasLimit: "0x186a0", // 100000
				};
			}
			throw new Error(`unexpected method ${method}`);
		},
	};
}

function makeUserOpV7(signature = "0x") {
	return {
		sender: "0x1111111111111111111111111111111111111111",
		nonce: 0n,
		factory: null,
		factoryData: null,
		callData: "0x",
		callGasLimit: 0n,
		verificationGasLimit: 0n,
		preVerificationGas: 0n,
		maxFeePerGas: 5n,
		maxPriorityFeePerGas: 1n,
		paymaster: null,
		paymasterVerificationGasLimit: null,
		paymasterPostOpGasLimit: null,
		paymasterData: null,
		signature,
	};
}

const OWNER_A = "0x2222222222222222222222222222222222222222";
const OWNER_B = "0x3333333333333333333333333333333333333333";

describe("SafeAccount.baseEstimateUserOperationGas per-signer compensation", () => {
	const account = new ak.SafeAccountV0_3_0("0x1111111111111111111111111111111111111111");

	test("expectedSigners: adds 55k per expected signer", async () => {
		const [, verificationGasLimit] = await account.baseEstimateUserOperationGas(
			makeUserOpV7(),
			mockBundlerTransport(),
			{ expectedSigners: [OWNER_A, OWNER_B] },
		);
		expect(verificationGasLimit).toBe(BUNDLER_VGL + 2n * PER_SIGNER);
	});

	test("default single-EOA dummy: adds 55k once", async () => {
		const [, verificationGasLimit] = await account.baseEstimateUserOperationGas(
			makeUserOpV7(),
			mockBundlerTransport(),
		);
		expect(verificationGasLimit).toBe(BUNDLER_VGL + PER_SIGNER);
	});

	test("explicit dummySignerSignaturePairs: adds 55k per pair", async () => {
		const [, verificationGasLimit] = await account.baseEstimateUserOperationGas(
			makeUserOpV7(),
			mockBundlerTransport(),
			{
				dummySignerSignaturePairs: [
					ak.EOADummySignerSignaturePair,
					ak.EOADummySignerSignaturePair,
				],
			},
		);
		expect(verificationGasLimit).toBe(BUNDLER_VGL + 2n * PER_SIGNER);
	});

	test("caller-supplied signature: returns the raw bundler estimate", async () => {
		const presetSignature = `0x${"ab".repeat(140)}`;
		const [, verificationGasLimit] = await account.baseEstimateUserOperationGas(
			makeUserOpV7(presetSignature),
			mockBundlerTransport(),
		);
		expect(verificationGasLimit).toBe(BUNDLER_VGL);
	});
});
