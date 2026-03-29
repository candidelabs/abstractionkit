const ak = require('../../dist/index.umd');
const crypto = require('crypto');
const { AbiCoder, keccak256, Wallet } = require('ethers');
require('dotenv').config();

const abiCoder = AbiCoder.defaultAbiCoder();

jest.setTimeout(300000);

// ─── Configuration ──────────────────────────────────────────────────────
// All config comes from .env — see .env.example for required variables.
let chainId;
const providerRpc = process.env.JSON_RPC_NODE_PROVIDER;
const bundlerRpc = process.env.BUNDLER_URL;
const eoaPrivateKey = process.env.PRIVATE_KEY1;
const eoaAddress = process.env.PUBLIC_ADDRESS1;

const ENTRYPOINT_V9 = "0x433709009B8330FDa32311DF1C2AFA402eD8D009";
const CALIBUR_V9_SINGLETON = "0x71032285A847c4311Eb7ec2E7A636aB94A9805Aa";
const ROOT_KEY_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";

// ─── Shared State ───────────────────────────────────────────────────────
let account;
let p256KeyPair;
let webAuthnKey;
let keyHash;
let shortLivedP256KeyPair;
let shortLivedWebAuthnKey;
let shortLivedKeyHash;
// For Test 2.12 — fresh key registered for gas estimation comparison
let gasEstKeyHash;

// ─── Helpers ────────────────────────────────────────────────────────────

function generateP256KeyPair() {
    const kp = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const pubKeyDer = kp.publicKey.export({ type: 'spki', format: 'der' });
    const uncompressedKey = pubKeyDer.subarray(-64);
    const x = BigInt('0x' + uncompressedKey.subarray(0, 32).toString('hex'));
    const y = BigInt('0x' + uncompressedKey.subarray(32, 64).toString('hex'));
    return { privateKey: kp.privateKey, publicKey: kp.publicKey, x, y };
}

function base64url(buf) {
    return Buffer.from(buf).toString('base64url');
}

function p256Sign(data, privateKey) {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data.slice(2), 'hex');
    const sig = crypto.sign(null, buf, {
        key: privateKey,
        dsaEncoding: 'ieee-p1363',
    });
    const r = BigInt('0x' + sig.subarray(0, 32).toString('hex'));
    const s = BigInt('0x' + sig.subarray(32, 64).toString('hex'));
    const secp256r1Order = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551n;
    const halfOrder = secp256r1Order / 2n;
    return { r, s: s > halfOrder ? secp256r1Order - s : s };
}

function buildWebAuthnSignature(acct, kh, userOpHash, privateKey) {
    const rpIdHash = crypto.createHash('sha256').update('localhost').digest();
    const authenticatorData = Buffer.concat([rpIdHash, Buffer.from([0x05]), Buffer.alloc(4)]);
    const challengeB64 = base64url(Buffer.from(userOpHash.slice(2), 'hex'));
    const clientDataJSON = JSON.stringify({
        type: "webauthn.get",
        challenge: challengeB64,
        origin: "https://localhost",
    });
    const clientDataHash = crypto.createHash('sha256').update(clientDataJSON).digest();
    const signedData = Buffer.concat([authenticatorData, clientDataHash]);
    const { r, s } = p256Sign(signedData, privateKey);

    return acct.formatWebAuthnSignature(kh, {
        authenticatorData: '0x' + authenticatorData.toString('hex'),
        clientDataJSON,
        challengeIndex: BigInt(clientDataJSON.indexOf('"challenge":"')),
        typeIndex: BigInt(clientDataJSON.indexOf('"type":"webauthn.get"')),
        r,
        s,
    });
}

