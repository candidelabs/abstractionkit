const ak = require('../../dist/index.umd');
const { AbiCoder, keccak256, Wallet, solidityPacked } = require('ethers');
require('dotenv').config();

const abiCoder = AbiCoder.defaultAbiCoder();

const ENTRYPOINT_V8 = "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108";
const ENTRYPOINT_V9 = "0x433709009B8330FDa32311DF1C2AFA402eD8D009";
const ROOT_KEY_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";

// Tests 1.6 and 1.13 need a private key for deterministic ECDSA signing.
// Falls back to a well-known test key so tests run without .env.
const signingKey = process.env.PRIVATE_KEY1 ||
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

describe('Calibur ABI Encoding Correctness', () => {

    // ─── Test 1.1: BatchedCall encoding matches Solidity output ─────────

    test('1.1 BatchedCall encoding matches Solidity abi.encode(BatchedCall)', () => {
        const callData = ak.Calibur7702Account.createAccountCallData(
            [{ to: "0x000000000000000000000000000000000000dEaD", value: 1000n, data: "0x" }],
            true,
        );

        // Strip the 4-byte selector
        const encodedPayload = "0x" + callData.slice(10);

        // Reference: ethers.js abi.encode with the SAME tuple-wrapped format
        // that Solidity uses for struct decoding: abi.decode(data, (BatchedCall))
        // BatchedCall = { Call[] calls, bool revertOnFailure }
        // Call = { address to, uint256 value, bytes data }
        const reference = abiCoder.encode(
            ["((address,uint256,bytes)[],bool)"],
            [[[["0x000000000000000000000000000000000000dEaD", 1000n, "0x"]], true]],
        );

        expect(encodedPayload).toBe(reference);

        // Verify this is NOT flat encoding (would differ in offset structure)
        const flatEncoding = abiCoder.encode(
            ["(address,uint256,bytes)[]", "bool"],
            [[["0x000000000000000000000000000000000000dEaD", 1000n, "0x"]], true],
        );
        expect(encodedPayload).not.toBe(flatEncoding);
    });

    // ─── Test 1.2: WebAuthnAuth encoding matches Solidity output ────────

    test('1.2 WebAuthnAuth encoding matches Solidity abi.encode(WebAuthnAuth)', () => {
        const account = new ak.Calibur7702Account("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
        const keyHash = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";

        const webAuthnAuth = {
            authenticatorData: "0x49960de5880e8c687434170f6476605b8fe4aeb9a28632c7995cf3ba831d97630500000000",
            clientDataJSON: '{"type":"webauthn.get","challenge":"test-challenge","origin":"https://localhost"}',
            challengeIndex: 23n,
            typeIndex: 1n,
            r: 12345678901234567890n,
            s: 98765432109876543210n,
        };

        const sig = account.formatWebAuthnSignature(keyHash, webAuthnAuth);

        // Decode outer wrapper: abi.encode(bytes32, bytes, bytes)
        const outer = abiCoder.decode(["bytes32", "bytes", "bytes"], sig);
        const innerBytes = outer[1]; // the WebAuthn-encoded bytes

        // Reference: Solidity abi.encode(WebAuthn.WebAuthnAuth(...)) uses struct-wrapped encoding
        const reference = abiCoder.encode(
            ["(bytes,string,uint256,uint256,uint256,uint256)"],
            [[
                webAuthnAuth.authenticatorData,
                webAuthnAuth.clientDataJSON,
                webAuthnAuth.challengeIndex,
                webAuthnAuth.typeIndex,
                webAuthnAuth.r,
                webAuthnAuth.s,
            ]],
        );

        expect(innerBytes).toBe(reference);
    });

    // ─── Test 1.3: Register calldata matches Solidity output ────────────

    test('1.3 register calldata matches Solidity abi.encodeCall(register, (key))', () => {
        const key = ak.Calibur7702Account.createWebAuthnP256Key(1n, 2n);
        const txs = ak.Calibur7702Account.createRegisterKeyMetaTransactions(key);

        // First tx is the register call
        const registerData = txs[0].data;

        // Verify selector: register((uint8,bytes)) = 0x30b1fa3b
        expect(registerData.slice(0, 10)).toBe("0x30b1fa3b");

        // Reference: abi.encodeCall(IKeyManagement.register, (key))
        // = selector + abi.encode((uint8,bytes), key)
        const referenceParams = abiCoder.encode(
            ["(uint8,bytes)"],
            [[key.keyType, key.publicKey]],
        );
        const referenceCallData = "0x30b1fa3b" + referenceParams.slice(2);

        expect(registerData).toBe(referenceCallData);
    });

    // ─── Test 1.4: Key hash matches Solidity KeyLib.hash() ──────────────

    test('1.4 key hash matches Solidity keccak256(abi.encode(keyType, keccak256(publicKey)))', () => {
        // Test all three key types with known values
        const testCases = [
            {
                name: "Secp256k1",
                key: ak.Calibur7702Account.createSecp256k1Key(
                    "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"
                ),
            },
            {
                name: "P256",
                key: ak.Calibur7702Account.createP256Key(
                    0x1234n, 0x5678n,
                ),
            },
            {
                name: "WebAuthnP256",
                key: ak.Calibur7702Account.createWebAuthnP256Key(
                    0xABCDn, 0xEF01n,
                ),
            },
        ];

        for (const { name, key } of testCases) {
            const sdkHash = ak.Calibur7702Account.getKeyHash(key);

            // Manual Solidity-equivalent computation:
            // keccak256(abi.encode(uint8 keyType, bytes32 keccak256(publicKey)))
            const innerHash = keccak256(key.publicKey);
            const encoded = abiCoder.encode(
                ["uint8", "bytes32"],
                [key.keyType, innerHash],
            );
            const referenceHash = keccak256(encoded);

            expect(sdkHash).toBe(referenceHash);
        }
    });

    // ─── Test 1.5: Settings packing boundary values ─────────────────────

    test('1.5 settings packing with max expiration and full hook', () => {
        const maxExpiration = Number((1n << 40n) - 1n); // 2^40 - 1
        const fullHook = "0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF";

        const packed = ak.Calibur7702Account.packKeySettings({
            isAdmin: true,
            expiration: maxExpiration,
            hook: fullHook,
        });
        const unpacked = ak.Calibur7702Account.unpackKeySettings(packed);

        expect(unpacked.isAdmin).toBe(true);
        expect(unpacked.expiration).toBe(maxExpiration);
        expect(unpacked.hook.toLowerCase()).toBe(fullHook.toLowerCase());
    });

    test('1.5b ROOT_KEY_SETTINGS = (1n << 200n) — only admin bit set', () => {
        const rootSettings = ak.Calibur7702Account.packKeySettings({
            isAdmin: true,
            expiration: 0,
            hook: ak.ZeroAddress,
        });

        // Solidity ROOT_KEY_SETTINGS constant = (1 << 200)
        const expected = 1n << 200n;
        expect(rootSettings).toBe(expected);
    });

    // ─── Test 1.6: Wrapped signature structure ──────────────────────────

    test('1.6 wrapped signature matches abi.encode(bytes32, bytes, bytes)', () => {
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

        // Decode wrapped format: abi.encode(bytes32 keyHash, bytes sig, bytes hookData)
        const decoded = abiCoder.decode(["bytes32", "bytes", "bytes"], sig);
        const keyHash = decoded[0];
        const ecdsaSig = decoded[1];
        const hookData = decoded[2];

        expect(keyHash).toBe(ROOT_KEY_HASH);
        expect(ecdsaSig.length).toBe(132); // 0x + 130 hex chars = 65 bytes
        expect(hookData).toBe("0x");

        // Manually construct the same wrapped signature and verify it matches
        const userOpHash = ak.createUserOperationHash(userOp, ENTRYPOINT_V8, 11155111n);
        const wallet = new Wallet(privateKey);
        const rawEcdsaSig = wallet.signingKey.sign(userOpHash).serialized;

        const manualWrapped = abiCoder.encode(
            ["bytes32", "bytes", "bytes"],
            [ROOT_KEY_HASH, rawEcdsaSig, "0x"],
        );

        expect(sig).toBe(manualWrapped);
    });

    // ─── Test 1.7: UserOperation hash computation ───────────────────────

    test('1.7 UserOperation hash is valid bytes32 with EIP-712 structure', () => {
        const userOp = {
            sender: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
            nonce: 42n,
            callData: "0xdeadbeef",
            callGasLimit: 200000n,
            verificationGasLimit: 150000n,
            preVerificationGas: 50000n,
            maxFeePerGas: 2000000000n,
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

        const hash = ak.createUserOperationHash(userOp, ENTRYPOINT_V8, 11155111n);

        // Valid bytes32: 0x + 64 hex chars
        expect(hash).toMatch(/^0x[0-9a-f]{64}$/);

        // Verify EIP-712 structure: keccak256(0x1901 || domainSeparator || structHash)
        // Domain separator for EntryPoint v0.8
        const DOMAIN_NAME_HASH = "0x364da28a5c92bcc87fe97c8813a6c6b8a3a049b0ea0a328fcb0b4f0e00337586";
        const DOMAIN_VERSION_HASH = "0xc89efdaa54c0f20c7adf612882df0950f5a951637e0307cdcb4c672f298b8bc6";
        const TYPE_HASH = "0x8b73c3c69bb8fe3d512ecc4cf759cc79239f7b179b0ffacaa9a75d522b39400f";

        const domainSeparator = keccak256(abiCoder.encode(
            ["(bytes32,bytes32,bytes32,uint256,address)"],
            [[TYPE_HASH, DOMAIN_NAME_HASH, DOMAIN_VERSION_HASH, 11155111n, ENTRYPOINT_V8]],
        ));

        // Pack the UserOp to compute structHash
        const PACKED_USEROP_TYPEHASH = "0x29a0bca4af4be3421398da00295e58e6d7de38cb492214754cb6a47507dd6f8e";
        const accountGasLimits = "0x" +
            abiCoder.encode(["uint128"], [userOp.verificationGasLimit]).slice(34) +
            abiCoder.encode(["uint128"], [userOp.callGasLimit]).slice(34);
        const gasFees = "0x" +
            abiCoder.encode(["uint128"], [userOp.maxPriorityFeePerGas]).slice(34) +
            abiCoder.encode(["uint128"], [userOp.maxFeePerGas]).slice(34);

        const packedUserOp = abiCoder.encode(
            ["bytes32", "address", "uint256", "bytes32", "bytes32", "bytes32", "uint256", "bytes32", "bytes32"],
            [
                PACKED_USEROP_TYPEHASH,
                userOp.sender,
                userOp.nonce,
                keccak256("0x"), // initCode hash
                keccak256(userOp.callData),
                accountGasLimits,
                userOp.preVerificationGas,
                gasFees,
                keccak256("0x"), // paymasterAndData hash
            ],
        );
        const structHash = keccak256(packedUserOp);

        const expectedHash = keccak256("0x1901" + domainSeparator.slice(2) + structHash.slice(2));
        expect(hash).toBe(expectedHash);
    });

    // ─── Test 1.8: Nonce construction from sequenceKey + sequence ────────

    test('1.8 nonce construction: (sequenceKey << 64) | sequence', () => {
        // Basic case
        const nonce1 = (5n << 64n) | 42n;
        expect(nonce1 >> 64n).toBe(5n);
        expect(nonce1 & ((1n << 64n) - 1n)).toBe(42n);

        // Zero case
        const nonce0 = (0n << 64n) | 0n;
        expect(nonce0).toBe(0n);

        // Large sequenceKey
        const largeKey = (1n << 192n) - 1n; // max 192-bit value
        const nonceLarge = (largeKey << 64n) | 100n;
        expect(nonceLarge >> 64n).toBe(largeKey);
        expect(nonceLarge & ((1n << 64n) - 1n)).toBe(100n);

        // Max sequence value
        const maxSeq = (1n << 64n) - 1n;
        const nonceMaxSeq = (1n << 64n) | maxSeq;
        expect(nonceMaxSeq & ((1n << 64n) - 1n)).toBe(maxSeq);
    });

    // ─── Test 1.9: Settings packing — expiration=0 means no expiry (OZ L-09) ──

    test('1.9 (OZ L-09) expiration=0 means no expiry — register with no expiration', () => {
        // Pack with expiration=0
        const packed = ak.Calibur7702Account.packKeySettings({ expiration: 0 });
        const unpacked = ak.Calibur7702Account.unpackKeySettings(packed);
        expect(unpacked.expiration).toBe(0);

        // createRegisterKeyMetaTransactions with no expiration override
        // produces an update() call where packed settings have expiration=0
        const key = ak.Calibur7702Account.createWebAuthnP256Key(111n, 222n);
        const txs = ak.Calibur7702Account.createRegisterKeyMetaTransactions(key, {});

        // Second tx is update(bytes32, uint256) — decode the packed settings
        const updateData = txs[1].data;
        const updateParams = abiCoder.decode(
            ["bytes32", "uint256"],
            "0x" + updateData.slice(10),
        );
        const settingsFromTx = ak.Calibur7702Account.unpackKeySettings(BigInt(updateParams[1]));
        expect(settingsFromTx.expiration).toBe(0);
        expect(settingsFromTx.isAdmin).toBe(false);
    });

    // ─── Test 1.10: Re-registering same key produces valid calldata (OZ L-14) ──

    test('1.10 (OZ L-14) re-registering same key produces valid calldata', () => {
        const key = ak.Calibur7702Account.createWebAuthnP256Key(
            0xABCDEF1234567890n,
            0x1234567890ABCDEFn,
        );

        // Register with one set of settings
        const txs1 = ak.Calibur7702Account.createRegisterKeyMetaTransactions(key, {
            expiration: 1700000000,
        });

        // Register again with different settings
        const txs2 = ak.Calibur7702Account.createRegisterKeyMetaTransactions(key, {
            expiration: 1800000000,
        });

        // Both produce valid calldata (same register call, different update call)
        expect(txs1[0].data).toBe(txs2[0].data); // same register
        expect(txs1[1].data).not.toBe(txs2[1].data); // different settings

        // Both have the correct selectors
        expect(txs1[0].data.startsWith("0x30b1fa3b")).toBe(true);
        expect(txs2[0].data.startsWith("0x30b1fa3b")).toBe(true);
        expect(txs1[1].data.startsWith("0xa58bb84a")).toBe(true);
        expect(txs2[1].data.startsWith("0xa58bb84a")).toBe(true);
    });

    // ─── Test 1.11: WebAuthn authenticatorData UV flag (OZ M-04) ────────

    test('1.11 (OZ M-04) WebAuthn dummy signature includes UV flag in authenticatorData', () => {
        const keyHash = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
        const dummySig = ak.Calibur7702Account.createDummyWebAuthnSignature(keyHash);

        // Decode outer wrapper
        const outer = abiCoder.decode(["bytes32", "bytes", "bytes"], dummySig);
        // Decode inner WebAuthn struct
        const inner = abiCoder.decode(
            ["(bytes,string,uint256,uint256,uint256,uint256)"],
            outer[1],
        );

        const authenticatorData = inner[0][0]; // bytes
        // authenticatorData format: rpIdHash(32) + flags(1) + signCount(4)
        // flags byte is at index 32 (byte offset 64+2 in hex = char 66-68)
        const flagsByte = parseInt(authenticatorData.slice(66, 68), 16);

        // UP flag (0x01) must be set
        expect(flagsByte & 0x01).toBe(0x01);
        // UV flag (0x04) must be set
        expect(flagsByte & 0x04).toBe(0x04);
        // Combined: flags should be 0x05
        expect(flagsByte).toBe(0x05);
    });

    // ─── Test 1.12: Nonce key extraction (Cantina 3.2.3) ────────────────

    test('1.12 (Cantina 3.2.3) nonce key extraction — upper 192 bits and lower 64 bits', () => {
        // Verify: nonce = (sequenceKey << 64) | sequence
        // → sequenceKey = nonce >> 64, sequence = nonce & ((1<<64)-1)
        const sequenceKey = 0xDEADBEEFn;
        const sequence = 0x42n;
        const nonce = (sequenceKey << 64n) | sequence;

        expect(nonce >> 64n).toBe(sequenceKey);
        expect(nonce & ((1n << 64n) - 1n)).toBe(sequence);

        // Two different sequence keys produce independent nonce lanes
        const lane1 = (1n << 64n) | 0n; // sequenceKey=1, seq=0
        const lane2 = (2n << 64n) | 0n; // sequenceKey=2, seq=0
        expect(lane1).not.toBe(lane2);
        expect(lane1 >> 64n).not.toBe(lane2 >> 64n);

        // Same sequence key, different sequences are in same lane
        const sameLaneA = (5n << 64n) | 0n;
        const sameLaneB = (5n << 64n) | 1n;
        expect(sameLaneA >> 64n).toBe(sameLaneB >> 64n);
        expect(sameLaneA).not.toBe(sameLaneB);
    });

    // ─── Test 1.13: hookData is NOT part of signed hash (OZ L-10, Cantina 3.3.3) ──

    test('1.13 (OZ L-10) hookData is not part of the signed UserOp hash', () => {
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

        // Sign with empty hookData
        const sig1 = account.signUserOperation(userOp, privateKey, 11155111n, {
            hookData: "0x",
        });
        // Sign with non-empty hookData
        const sig2 = account.signUserOperation(userOp, privateKey, 11155111n, {
            hookData: "0xdeadbeef",
        });

        // Different wrapped signatures overall
        expect(sig1).not.toBe(sig2);

        // But the inner ECDSA signature bytes are identical
        // (hookData doesn't affect what is signed)
        const decoded1 = abiCoder.decode(["bytes32", "bytes", "bytes"], sig1);
        const decoded2 = abiCoder.decode(["bytes32", "bytes", "bytes"], sig2);

        expect(decoded1[0]).toBe(decoded2[0]); // same keyHash
        expect(decoded1[1]).toBe(decoded2[1]); // same ECDSA sig
        expect(decoded1[2]).not.toBe(decoded2[2]); // different hookData
    });

    // ─── Test 1.14: createRevokeAllKeysMetaTransactions returns revoke txs for all keys

    test('1.14 createRevokeAllKeysMetaTransactions returns revoke tx for each registered key', async () => {
        const account = new ak.Calibur7702Account("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");

        // Mock listKeys to return two keys
        const secp256k1Key = ak.Calibur7702Account.createSecp256k1Key(
            "0x1234567890abcdef1234567890abcdef12345678"
        );
        const webAuthnKey = ak.Calibur7702Account.createWebAuthnP256Key(
            123456789n,
            987654321n,
        );

        account.listKeys = jest.fn().mockResolvedValue([secp256k1Key, webAuthnKey]);

        const txs = await account.createRevokeAllKeysMetaTransactions("http://mock-rpc");

        expect(txs).toHaveLength(2);

        // Each tx should be a revoke(bytes32) call to address(0)
        const REVOKE_SELECTOR = "0xb75c7dc6";
        const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

        for (let i = 0; i < txs.length; i++) {
            expect(txs[i].to).toBe(ZERO_ADDRESS);
            expect(txs[i].value).toBe(0n);
            expect(txs[i].data.startsWith(REVOKE_SELECTOR)).toBe(true);
        }

        // Verify key hashes match
        const keyHash0 = ak.Calibur7702Account.getKeyHash(secp256k1Key);
        const keyHash1 = ak.Calibur7702Account.getKeyHash(webAuthnKey);

        const decoded0 = abiCoder.decode(["bytes32"], "0x" + txs[0].data.slice(10));
        const decoded1 = abiCoder.decode(["bytes32"], "0x" + txs[1].data.slice(10));

        expect(decoded0[0]).toBe(keyHash0);
        expect(decoded1[0]).toBe(keyHash1);
    });

    test('1.15 createRevokeAllKeysMetaTransactions returns empty array when no keys registered', async () => {
        const account = new ak.Calibur7702Account("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");

        account.listKeys = jest.fn().mockResolvedValue([]);

        const txs = await account.createRevokeAllKeysMetaTransactions("http://mock-rpc");

        expect(txs).toHaveLength(0);
        expect(Array.isArray(txs)).toBe(true);
    });
});
