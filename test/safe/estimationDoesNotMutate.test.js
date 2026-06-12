// Unit tests for issue #132: baseEstimateUserOperationGas must not mutate
// the caller's UserOperation (signature, maxFeePerGas, maxPriorityFeePerGas),
// and must not leave it corrupted (zeroed fees, dummy signature) when the
// bundler estimation throws. Covers Simple7702Account and SafeAccount.
// Uses mock Transports so no network is required.

const ak = require("../../dist/index.cjs");

function mockEstimatingTransport() {
	return {
		request: async () => ({
			callGasLimit: "0x100",
			preVerificationGas: "0x200",
			verificationGasLimit: "0x300",
		}),
	};
}

function mockThrowingTransport() {
	return {
		request: async () => {
			const err = new Error("estimation reverted");
			err.code = -32500;
			err.name = "TransportRpcError";
			throw err;
		},
	};
}

const SENDER = "0x1111111111111111111111111111111111111111";

function makeUserOpV7() {
	return {
		sender: SENDER,
		nonce: 0n,
		factory: null,
		factoryData: null,
		callData: "0x",
		callGasLimit: 0n,
		verificationGasLimit: 0n,
		preVerificationGas: 0n,
		maxFeePerGas: 123n,
		maxPriorityFeePerGas: 45n,
		paymaster: null,
		paymasterVerificationGasLimit: null,
		paymasterPostOpGasLimit: null,
		paymasterData: null,
		signature: "0x",
	};
}

function makeUserOpV8() {
	return { ...makeUserOpV7(), eip7702Auth: null };
}

describe("Simple7702Account estimation does not mutate the caller's op (#132)", () => {
	const account = new ak.Simple7702Account(SENDER);

	test("success path: signature and fees are untouched", async () => {
		const userOp = makeUserOpV8();
		const snapshot = { ...userOp };
		await account.estimateUserOperationGas(userOp, mockEstimatingTransport());
		expect(userOp).toEqual(snapshot);
	});

	test("throw path: op is not left with zeroed fees and a dummy signature", async () => {
		const userOp = makeUserOpV8();
		const snapshot = { ...userOp };
		await expect(
			account.estimateUserOperationGas(userOp, mockThrowingTransport()),
		).rejects.toThrow();
		expect(userOp).toEqual(snapshot);
	});
});

describe("SafeAccount estimation does not mutate the caller's op (#132)", () => {
	const account = new ak.SafeAccountV0_3_0(SENDER);

	test("success path: signature and fees are untouched", async () => {
		const userOp = makeUserOpV7();
		const snapshot = { ...userOp };
		await account.estimateUserOperationGas(userOp, mockEstimatingTransport());
		expect(userOp).toEqual(snapshot);
	});

	test("throw path: op is not left with zeroed fees and a dummy signature", async () => {
		const userOp = makeUserOpV7();
		const snapshot = { ...userOp };
		await expect(
			account.estimateUserOperationGas(userOp, mockThrowingTransport()),
		).rejects.toThrow();
		expect(userOp).toEqual(snapshot);
	});
});
