const ak = require("../../dist/index.umd");

describe("ZeroAddress", () => {
	test("is 42-char hex address of all zeros", () => {
		expect(ak.ZeroAddress).toBe(
			"0x0000000000000000000000000000000000000000",
		);
		expect(ak.ZeroAddress).toHaveLength(42);
	});
});

describe("entrypoint addresses via SafeAccount classes", () => {
	test("SafeAccountV0_2_0 uses EntryPoint V6", () => {
		expect(ak.SafeAccountV0_2_0.DEFAULT_ENTRYPOINT_ADDRESS).toBe(
			"0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789",
		);
	});

	test("SafeAccountV0_3_0 uses EntryPoint V7", () => {
		expect(ak.SafeAccountV0_3_0.DEFAULT_ENTRYPOINT_ADDRESS).toBe(
			"0x0000000071727De22E5E9d8BAf0edAc6f37da032",
		);
	});

	test("Simple7702Account has DEFAULT_DELEGATEE_ADDRESS", () => {
		expect(ak.Simple7702Account.DEFAULT_DELEGATEE_ADDRESS).toMatch(
			/^0x[0-9a-fA-F]{40}$/,
		);
	});

	test("SafeAccount default entrypoints are distinct", () => {
		const entrypoints = [
			ak.SafeAccountV0_2_0.DEFAULT_ENTRYPOINT_ADDRESS,
			ak.SafeAccountV0_3_0.DEFAULT_ENTRYPOINT_ADDRESS,
		];
		const unique = new Set(entrypoints.map((e) => e.toLowerCase()));
		expect(unique.size).toBe(2);
	});

	test("SafeAccount default entrypoints are valid hex addresses", () => {
		const entrypoints = [
			ak.SafeAccountV0_2_0.DEFAULT_ENTRYPOINT_ADDRESS,
			ak.SafeAccountV0_3_0.DEFAULT_ENTRYPOINT_ADDRESS,
		];
		for (const ep of entrypoints) {
			expect(ep).toMatch(/^0x[0-9a-fA-F]{40}$/);
		}
	});
});

describe("EIP-712 type definitions", () => {
	test("EIP712_SAFE_OPERATION_V6_TYPE has correct structure", () => {
		const type = ak.EIP712_SAFE_OPERATION_V6_TYPE;
		expect(type).toHaveProperty("SafeOp");
		expect(Array.isArray(type.SafeOp)).toBe(true);
		const fieldNames = type.SafeOp.map((f) => f.name);
		expect(fieldNames).toContain("safe");
		expect(fieldNames).toContain("nonce");
		expect(fieldNames).toContain("initCode");
		expect(fieldNames).toContain("callData");
		expect(fieldNames).toContain("validAfter");
		expect(fieldNames).toContain("validUntil");
		expect(fieldNames).toContain("entryPoint");
	});

	test("EIP712_SAFE_OPERATION_V7_TYPE has correct structure", () => {
		const type = ak.EIP712_SAFE_OPERATION_V7_TYPE;
		expect(type).toHaveProperty("SafeOp");
		expect(Array.isArray(type.SafeOp)).toBe(true);
		const fieldNames = type.SafeOp.map((f) => f.name);
		expect(fieldNames).toContain("safe");
		expect(fieldNames).toContain("nonce");
		expect(fieldNames).toContain("callData");
		expect(fieldNames).toContain("entryPoint");
	});

	test("V6 and V7 types have matching field names (possibly different order)", () => {
		const v6Names = ak.EIP712_SAFE_OPERATION_V6_TYPE.SafeOp.map(
			(f) => f.name,
		).sort();
		const v7Names = ak.EIP712_SAFE_OPERATION_V7_TYPE.SafeOp.map(
			(f) => f.name,
		).sort();
		expect(v6Names).toEqual(v7Names);
	});

	test("EIP712_SAFE_OPERATION_PRIMARY_TYPE is SafeOp", () => {
		expect(ak.EIP712_SAFE_OPERATION_PRIMARY_TYPE).toBe("SafeOp");
	});

	test("EIP712_MULTI_CHAIN_OPERATIONS_TYPE has MerkleTreeRoot", () => {
		expect(ak.EIP712_MULTI_CHAIN_OPERATIONS_TYPE).toHaveProperty(
			"MerkleTreeRoot",
		);
		expect(
			ak.EIP712_MULTI_CHAIN_OPERATIONS_TYPE.MerkleTreeRoot,
		).toEqual([{ type: "bytes32", name: "merkleTreeRoot" }]);
	});

	test("EIP712_MULTI_CHAIN_OPERATIONS_PRIMARY_TYPE is MerkleTreeRoot", () => {
		expect(ak.EIP712_MULTI_CHAIN_OPERATIONS_PRIMARY_TYPE).toBe(
			"MerkleTreeRoot",
		);
	});
});

