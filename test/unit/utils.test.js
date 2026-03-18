const ak = require("../../dist/index.umd");
const { keccak256, AbiCoder, id } = require("ethers");

// Entrypoint addresses (not exported from UMD, hardcoded from source)
const ENTRYPOINT_V6 = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";
const ENTRYPOINT_V7 = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
const ENTRYPOINT_V8 = "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108";

describe("getFunctionSelector", () => {
	test("returns correct 4-byte selector for mint(address)", () => {
		const selector = ak.getFunctionSelector("mint(address)");
		expect(selector).toBe(id("mint(address)").slice(0, 10));
		expect(selector).toBe("0x6a627842");
	});

	test("returns correct selector for transfer(address,uint256)", () => {
		const selector = ak.getFunctionSelector("transfer(address,uint256)");
		expect(selector).toBe("0xa9059cbb");
	});

	test("returns correct selector for getNonce(address,uint192)", () => {
		const selector = ak.getFunctionSelector("getNonce(address,uint192)");
		expect(selector).toBe(id("getNonce(address,uint192)").slice(0, 10));
	});

	test("returns correct selector for approve(address,uint256)", () => {
		const selector = ak.getFunctionSelector("approve(address,uint256)");
		expect(selector).toBe("0x095ea7b3");
	});

	test("returns 10-char hex string (0x + 8 hex chars)", () => {
		const selector = ak.getFunctionSelector("anyFunction(uint256)");
		expect(selector).toMatch(/^0x[0-9a-f]{8}$/);
	});
});

describe("createCallData", () => {
	test("encodes function call with address parameter", () => {
		const selector = "0x6a627842"; // mint(address)
		const callData = ak.createCallData(
			selector,
			["address"],
			["0x1234567890AbcdEF1234567890aBcdef12345678"],
		);
		expect(callData).toMatch(/^0x6a627842/);
		expect(callData.length).toBe(10 + 64); // selector + 32 bytes encoded address
	});

	test("encodes function call with multiple parameters", () => {
		const selector = "0xa9059cbb"; // transfer(address,uint256)
		const callData = ak.createCallData(
			selector,
			["address", "uint256"],
			["0x1234567890AbcdEF1234567890aBcdef12345678", 1000000n],
		);
		expect(callData).toMatch(/^0xa9059cbb/);
		expect(callData.length).toBe(10 + 128); // selector + 64 bytes (2 params)
	});

	test("encodes boolean parameter correctly", () => {
		const selector = "0x12345678";
		const callData = ak.createCallData(selector, ["bool"], [true]);
		expect(callData).toMatch(/^0x12345678/);
		// last byte should be 01 for true
		expect(callData.endsWith("1")).toBe(true);
	});

	test("result starts with the function selector", () => {
		const selector = "0xdeadbeef";
		const callData = ak.createCallData(selector, ["uint256"], [42n]);
		expect(callData.slice(0, 10)).toBe(selector);
	});
});

describe("createUserOperationHash", () => {
	const baseFields = {
		sender: "0x1234567890AbcdEF1234567890aBcdef12345678",
		nonce: 1n,
		callData: "0xdeadbeef",
		callGasLimit: 100000n,
		verificationGasLimit: 200000n,
		preVerificationGas: 50000n,
		maxFeePerGas: 1000000000n,
		maxPriorityFeePerGas: 100000000n,
		signature: "0x",
	};

	const v6UserOp = {
		...baseFields,
		initCode: "0x",
		paymasterAndData: "0x",
	};

	const v7UserOp = {
		...baseFields,
		factory: null,
		factoryData: null,
		paymaster: null,
		paymasterVerificationGasLimit: null,
		paymasterPostOpGasLimit: null,
		paymasterData: null,
	};

	const v8UserOp = {
		...baseFields,
		factory: null,
		factoryData: null,
		paymaster: null,
		paymasterVerificationGasLimit: null,
		paymasterPostOpGasLimit: null,
		paymasterData: null,
		eip7702Auth: null,
	};

	test("V6 hash is a 32-byte hex string", () => {
		const hash = ak.createUserOperationHash(v6UserOp, ENTRYPOINT_V6, 1n);
		expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
	});

	test("V7 hash is a 32-byte hex string", () => {
		const hash = ak.createUserOperationHash(v7UserOp, ENTRYPOINT_V7, 1n);
		expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
	});

	test("V8 hash is a 32-byte hex string", () => {
		const hash = ak.createUserOperationHash(v8UserOp, ENTRYPOINT_V8, 1n);
		expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
	});

	test("different chain IDs produce different hashes", () => {
		const hash1 = ak.createUserOperationHash(v6UserOp, ENTRYPOINT_V6, 1n);
		const hash2 = ak.createUserOperationHash(v6UserOp, ENTRYPOINT_V6, 5n);
		expect(hash1).not.toBe(hash2);
	});

	test("different entrypoints produce different hashes for same data", () => {
		const hash1 = ak.createUserOperationHash(v7UserOp, ENTRYPOINT_V7, 1n);
		const hash2 = ak.createUserOperationHash(v8UserOp, ENTRYPOINT_V8, 1n);
		expect(hash1).not.toBe(hash2);
	});

	test("V6 hash is deterministic", () => {
		const hash1 = ak.createUserOperationHash(v6UserOp, ENTRYPOINT_V6, 1n);
		const hash2 = ak.createUserOperationHash(v6UserOp, ENTRYPOINT_V6, 1n);
		expect(hash1).toBe(hash2);
	});

	test("V8 uses EIP-712 domain separator (different from V7)", () => {
		const hashV7 = ak.createUserOperationHash(v7UserOp, ENTRYPOINT_V7, 1n);
		const hashV8 = ak.createUserOperationHash(v8UserOp, ENTRYPOINT_V8, 1n);
		expect(hashV7).not.toBe(hashV8);
	});

	test("changing sender changes the hash", () => {
		const hash1 = ak.createUserOperationHash(v6UserOp, ENTRYPOINT_V6, 1n);
		const modified = {
			...v6UserOp,
			sender: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
		};
		const hash2 = ak.createUserOperationHash(
			modified,
			ENTRYPOINT_V6,
			1n,
		);
		expect(hash1).not.toBe(hash2);
	});

	test("changing nonce changes the hash", () => {
		const hash1 = ak.createUserOperationHash(v6UserOp, ENTRYPOINT_V6, 1n);
		const modified = { ...v6UserOp, nonce: 2n };
		const hash2 = ak.createUserOperationHash(
			modified,
			ENTRYPOINT_V6,
			1n,
		);
		expect(hash1).not.toBe(hash2);
	});

	test("changing callData changes the hash", () => {
		const hash1 = ak.createUserOperationHash(v6UserOp, ENTRYPOINT_V6, 1n);
		const modified = { ...v6UserOp, callData: "0xbeefdead" };
		const hash2 = ak.createUserOperationHash(
			modified,
			ENTRYPOINT_V6,
			1n,
		);
		expect(hash1).not.toBe(hash2);
	});
});

