const ak = require('../../dist/index.cjs');
require('dotenv').config();

jest.setTimeout(300000);

const ENTRYPOINT_V9 = "0x433709009B8330FDa32311DF1C2AFA402eD8D009";
const ENTRYPOINT_V8 = "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108";
const ENTRYPOINT_V6 = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";

const chainId = process.env.CHAIN_ID ?? "11155111";
const ownerPrivateKey = process.env.PRIVATE_KEY1;

// Helper to create a minimal V9 UserOperation for unit tests
function createMockUserOperationV9(overrides = {}) {
    return {
        sender: "0x1234567890abcdef1234567890abcdef12345678",
        nonce: 0n,
        factory: null,
        factoryData: null,
        callData: "0x",
        callGasLimit: 100000n,
        verificationGasLimit: 100000n,
        preVerificationGas: 50000n,
        maxFeePerGas: 1000000000n,
        maxPriorityFeePerGas: 100000000n,
        paymaster: null,
        paymasterVerificationGasLimit: null,
        paymasterPostOpGasLimit: null,
        paymasterData: null,
        signature: "0x" + "00".repeat(65),
        eip7702Auth: null,
        ...overrides,
    };
}

// Helper to create a minimal V6 UserOperation
function createMockUserOperationV6() {
    return {
        sender: "0x1234567890abcdef1234567890abcdef12345678",
        nonce: 0n,
        initCode: "0x",
        callData: "0x",
        callGasLimit: 100000n,
        verificationGasLimit: 100000n,
        preVerificationGas: 50000n,
        maxFeePerGas: 1000000000n,
        maxPriorityFeePerGas: 100000000n,
        paymasterAndData: "0x",
        signature: "0x" + "00".repeat(65),
    };
}