describe("BaseUserOperationDummyValues", () => {
	test("has required fields", () => {
		const dummy = ak.BaseUserOperationDummyValues;
		expect(dummy).toHaveProperty("sender");
		expect(dummy).toHaveProperty("nonce");
		expect(dummy).toHaveProperty("callData");
		expect(dummy).toHaveProperty("callGasLimit");
		expect(dummy).toHaveProperty("verificationGasLimit");
		expect(dummy).toHaveProperty("preVerificationGas");
		expect(dummy).toHaveProperty("maxFeePerGas");
		expect(dummy).toHaveProperty("maxPriorityFeePerGas");
		expect(dummy).toHaveProperty("signature");
	});

	test("has zero/empty defaults", () => {
		const dummy = ak.BaseUserOperationDummyValues;
		expect(dummy.sender).toBe(ak.ZeroAddress);
		expect(dummy.nonce).toBe(0n);
		expect(dummy.callData).toBe("0x");
		expect(dummy.callGasLimit).toBe(0n);
		expect(dummy.verificationGasLimit).toBe(0n);
		expect(dummy.preVerificationGas).toBe(0n);
		expect(dummy.maxFeePerGas).toBe(0n);
		expect(dummy.maxPriorityFeePerGas).toBe(0n);
		expect(dummy.signature).toBe("0x");
	});
});

describe("DEFAULT_SECP256R1_PRECOMPILE_ADDRESS", () => {
	test("is a valid address", () => {
		expect(ak.DEFAULT_SECP256R1_PRECOMPILE_ADDRESS).toMatch(
			/^0x[0-9a-fA-F]{40}$/,
		);
		expect(ak.DEFAULT_SECP256R1_PRECOMPILE_ADDRESS).toBe(
			"0x0000000000000000000000000000000000000100",
		);
	});
});

describe("GasOption enum", () => {
	test("Slow is 1", () => {
		expect(ak.GasOption.Slow).toBe(1);
	});

	test("Medium is 1.2", () => {
		expect(ak.GasOption.Medium).toBe(1.2);
	});

	test("Fast is 1.5", () => {
		expect(ak.GasOption.Fast).toBe(1.5);
	});
});

describe("Operation enum", () => {
	test("Call is 0", () => {
		expect(ak.Operation.Call).toBe(0);
	});

	test("Delegate is 1", () => {
		expect(ak.Operation.Delegate).toBe(1);
	});
});

describe("SafeMessage exports", () => {
	test("SAFE_MESSAGE_PRIMARY_TYPE is SafeMessage", () => {
		expect(ak.SAFE_MESSAGE_PRIMARY_TYPE).toBe("SafeMessage");
	});

	test("SAFE_MESSAGE_MODULE_TYPE has correct structure", () => {
		expect(ak.SAFE_MESSAGE_MODULE_TYPE).toEqual({
			SafeMessage: [{ type: "bytes", name: "message" }],
		});
	});
});