describe("calculateUserOperationMaxGasCost", () => {
	test("V6 with paymaster: uses multiplier of 3", () => {
		const userOp = {
			sender: "0x1234567890AbcdEF1234567890aBcdef12345678",
			nonce: 0n,
			initCode: "0x",
			callData: "0x",
			callGasLimit: 100000n,
			verificationGasLimit: 200000n,
			preVerificationGas: 50000n,
			maxFeePerGas: 10n,
			maxPriorityFeePerGas: 1n,
			paymasterAndData:
				"0xAbCdEf1234567890AbCdEf1234567890AbCdEf12aabbccdd",
			signature: "0x",
		};
		const cost = ak.calculateUserOperationMaxGasCost(userOp);
		// (100000 + 200000*3 + 50000) * 10 = 7500000
		expect(cost).toBe(7500000n);
	});

	test("V6 without paymaster: uses multiplier of 0", () => {
		const userOp = {
			sender: "0x1234567890AbcdEF1234567890aBcdef12345678",
			nonce: 0n,
			initCode: "0x",
			callData: "0x",
			callGasLimit: 100000n,
			verificationGasLimit: 200000n,
			preVerificationGas: 50000n,
			maxFeePerGas: 10n,
			maxPriorityFeePerGas: 1n,
			paymasterAndData: "0x",
			signature: "0x",
		};
		const cost = ak.calculateUserOperationMaxGasCost(userOp);
		// (100000 + 200000*0 + 50000) * 10 = 1500000
		expect(cost).toBe(1500000n);
	});

	test("V7: sums all gas limits", () => {
		const userOp = {
			sender: "0x1234567890AbcdEF1234567890aBcdef12345678",
			nonce: 0n,
			factory: null,
			factoryData: null,
			callData: "0x",
			callGasLimit: 100000n,
			verificationGasLimit: 200000n,
			preVerificationGas: 50000n,
			maxFeePerGas: 10n,
			maxPriorityFeePerGas: 1n,
			paymaster: null,
			paymasterVerificationGasLimit: 60000n,
			paymasterPostOpGasLimit: 40000n,
			paymasterData: null,
			signature: "0x",
		};
		const cost = ak.calculateUserOperationMaxGasCost(userOp);
		// (200000 + 100000 + 60000 + 40000 + 50000) * 10 = 4500000
		expect(cost).toBe(4500000n);
	});

	test("V7: handles null paymaster gas limits", () => {
		const userOp = {
			sender: "0x1234567890AbcdEF1234567890aBcdef12345678",
			nonce: 0n,
			factory: null,
			factoryData: null,
			callData: "0x",
			callGasLimit: 100000n,
			verificationGasLimit: 200000n,
			preVerificationGas: 50000n,
			maxFeePerGas: 10n,
			maxPriorityFeePerGas: 1n,
			paymaster: null,
			paymasterVerificationGasLimit: null,
			paymasterPostOpGasLimit: null,
			paymasterData: null,
			signature: "0x",
		};
		const cost = ak.calculateUserOperationMaxGasCost(userOp);
		// (200000 + 100000 + 0 + 0 + 50000) * 10 = 3500000
		expect(cost).toBe(3500000n);
	});

	test("returns zero when maxFeePerGas is zero", () => {
		const userOp = {
			sender: "0x1234567890AbcdEF1234567890aBcdef12345678",
			nonce: 0n,
			initCode: "0x",
			callData: "0x",
			callGasLimit: 100000n,
			verificationGasLimit: 200000n,
			preVerificationGas: 50000n,
			maxFeePerGas: 0n,
			maxPriorityFeePerGas: 0n,
			paymasterAndData: "0x",
			signature: "0x",
		};
		const cost = ak.calculateUserOperationMaxGasCost(userOp);
		expect(cost).toBe(0n);
	});
});