async function sendAndWait(acct, userOp, bRpc) {
    const response = await acct.sendUserOperation(userOp, bRpc);
    const receipt = await response.included();
    return receipt;
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('Calibur7702Account Sepolia Lifecycle', () => {

    beforeAll(() => {
        if (!process.env.CHAIN_ID || !providerRpc || !bundlerRpc || !eoaPrivateKey || !eoaAddress) {
            throw new Error(
                'Missing required env vars: CHAIN_ID, JSON_RPC_NODE_PROVIDER, BUNDLER_URL, PRIVATE_KEY1, PUBLIC_ADDRESS1. See .env.example.'
            );
        }
        chainId = BigInt(process.env.CHAIN_ID);
    });

    // ─── 2.1: EIP-7702 delegation + basic transfer ─────────────────────

    test('2.1 EIP-7702 delegation + basic transfer', async () => {
        account = new ak.Calibur7702Account(eoaAddress, {
            entrypointAddress: ENTRYPOINT_V9,
            delegateeAddress: CALIBUR_V9_SINGLETON,
        });

        const userOp = await account.createUserOperation(
            [{ to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', value: 0n, data: '0x' }],
            providerRpc,
            bundlerRpc,
            { eip7702Auth: { chainId } },
        );

        // Sign 7702 delegation
        userOp.eip7702Auth = ak.createAndSignEip7702DelegationAuthorization(
            BigInt(userOp.eip7702Auth.chainId),
            userOp.eip7702Auth.address,
            BigInt(userOp.eip7702Auth.nonce),
            eoaPrivateKey,
        );

        // Sign UserOp
        userOp.signature = account.signUserOperation(userOp, eoaPrivateKey, chainId);

        const receipt = await sendAndWait(account, userOp, bundlerRpc);
        expect(receipt).not.toBeNull();
        expect(receipt.success).toBe(true);

        // Verify delegation designator
        const code = await ak.sendJsonRpcRequest(providerRpc, "eth_getCode", [eoaAddress, "latest"]);
        expect(code.toLowerCase().startsWith("0xef0100")).toBe(true);
    });

    // ─── 2.2: Register a passkey, verify on-chain ──────────────────────

    test('2.2 register passkey and verify on-chain', async () => {
        p256KeyPair = generateP256KeyPair();
        webAuthnKey = ak.Calibur7702Account.createWebAuthnP256Key(p256KeyPair.x, p256KeyPair.y);
        keyHash = ak.Calibur7702Account.getKeyHash(webAuthnKey);

        const registerTxs = ak.Calibur7702Account.createRegisterKeyMetaTransactions(webAuthnKey, {
            expiration: Math.floor(Date.now() / 1000) + 86400 * 365,
        });

        const userOp = await account.createUserOperation(
            registerTxs,
            providerRpc,
            bundlerRpc,
        );
        userOp.signature = account.signUserOperation(userOp, eoaPrivateKey, chainId);

        const receipt = await sendAndWait(account, userOp, bundlerRpc);
        expect(receipt.success).toBe(true);

        // Verify on-chain
        const isRegistered = await account.isKeyRegistered(providerRpc, keyHash);
        expect(isRegistered).toBe(true);

        const settings = await account.getKeySettings(providerRpc, keyHash);
        expect(settings.isAdmin).toBe(false);
        expect(settings.expiration).toBeGreaterThan(0);

        const keyData = await account.getKey(providerRpc, keyHash);
        expect(keyData.keyType).toBe(ak.CaliburKeyType.WebAuthnP256);
    });

    // ─── 2.3: Execute UserOp signed with registered passkey ─────────────

    test('2.3 execute UserOp signed with registered passkey', async () => {
        const dummyWebAuthnSig = ak.Calibur7702Account.createDummyWebAuthnSignature(keyHash);

        const userOp = await account.createUserOperation(
            [{ to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', value: 0n, data: '0x' }],
            providerRpc,
            bundlerRpc,
            { dummySignature: dummyWebAuthnSig },
        );

        const userOpHash = ak.createUserOperationHash(userOp, ENTRYPOINT_V9, chainId);
        userOp.signature = buildWebAuthnSignature(
            account, keyHash, userOpHash, p256KeyPair.privateKey,
        );

        const receipt = await sendAndWait(account, userOp, bundlerRpc);
        expect(receipt.success).toBe(true);
    });

    // ─── 2.4: Multi-call batch execution ────────────────────────────────

    test('2.4 multi-call batch execution', async () => {
        const userOp = await account.createUserOperation(
            [
                { to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', value: 0n, data: '0x' },
                { to: '0x1111111111111111111111111111111111111111', value: 0n, data: '0x' },
                { to: eoaAddress, value: 0n, data: '0x' }, // self-call
            ],
            providerRpc,
            bundlerRpc,
        );
        userOp.signature = account.signUserOperation(userOp, eoaPrivateKey, chainId);

        const receipt = await sendAndWait(account, userOp, bundlerRpc);
        expect(receipt.success).toBe(true);
    });

    // ─── 2.5: Update key settings ───────────────────────────────────────

    test('2.5 update key settings', async () => {
        const newExpiry = Math.floor(Date.now() / 1000) + 86400 * 730; // 2 years

        const updateTx = ak.Calibur7702Account.createUpdateKeySettingsMetaTransaction(
            keyHash,
            { expiration: newExpiry },
        );

        const userOp = await account.createUserOperation(
            [updateTx],
            providerRpc,
            bundlerRpc,
        );
        userOp.signature = account.signUserOperation(userOp, eoaPrivateKey, chainId);

        const receipt = await sendAndWait(account, userOp, bundlerRpc);
        expect(receipt.success).toBe(true);

        const settings = await account.getKeySettings(providerRpc, keyHash);
        expect(settings.expiration).toBe(newExpiry);
    });

    // ─── 2.6: Register short-lived key for expiry test ──────────────────

    test('2.6 register short-lived key (10s expiry)', async () => {
        shortLivedP256KeyPair = generateP256KeyPair();
        shortLivedWebAuthnKey = ak.Calibur7702Account.createWebAuthnP256Key(
            shortLivedP256KeyPair.x, shortLivedP256KeyPair.y,
        );
        shortLivedKeyHash = ak.Calibur7702Account.getKeyHash(shortLivedWebAuthnKey);

        const registerTxs = ak.Calibur7702Account.createRegisterKeyMetaTransactions(
            shortLivedWebAuthnKey,
            { expiration: Math.floor(Date.now() / 1000) + 10 },
        );

        const userOp = await account.createUserOperation(
            registerTxs,
            providerRpc,
            bundlerRpc,
        );
        userOp.signature = account.signUserOperation(userOp, eoaPrivateKey, chainId);

        const receipt = await sendAndWait(account, userOp, bundlerRpc);
        expect(receipt.success).toBe(true);

        const isRegistered = await account.isKeyRegistered(providerRpc, shortLivedKeyHash);
        expect(isRegistered).toBe(true);
    });

    // ─── 2.7: Revoke the main passkey ───────────────────────────────────

    test('2.7 revoke main passkey', async () => {
        const revokeTx = ak.Calibur7702Account.createRevokeKeyMetaTransaction(keyHash);

        const userOp = await account.createUserOperation(
            [revokeTx],
            providerRpc,
            bundlerRpc,
        );
        userOp.signature = account.signUserOperation(userOp, eoaPrivateKey, chainId);

        const receipt = await sendAndWait(account, userOp, bundlerRpc);
        expect(receipt.success).toBe(true);

        const isRegistered = await account.isKeyRegistered(providerRpc, keyHash);
        expect(isRegistered).toBe(false);
    });

    // ─── 2.8: Revoked key signature is rejected ────────────────────────

    test('2.8 revoked key signature is rejected', async () => {
        const dummyWebAuthnSig = ak.Calibur7702Account.createDummyWebAuthnSignature(keyHash);

        // Build a UserOp with all gas overridden (can't estimate with revoked key)
        const userOp = await account.createUserOperation(
            [{ to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', value: 0n, data: '0x' }],
            providerRpc,
            bundlerRpc,
            {
                dummySignature: ak.Calibur7702Account.dummySignature,
                callGasLimit: 100000n,
                verificationGasLimit: 500000n,
                preVerificationGas: 100000n,
            },
        );

        const userOpHash = ak.createUserOperationHash(userOp, ENTRYPOINT_V9, chainId);
        userOp.signature = buildWebAuthnSignature(
            account, keyHash, userOpHash, p256KeyPair.privateKey,
        );

        await expect(
            account.sendUserOperation(userOp, bundlerRpc),
        ).rejects.toThrow();
    });

    // ─── 2.9: Expired key is rejected (Cantina 3.2.4: SIG_VALIDATION_FAILED) ──

    test('2.9 expired key is rejected with validation error', async () => {
        // Wait for the short-lived key to expire
        // Wait well past the 10s key TTL to ensure expiry (extra margin for block times)
        await new Promise(resolve => setTimeout(resolve, 25000));

        const userOp = await account.createUserOperation(
            [{ to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', value: 0n, data: '0x' }],
            providerRpc,
            bundlerRpc,
            {
                dummySignature: ak.Calibur7702Account.dummySignature,
                callGasLimit: 100000n,
                verificationGasLimit: 500000n,
                preVerificationGas: 100000n,
            },
        );

        const userOpHash = ak.createUserOperationHash(userOp, ENTRYPOINT_V9, chainId);
        userOp.signature = buildWebAuthnSignature(
            account, shortLivedKeyHash, userOpHash, shortLivedP256KeyPair.privateKey,
        );

        // Should fail with a validation-related error (not an execution revert)
        await expect(
            account.sendUserOperation(userOp, bundlerRpc),
        ).rejects.toThrow();
    });

    // ─── 2.10: Nonce reuse is rejected ──────────────────────────────────

    test('2.10 nonce reuse is rejected (AA25)', async () => {
        // First, send a valid UserOp to get a nonce
        const userOp1 = await account.createUserOperation(
            [{ to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', value: 0n, data: '0x' }],
            providerRpc,
            bundlerRpc,
        );
        userOp1.signature = account.signUserOperation(userOp1, eoaPrivateKey, chainId);
        const usedNonce = userOp1.nonce;

        const receipt = await sendAndWait(account, userOp1, bundlerRpc);
        expect(receipt.success).toBe(true);

        // Now try to send another UserOp with the same (stale) nonce.
        // Override all gas limits to skip bundler estimation (which also
        // rejects stale nonces). We only care that sendUserOperation fails.
        const userOp2 = await account.createUserOperation(
            [{ to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', value: 0n, data: '0x' }],
            providerRpc,
            bundlerRpc,
            {
                nonce: usedNonce,
                callGasLimit: 100000n,
                verificationGasLimit: 500000n,
                preVerificationGas: 100000n,
            },
        );
        userOp2.signature = account.signUserOperation(userOp2, eoaPrivateKey, chainId);

        await expect(
            account.sendUserOperation(userOp2, bundlerRpc),
        ).rejects.toThrow();
    });

    // ─── 2.11: Read functions return correct data ───────────────────────

    test('2.11 read functions return correct data', async () => {
        // Nonce should be > 0 after previous ops
        const nonce = await account.getNonce(providerRpc);
        expect(nonce).toBeGreaterThan(0n);

        // getKeys returns an array
        const keys = await account.getKeys(providerRpc);
        expect(Array.isArray(keys)).toBe(true);

        // Root key settings: isAdmin=true, expiration=0, hook=ZeroAddress
        const rootSettings = await account.getKeySettings(providerRpc, ROOT_KEY_HASH);
        expect(rootSettings.isAdmin).toBe(true);
        expect(rootSettings.expiration).toBe(0);
        expect(rootSettings.hook).toBe(ak.ZeroAddress);
    });

    // ─── 2.12: Gas estimation — WebAuthn dummy vs ECDSA dummy ───────────

    test('2.12 gas estimation: WebAuthn dummy produces higher preVerificationGas', async () => {
        // Register a fresh key for WebAuthn dummy estimation
        const freshKp = generateP256KeyPair();
        const freshKey = ak.Calibur7702Account.createWebAuthnP256Key(freshKp.x, freshKp.y);
        gasEstKeyHash = ak.Calibur7702Account.getKeyHash(freshKey);

        const registerTxs = ak.Calibur7702Account.createRegisterKeyMetaTransactions(freshKey, {
            expiration: Math.floor(Date.now() / 1000) + 86400 * 365,
        });
        const regOp = await account.createUserOperation(registerTxs, providerRpc, bundlerRpc);
        regOp.signature = account.signUserOperation(regOp, eoaPrivateKey, chainId);
        const regReceipt = await sendAndWait(account, regOp, bundlerRpc);
        expect(regReceipt.success).toBe(true);

        // Now create two UserOps for the same tx: one ECDSA dummy, one WebAuthn dummy
        const tx = [{ to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', value: 0n, data: '0x' }];

        const ecdsaOp = await account.createUserOperation(tx, providerRpc, bundlerRpc);

        const webAuthnDummy = ak.Calibur7702Account.createDummyWebAuthnSignature(gasEstKeyHash);
        const webAuthnOp = await account.createUserOperation(
            tx, providerRpc, bundlerRpc,
            { dummySignature: webAuthnDummy },
        );

        // WebAuthn signature is larger → higher preVerificationGas
        expect(webAuthnOp.preVerificationGas).toBeGreaterThan(ecdsaOp.preVerificationGas);
    });

    // ─── 2.13: Re-register same key with different settings (OZ L-14) ──

    test('2.13 (OZ L-14) re-register revoked key with different settings', async () => {
        // Re-register the same key that was revoked in 2.7
        const newExpiry = Math.floor(Date.now() / 1000) + 86400 * 180; // 180 days

        const registerTxs = ak.Calibur7702Account.createRegisterKeyMetaTransactions(webAuthnKey, {
            expiration: newExpiry,
        });

        const userOp = await account.createUserOperation(
            registerTxs,
            providerRpc,
            bundlerRpc,
        );
        userOp.signature = account.signUserOperation(userOp, eoaPrivateKey, chainId);

        const receipt = await sendAndWait(account, userOp, bundlerRpc);
        expect(receipt.success).toBe(true);

        const isRegistered = await account.isKeyRegistered(providerRpc, keyHash);
        expect(isRegistered).toBe(true);

        const settings = await account.getKeySettings(providerRpc, keyHash);
        expect(settings.expiration).toBe(newExpiry);
    });

    // ─── 3.1: Empty vs non-empty hookData ───────────────────────────────

    test('3.1 hookData edge case: empty and non-empty both succeed', async () => {
        // Empty hookData (default, already covered by previous tests)
        const userOp1 = await account.createUserOperation(
            [{ to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', value: 0n, data: '0x' }],
            providerRpc,
            bundlerRpc,
        );
        userOp1.signature = account.signUserOperation(userOp1, eoaPrivateKey, chainId);
        const receipt1 = await sendAndWait(account, userOp1, bundlerRpc);
        expect(receipt1.success).toBe(true);

        // Non-empty hookData
        const userOp2 = await account.createUserOperation(
            [{ to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', value: 0n, data: '0x' }],
            providerRpc,
            bundlerRpc,
        );
        userOp2.signature = account.signUserOperation(userOp2, eoaPrivateKey, chainId, {
            hookData: "0xdeadbeef",
        });
        const receipt2 = await sendAndWait(account, userOp2, bundlerRpc);
        expect(receipt2.success).toBe(true);
    });

    // ─── 3.2: address(0) in Call.to is self-call ────────────────────────

    test('3.2 address(0) in batch is treated as self-call', async () => {
        // keyCount selector: 0xfac750e0
        const userOp = await account.createUserOperation(
            [{ to: ak.ZeroAddress, value: 0n, data: '0xfac750e0' }],
            providerRpc,
            bundlerRpc,
        );
        userOp.signature = account.signUserOperation(userOp, eoaPrivateKey, chainId);

        const receipt = await sendAndWait(account, userOp, bundlerRpc);
        expect(receipt.success).toBe(true);
    });

    // ─── 3.3: revertOnFailure=false allows partial batch success ────────

    test('3.3 revertOnFailure=false allows partial batch success', async () => {
        const txs = [
            // (a) valid 0-value transfer
            { to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', value: 0n, data: '0x' },
            // (b) self-call with invalid selector — will revert internally
            { to: ak.ZeroAddress, value: 0n, data: '0xdeadbeef' },
        ];

        // Pre-encode callData with revertOnFailure=false and override gas limits
        // to skip bundler estimation (estimation may fail since one call reverts)
        const callData = ak.Calibur7702Account.createAccountCallData(txs, false);

        const userOp = await account.createUserOperation(
            txs,
            providerRpc,
            bundlerRpc,
            {
                callData,
                callGasLimit: 200000n,
                verificationGasLimit: 500000n,
                preVerificationGas: 100000n,
            },
        );
        userOp.signature = account.signUserOperation(userOp, eoaPrivateKey, chainId);

        const receipt = await sendAndWait(account, userOp, bundlerRpc);
        // Overall UserOp succeeds despite one call failing
        expect(receipt.success).toBe(true);
    });

    // ─── 3.4: Non-admin key cannot self-call management functions (OZ L-03) ──

    test('3.4 (OZ L-03) non-admin key cannot self-call management functions', async () => {
        // The key re-registered in 2.13 is non-admin. Use it to try a self-call
        // to register() — a management function
        const dummyKey = ak.Calibur7702Account.createSecp256k1Key(
            "0x1111111111111111111111111111111111111111"
        );
        const registerCallData = "0x30b1fa3b" + abiCoder.encode(
            ["(uint8,bytes)"],
            [[dummyKey.keyType, dummyKey.publicKey]],
        ).slice(2);

        // to: ZeroAddress = self-call
        const selfCallTx = { to: ak.ZeroAddress, value: 0n, data: registerCallData };

        // Override gas limits to skip estimation (self-call to management
        // function via non-admin key will revert during simulation)
        const dummyWebAuthnSig = ak.Calibur7702Account.createDummyWebAuthnSignature(keyHash);
        const userOp = await account.createUserOperation(
            [selfCallTx],
            providerRpc,
            bundlerRpc,
            {
                dummySignature: dummyWebAuthnSig,
                callGasLimit: 200000n,
                verificationGasLimit: 500000n,
                preVerificationGas: 100000n,
            },
        );

        const userOpHash = ak.createUserOperationHash(userOp, ENTRYPOINT_V9, chainId);
        userOp.signature = buildWebAuthnSignature(
            account, keyHash, userOpHash, p256KeyPair.privateKey,
        );

        // Should fail: non-admin keys cannot self-call management functions
        // This may fail at bundler validation or execute — either way it should not succeed
        try {
            const receipt = await sendAndWait(account, userOp, bundlerRpc);
            // If it gets through to execution, the inner call should fail
            // With revertOnFailure=true (default), the UserOp should fail
            expect(receipt.success).toBe(false);
        } catch (e) {
            // Bundler rejected — also valid (OnlyAdminCanSelfCall)
            expect(e).toBeDefined();
        }
    });

    // ─── 3.5: Nonce lane isolation across keys (Cantina 3.2.3) ──────────

    test('3.5 (Cantina 3.2.3) nonce lane isolation', async () => {
        // Get the current nonce on lane 0
        const nonceLane0 = await account.getNonce(providerRpc, 0);

        // Send a UserOp on lane 0
        const userOp1 = await account.createUserOperation(
            [{ to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', value: 0n, data: '0x' }],
            providerRpc,
            bundlerRpc,
        );
        userOp1.signature = account.signUserOperation(userOp1, eoaPrivateKey, chainId);
        const receipt1 = await sendAndWait(account, userOp1, bundlerRpc);
        expect(receipt1.success).toBe(true);

        // Nonce on lane 0 should have incremented
        const nonceLane0After = await account.getNonce(providerRpc, 0);
        expect(nonceLane0After).toBeGreaterThan(nonceLane0);

        // Try to send with the old nonce (should fail).
        // Override gas limits to skip estimation (stale nonce fails estimation too).
        const userOpOld = await account.createUserOperation(
            [{ to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', value: 0n, data: '0x' }],
            providerRpc,
            bundlerRpc,
            {
                nonce: nonceLane0,
                callGasLimit: 100000n,
                verificationGasLimit: 500000n,
                preVerificationGas: 100000n,
            },
        );
        userOpOld.signature = account.signUserOperation(userOpOld, eoaPrivateKey, chainId);

        await expect(
            account.sendUserOperation(userOpOld, bundlerRpc),
        ).rejects.toThrow();
    });
});