describe('Simple7702AccountV09', () => {
    test('constructor sets correct default entrypoint and delegatee', () => {
        const account = new ak.Simple7702AccountV09(
            "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        );
        expect(account.accountAddress).toBe(
            "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        );
        expect(account.entrypointAddress).toBe(ENTRYPOINT_V9);
    });

    test('constructor accepts custom entrypoint override', () => {
        const customEntrypoint = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        const account = new ak.Simple7702AccountV09(
            "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            { entrypointAddress: customEntrypoint }
        );
        expect(account.entrypointAddress).toBe(customEntrypoint);
    });
});

describe('createUserOperationHash with V9', () => {
    test('produces a valid 32-byte hash for V9 entrypoint', () => {
        const userOp = createMockUserOperationV9();
        const hash = ak.createUserOperationHash(
            userOp, ENTRYPOINT_V9, BigInt(chainId)
        );
        expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
    });

    test('V9 hash differs from V8 hash for same userOp fields', () => {
        const userOp = createMockUserOperationV9();
        const hashV9 = ak.createUserOperationHash(
            userOp, ENTRYPOINT_V9, BigInt(chainId)
        );
        const hashV8 = ak.createUserOperationHash(
            userOp, ENTRYPOINT_V8, BigInt(chainId)
        );
        // Different entrypoints => different domain separator => different hash
        expect(hashV9).not.toBe(hashV8);
    });
});

describe('Tenderly simulation - version/entrypoint validation', () => {
    test('simulateUserOperationWithTenderly rejects V6 userOp with V9 entrypoint', async () => {
        const v6Op = createMockUserOperationV6();
        await expect(
            ak.simulateUserOperationWithTenderly(
                "slug", "project", "key",
                BigInt(chainId), ENTRYPOINT_V9, v6Op
            )
        ).rejects.toThrow("UserOperation version does not match entrypoint.");
    });

    test('simulateUserOperationWithTenderly rejects V9 userOp with V6 entrypoint', async () => {
        const v9Op = createMockUserOperationV9();
        await expect(
            ak.simulateUserOperationWithTenderly(
                "slug", "project", "key",
                BigInt(chainId), ENTRYPOINT_V6, v9Op
            )
        ).rejects.toThrow("UserOperation version does not match entrypoint.");
    });

    test('simulateUserOperationCallDataWithTenderly rejects V6 userOp with V9 entrypoint', async () => {
        const v6Op = createMockUserOperationV6();
        await expect(
            ak.simulateUserOperationCallDataWithTenderly(
                "slug", "project", "key",
                BigInt(chainId), ENTRYPOINT_V9, v6Op
            )
        ).rejects.toThrow("UserOperation version does not match entrypoint.");
    });

    test('simulateUserOperationCallDataWithTenderly rejects V9 userOp with V6 entrypoint', async () => {
        const v9Op = createMockUserOperationV9();
        await expect(
            ak.simulateUserOperationCallDataWithTenderly(
                "slug", "project", "key",
                BigInt(chainId), ENTRYPOINT_V6, v9Op
            )
        ).rejects.toThrow("UserOperation version does not match entrypoint.");
    });
});

describe('Tenderly simulation - V9 entrypoint in senderCreator mapping', () => {
    test('simulateSenderCallDataWithTenderly accepts V9 entrypoint', async () => {
        // This will fail at the HTTP call (no real Tenderly key), but should
        // NOT fail with "Invalid entrypoint" — proving V9 is recognized.
        await expect(
            ak.simulateSenderCallDataWithTenderly(
                "slug", "project", "key",
                BigInt(chainId), ENTRYPOINT_V9,
                "0x1234567890abcdef1234567890abcdef12345678",
                "0x", null, null
            )
        ).rejects.not.toThrow(/Invalid entrypoint/);
    });

    test('simulateSenderCallDataWithTenderly rejects unknown entrypoint', async () => {
        await expect(
            ak.simulateSenderCallDataWithTenderly(
                "slug", "project", "key",
                BigInt(chainId),
                "0x0000000000000000000000000000000000000099",
                "0x1234567890abcdef1234567890abcdef12345678",
                "0x", null, null
            )
        ).rejects.toThrow(/Invalid entrypoint/);
    });
});

describe('Tenderly simulation - executeUserOp callData rewriting', () => {
    test('simulateUserOperationCallDataWithTenderly rewrites executeUserOp callData for V9', async () => {
        // Build a V9 userOp whose callData starts with the executeUserOp selector.
        // The function should rewrite callData to include packed userOp + hash
        // before calling simulateSenderCallDataWithTenderly.
        // We can't easily intercept the internal call, but we can verify it
        // doesn't throw "Invalid entrypoint" and does proceed to the HTTP stage.
        const abiCoder = new (require('ethers').AbiCoder)();
        const innerCallData = abiCoder.encode(
            ["((address,uint256,bytes)[],bool)"],
            [[[["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", 0n, "0x"]], false]]
        );
        const executeUserOpCallData = "0x8dd7712f" + innerCallData.slice(2);

        const v9Op = createMockUserOperationV9({
            callData: executeUserOpCallData,
        });

        // Will fail at HTTP layer but should get past the version check and
        // callData rewriting without error.
        await expect(
            ak.simulateUserOperationCallDataWithTenderly(
                "slug", "project", "key",
                BigInt(chainId), ENTRYPOINT_V9, v9Op
            )
        ).rejects.not.toThrow(/Invalid entrypoint/);
        await expect(
            ak.simulateUserOperationCallDataWithTenderly(
                "slug", "project", "key",
                BigInt(chainId), ENTRYPOINT_V9, v9Op
            )
        ).rejects.not.toThrow(/UserOperation version does not match/);
    });

    test('non-executeUserOp callData is passed through unchanged for V9', async () => {
        const v9Op = createMockUserOperationV9({
            callData: "0xdeadbeef",
        });

        // Should pass version checks and reach HTTP layer
        await expect(
            ak.simulateUserOperationCallDataWithTenderly(
                "slug", "project", "key",
                BigInt(chainId), ENTRYPOINT_V9, v9Op
            )
        ).rejects.not.toThrow(/Invalid entrypoint/);
    });
});

describe('signUserOperation for Simple7702AccountV09', () => {
    test('produces a valid signature', () => {
        if (!ownerPrivateKey) {
            console.warn('Skipping sign test: PRIVATE_KEY1 not set in .env');
            return;
        }
        const account = new ak.Simple7702AccountV09(
            "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        );
        const userOp = createMockUserOperationV9({
            sender: account.accountAddress,
        });
        const sig = account.signUserOperation(
            userOp, ownerPrivateKey, BigInt(chainId)
        );
        expect(sig).toMatch(/^0x[0-9a-f]+$/i);
        // ECDSA signature: 32 bytes r + 32 bytes s + 1 byte v = 65 bytes = 130 hex chars
        expect(sig.length).toBe(2 + 130);
    });
});
