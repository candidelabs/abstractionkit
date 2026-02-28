const ak = require('../../dist/index.umd');
const { AbiCoder, keccak256, Wallet } = require('ethers');
require('dotenv').config();

const abiCoder = AbiCoder.defaultAbiCoder();

// Signing tests need a private key — any valid secp256k1 key works.
const signingKey = process.env.PRIVATE_KEY1;

describe('Calibur7702Account', () => {

    // ─── Constructor ─────────────────────────────────────────────────────

    test('constructor sets default entrypoint and delegatee', () => {
        const account = new ak.Calibur7702Account("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
        expect(account.accountAddress).toBe("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
        expect(account.entrypointAddress).toBe("0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108");
        expect(account.delegateeAddress).toBe("0x000000009B1D0aF20D8C6d0A44e162d11F9b8f00");
    });

    test('constructor accepts custom entrypoint and delegatee', () => {
        const account = new ak.Calibur7702Account("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", {
            entrypointAddress: "0x1111111111111111111111111111111111111111",
            delegateeAddress: "0x2222222222222222222222222222222222222222",
        });
        expect(account.entrypointAddress).toBe("0x1111111111111111111111111111111111111111");
        expect(account.delegateeAddress).toBe("0x2222222222222222222222222222222222222222");
    });

    // ─── createAccountCallData ───────────────────────────────────────────

    test('createAccountCallData encodes single transaction', () => {
        const callData = ak.Calibur7702Account.createAccountCallData([
            { to: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", value: 1000n, data: "0x" }
        ]);

        // Should start with executeUserOp selector (IAccountExecute)
        expect(callData.startsWith("0x8dd7712f")).toBe(true);

        // Decode: strip selector -> decode BatchedCall struct
        const batchDecoded = abiCoder.decode(
            ["((address,uint256,bytes)[],bool)"],
            "0x" + callData.slice(10)
        );
        expect(batchDecoded[0][0].length).toBe(1);
        expect(batchDecoded[0][0][0][0]).toBe("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
        expect(BigInt(batchDecoded[0][0][0][1])).toBe(1000n);
        expect(batchDecoded[0][1]).toBe(true); // revertOnFailure default
    });

    test('createAccountCallData encodes multiple transactions', () => {
        const callData = ak.Calibur7702Account.createAccountCallData([
            { to: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", value: 100n, data: "0x" },
            { to: "0x1111111111111111111111111111111111111111", value: 200n, data: "0xdeadbeef" },
        ]);

        const batchDecoded = abiCoder.decode(
            ["((address,uint256,bytes)[],bool)"],
            "0x" + callData.slice(10)
        );
        expect(batchDecoded[0][0].length).toBe(2);
        expect(batchDecoded[0][1]).toBe(true);
    });

    test('createAccountCallData respects revertOnFailure=false', () => {
        const callData = ak.Calibur7702Account.createAccountCallData(
            [{ to: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", value: 0n, data: "0x" }],
            false,
        );

        const batchDecoded = abiCoder.decode(
            ["((address,uint256,bytes)[],bool)"],
            "0x" + callData.slice(10)
        );
        expect(batchDecoded[0][1]).toBe(false);
    });

    // ─── Key Helpers ─────────────────────────────────────────────────────

    test('createSecp256k1Key encodes address correctly', () => {
        const key = ak.Calibur7702Account.createSecp256k1Key(
            "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"
        );
        expect(key.keyType).toBe(ak.CaliburKeyType.Secp256k1);

        // Decode and verify it contains the address
        const decoded = abiCoder.decode(["address"], key.publicKey);
        expect(decoded[0]).toBe("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
    });

    test('createWebAuthnP256Key encodes coordinates correctly', () => {
        const x = 12345678901234567890n;
        const y = 98765432109876543210n;
        const key = ak.Calibur7702Account.createWebAuthnP256Key(x, y);
        expect(key.keyType).toBe(ak.CaliburKeyType.WebAuthnP256);

        const decoded = abiCoder.decode(["uint256", "uint256"], key.publicKey);
        expect(BigInt(decoded[0])).toBe(x);
        expect(BigInt(decoded[1])).toBe(y);
    });

    test('createP256Key encodes coordinates correctly', () => {
        const x = 11111n;
        const y = 22222n;
        const key = ak.Calibur7702Account.createP256Key(x, y);
        expect(key.keyType).toBe(ak.CaliburKeyType.P256);

        const decoded = abiCoder.decode(["uint256", "uint256"], key.publicKey);
        expect(BigInt(decoded[0])).toBe(x);
        expect(BigInt(decoded[1])).toBe(y);
    });

    // ─── getKeyHash (double hash) ────────────────────────────────────────

    test('getKeyHash produces double hash', () => {
        const key = ak.Calibur7702Account.createSecp256k1Key(
            "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"
        );
        const keyHash = ak.Calibur7702Account.getKeyHash(key);

        // Manual computation: keccak256(abi.encode(uint8, bytes32))
        const innerHash = keccak256(key.publicKey);
        const encoded = abiCoder.encode(["uint8", "bytes32"], [key.keyType, innerHash]);
        const expected = keccak256(encoded);

        expect(keyHash).toBe(expected);
    });

    test('getKeyHash different key types produce different hashes', () => {
        const x = 12345n;
        const y = 67890n;
        const p256Key = ak.Calibur7702Account.createP256Key(x, y);
        const webAuthnKey = ak.Calibur7702Account.createWebAuthnP256Key(x, y);

        const hash1 = ak.Calibur7702Account.getKeyHash(p256Key);
        const hash2 = ak.Calibur7702Account.getKeyHash(webAuthnKey);

        // Same public key bytes but different key types should produce different hashes
        expect(hash1).not.toBe(hash2);
    });

    // ─── packKeySettings / unpackKeySettings ─────────────────────────────

    test('packKeySettings and unpackKeySettings round-trip', () => {
        const settings = {
            hook: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
            expiration: 1700000000,
            isAdmin: false,
        };
        const packed = ak.Calibur7702Account.packKeySettings(settings);
        const unpacked = ak.Calibur7702Account.unpackKeySettings(packed);

        expect(unpacked.hook.toLowerCase()).toBe(settings.hook.toLowerCase());
        expect(unpacked.expiration).toBe(settings.expiration);
        expect(unpacked.isAdmin).toBe(settings.isAdmin);
    });

    test('packKeySettings with isAdmin=true round-trips', () => {
        const settings = {
            hook: "0x0000000000000000000000000000000000000000",
            expiration: 0,
            isAdmin: true,
        };
        const packed = ak.Calibur7702Account.packKeySettings(settings);
        const unpacked = ak.Calibur7702Account.unpackKeySettings(packed);

        expect(unpacked.isAdmin).toBe(true);
        expect(unpacked.expiration).toBe(0);
    });

    test('packKeySettings defaults: no hook, no expiration, not admin', () => {
        const packed = ak.Calibur7702Account.packKeySettings({});
        const unpacked = ak.Calibur7702Account.unpackKeySettings(packed);

        expect(unpacked.hook).toBe("0x0000000000000000000000000000000000000000");
        expect(unpacked.expiration).toBe(0);
        expect(unpacked.isAdmin).toBe(false);
    });

    test('packKeySettings layout: (isAdmin << 200) | (expiration << 160) | hook', () => {
        const hook = "0x000000000000000000000000000000000000000a"; // = 10
        const expiration = 5;
        const isAdmin = true;

        const packed = ak.Calibur7702Account.packKeySettings({ hook, expiration, isAdmin });

        // Verify bit layout
        const hookPart = packed & ((1n << 160n) - 1n);
        const expirationPart = (packed >> 160n) & ((1n << 40n) - 1n);
        const isAdminPart = (packed >> 200n) & 1n;

        expect(hookPart).toBe(10n);
        expect(expirationPart).toBe(5n);
        expect(isAdminPart).toBe(1n);
    });

    // ─── signUserOperation ───────────────────────────────────────────────

    test('signUserOperation produces abi.encode(ROOT_KEY_HASH, sig, hookData)', () => {
        if (!signingKey) throw new Error('PRIVATE_KEY1 env var required for signing tests');
        const account = new ak.Calibur7702Account("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
        const privateKey = signingKey;

        const userOp = {
            sender: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
            nonce: 0n,
            callData: "0x",
            callGasLimit: 100000n,
            verificationGasLimit: 100000n,
            preVerificationGas: 50000n,
            maxFeePerGas: 1000000000n,
            maxPriorityFeePerGas: 1000000000n,
            signature: "0x",
            factory: null,
            factoryData: null,
            paymaster: null,
            paymasterVerificationGasLimit: null,
            paymasterPostOpGasLimit: null,
            paymasterData: null,
            eip7702Auth: null,
        };

        const sig = account.signUserOperation(userOp, privateKey, 11155111n);

        // Decode the signature
        const decoded = abiCoder.decode(["bytes32", "bytes", "bytes"], sig);
        const ROOT_KEY_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";
        expect(decoded[0]).toBe(ROOT_KEY_HASH);
        expect(decoded[1].length).toBe(132); // 65 bytes ECDSA sig = 0x + 130 hex chars
        expect(decoded[2]).toBe("0x"); // empty hookData
    });

    test('signUserOperation with hookData', () => {
        if (!signingKey) throw new Error('PRIVATE_KEY1 env var required for signing tests');
        const account = new ak.Calibur7702Account("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
        const privateKey = signingKey;

        const userOp = {
            sender: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
            nonce: 0n,
            callData: "0x",
            callGasLimit: 100000n,
            verificationGasLimit: 100000n,
            preVerificationGas: 50000n,
            maxFeePerGas: 1000000000n,
            maxPriorityFeePerGas: 1000000000n,
            signature: "0x",
            factory: null,
            factoryData: null,
            paymaster: null,
            paymasterVerificationGasLimit: null,
            paymasterPostOpGasLimit: null,
            paymasterData: null,
            eip7702Auth: null,
        };

        const sig = account.signUserOperation(userOp, privateKey, 11155111n, {
            hookData: "0xdeadbeef",
        });

        const decoded = abiCoder.decode(["bytes32", "bytes", "bytes"], sig);
        expect(decoded[2]).toBe("0xdeadbeef");
    });

    // ─── formatWebAuthnSignature ─────────────────────────────────────────

    test('formatWebAuthnSignature produces correct wrapped signature', () => {
        const account = new ak.Calibur7702Account("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
        const keyHash = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";

        const webAuthnAuth = {
            authenticatorData: "0x49960de5880e8c687434170f6476605b8fe4aeb9a28632c7995cf3ba831d97630500000000",
            clientDataJSON: '{"type":"webauthn.get","challenge":"test"}',
            challengeIndex: 23n,
            typeIndex: 1n,
            r: 12345678n,
            s: 87654321n,
        };

        const sig = account.formatWebAuthnSignature(keyHash, webAuthnAuth);

        // Decode outer wrapper
        const decoded = abiCoder.decode(["bytes32", "bytes", "bytes"], sig);
        expect(decoded[0]).toBe(keyHash);
        expect(decoded[2]).toBe("0x"); // empty hookData

        // Decode inner WebAuthn data (struct-wrapped encoding)
        const webAuthnDecoded = abiCoder.decode(
            ["(bytes,string,uint256,uint256,uint256,uint256)"],
            decoded[1]
        );
        expect(webAuthnDecoded[0][0]).toBe(webAuthnAuth.authenticatorData);
        expect(webAuthnDecoded[0][1]).toBe(webAuthnAuth.clientDataJSON);
        expect(BigInt(webAuthnDecoded[0][2])).toBe(23n);
        expect(BigInt(webAuthnDecoded[0][3])).toBe(1n);
        expect(BigInt(webAuthnDecoded[0][4])).toBe(12345678n);
        expect(BigInt(webAuthnDecoded[0][5])).toBe(87654321n);
    });

    test('formatWebAuthnSignature with hookData', () => {
        const account = new ak.Calibur7702Account("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
        const keyHash = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";

        const sig = account.formatWebAuthnSignature(keyHash, {
            authenticatorData: "0x00",
            clientDataJSON: "{}",
            challengeIndex: 0n,
            typeIndex: 0n,
            r: 1n,
            s: 1n,
        }, { hookData: "0xcafe" });

        const decoded = abiCoder.decode(["bytes32", "bytes", "bytes"], sig);
        expect(decoded[2]).toBe("0xcafe");
    });

    // ─── Key Management ──────────────────────────────────────────────────

    test('createRegisterKeyMetaTransactions returns 2 transactions', () => {
        const key = ak.Calibur7702Account.createSecp256k1Key(
            "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"
        );
        const txs = ak.Calibur7702Account.createRegisterKeyMetaTransactions(key);

        expect(txs.length).toBe(2);
        // Both should target address zero
        expect(txs[0].to).toBe("0x0000000000000000000000000000000000000000");
        expect(txs[1].to).toBe("0x0000000000000000000000000000000000000000");
        // First should have register selector: register((uint8,bytes))
        expect(txs[0].data.startsWith("0x30b1fa3b")).toBe(true);
        // Second should have update selector: update(bytes32,uint256)
        expect(txs[1].data.startsWith("0xa58bb84a")).toBe(true);
        // Both should have 0 value
        expect(txs[0].value).toBe(0n);
        expect(txs[1].value).toBe(0n);
    });

    test('createRegisterKeyMetaTransactions throws on isAdmin=true', () => {
        const key = ak.Calibur7702Account.createSecp256k1Key(
            "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"
        );
        // Should throw when isAdmin: true is requested
        expect(() => {
            ak.Calibur7702Account.createRegisterKeyMetaTransactions(key, {
                isAdmin: true,
                expiration: 1700000000,
            });
        }).toThrow();
    });

    test('createRevokeKeyMetaTransaction targets address zero with revoke selector', () => {
        const keyHash = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
        const tx = ak.Calibur7702Account.createRevokeKeyMetaTransaction(keyHash);

        expect(tx.to).toBe("0x0000000000000000000000000000000000000000");
        expect(tx.value).toBe(0n);
        expect(tx.data.startsWith("0xb75c7dc6")).toBe(true);

        // Decode and verify key hash
        const decoded = abiCoder.decode(["bytes32"], "0x" + tx.data.slice(10));
        expect(decoded[0]).toBe(keyHash);
    });

    test('createUpdateKeySettingsMetaTransaction throws on isAdmin=true', () => {
        const keyHash = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
        expect(() => {
            ak.Calibur7702Account.createUpdateKeySettingsMetaTransaction(keyHash, {
                isAdmin: true,
            });
        }).toThrow();
    });

    test('createUpdateKeySettingsMetaTransaction works with isAdmin=false', () => {
        const keyHash = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
        const tx = ak.Calibur7702Account.createUpdateKeySettingsMetaTransaction(keyHash, {
            isAdmin: false,
            expiration: 1800000000,
        });

        expect(tx.to).toBe("0x0000000000000000000000000000000000000000");
        expect(tx.data.startsWith("0xa58bb84a")).toBe(true);
    });

    test('createInvalidateNonceMetaTransaction encodes correctly', () => {
        const tx = ak.Calibur7702Account.createInvalidateNonceMetaTransaction(42n);

        expect(tx.to).toBe("0x0000000000000000000000000000000000000000");
        expect(tx.data.startsWith("0xb70e36f0")).toBe(true);

        const decoded = abiCoder.decode(["uint256"], "0x" + tx.data.slice(10));
        expect(BigInt(decoded[0])).toBe(42n);
    });

    // ─── Token Paymaster Support ─────────────────────────────────────────

    test('prependTokenPaymasterApproveToCallData prepends approve', () => {
        // Create original calldata with one transaction
        const originalCallData = ak.Calibur7702Account.createAccountCallData([
            { to: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", value: 1000n, data: "0x" }
        ]);

        const tokenAddress = "0x1111111111111111111111111111111111111111";
        const paymasterAddress = "0x2222222222222222222222222222222222222222";
        const approveAmount = 5000n;

        const account = new ak.Calibur7702Account("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
        const result = account.prependTokenPaymasterApproveToCallData(
            originalCallData,
            tokenAddress,
            paymasterAddress,
            approveAmount,
        );

        // Decode the result
        expect(result.startsWith("0x8dd7712f")).toBe(true);
        const batchDecoded = abiCoder.decode(
            ["((address,uint256,bytes)[],bool)"],
            "0x" + result.slice(10)
        );

        // Should have 2 calls now (approve + original)
        expect(batchDecoded[0][0].length).toBe(2);
        // First call should be the approve
        expect(batchDecoded[0][0][0][0]).toBe(tokenAddress);
        expect(BigInt(batchDecoded[0][0][0][1])).toBe(0n);
        // Second call should be the original
        expect(batchDecoded[0][0][1][0]).toBe("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
        expect(BigInt(batchDecoded[0][0][1][1])).toBe(1000n);
    });

    test('prependTokenPaymasterApproveToCallData throws on invalid selector', () => {
        expect(() => {
            ak.Calibur7702Account.prependTokenPaymasterApproveToCallDataStatic(
                "0xdeadbeef0000",
                "0x1111111111111111111111111111111111111111",
                "0x2222222222222222222222222222222222222222",
                1000n,
            );
        }).toThrow();
    });

    // ─── Dummy Signatures ────────────────────────────────────────────────

    test('dummySignature is valid ABI-encoded format', () => {
        const sig = ak.Calibur7702Account.dummySignature;
        expect(sig.startsWith("0x")).toBe(true);
        // Should be decodable
        const decoded = abiCoder.decode(["bytes32", "bytes", "bytes"], sig);
        expect(decoded[0]).toBe("0x0000000000000000000000000000000000000000000000000000000000000000");
    });

    test('createDummyWebAuthnSignature is larger than dummySignature', () => {
        const keyHash = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
        const dummyWebAuthnSig = ak.Calibur7702Account.createDummyWebAuthnSignature(keyHash);
        expect(dummyWebAuthnSig.length)
            .toBeGreaterThan(ak.Calibur7702Account.dummySignature.length);
    });

    // ─── Exports ─────────────────────────────────────────────────────────

    test('CALIBUR_SINGLETON_ADDRESS is exported', () => {
        expect(ak.CALIBUR_SINGLETON_ADDRESS).toBe("0x000000009B1D0aF20D8C6d0A44e162d11F9b8f00");
    });

    test('CaliburKeyType enum is exported', () => {
        expect(ak.CaliburKeyType.P256).toBe(0);
        expect(ak.CaliburKeyType.WebAuthnP256).toBe(1);
        expect(ak.CaliburKeyType.Secp256k1).toBe(2);
    });

    // ─── createUserOperation validation ──────────────────────────────────

    test('createUserOperation throws on empty transactions', async () => {
        const account = new ak.Calibur7702Account("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
        await expect(
            account.createUserOperation([], "http://localhost:8545", "http://localhost:3000")
        ).rejects.toThrow("There should be at least one transaction");
    });

    test('createUserOperation throws on negative maxFeePerGas', async () => {
        const account = new ak.Calibur7702Account("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
        await expect(
            account.createUserOperation(
                [{ to: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", value: 0n, data: "0x" }],
                "http://localhost:8545",
                "http://localhost:3000",
                { maxFeePerGas: -1n }
            )
        ).rejects.toThrow("maxFeePerGas override can't be negative");
    });

    test('createUserOperation throws when providerRpc is null and nonce not overridden', async () => {
        const account = new ak.Calibur7702Account("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
        await expect(
            account.createUserOperation(
                [{ to: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", value: 0n, data: "0x" }],
            )
        ).rejects.toThrow("providerRpc");
    });
});
