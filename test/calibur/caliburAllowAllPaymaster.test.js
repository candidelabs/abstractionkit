const ak = require('../../dist/index.umd');
const crypto = require('crypto');
require('dotenv').config();

jest.setTimeout(300000);

// ─── Configuration ──────────────────────────────────────────────────────
let chainId;
const providerRpc = process.env.JSON_RPC_NODE_PROVIDER;
const bundlerRpc = process.env.BUNDLER_URL;
const eoaPrivateKey = process.env.PRIVATE_KEY1;
const eoaAddress = process.env.PUBLIC_ADDRESS1;

// ─── Shared State ───────────────────────────────────────────────────────
let account;
let allowAllPaymaster;
let paymasterInitFields;
let p256KeyPair;
let webAuthnKey;
let keyHash;

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

describe('Calibur7702Account ExperimentalAllowAllParallelPaymaster', () => {

    beforeAll(async () => {
        if (!process.env.CHAIN_ID || !providerRpc || !bundlerRpc || !eoaPrivateKey || !eoaAddress) {
            throw new Error(
                'Missing required env vars: CHAIN_ID, JSON_RPC_NODE_PROVIDER, BUNDLER_URL, PRIVATE_KEY1, PUBLIC_ADDRESS1. See .env.example.'
            );
        }
        chainId = BigInt(process.env.CHAIN_ID);
        account = new ak.Calibur7702Account(eoaAddress, {
            entrypointAddress: ak.ak.ENTRYPOINT_V9,
            delegateeAddress: ak.CALIBUR_CANDIDE_V0_1_0_SINGLETON_ADDRESS,
        });
        allowAllPaymaster = new ak.ExperimentalAllowAllParallelPaymaster();
        paymasterInitFields = await allowAllPaymaster.getPaymasterFieldsInitValues(chainId);
    });

    // ─── 6.1: ExperimentalAllowAllParallelPaymaster init values ──────────────────────────────

    test('6.1 getPaymasterFieldsInitValues returns correct structure', () => {
        expect(paymasterInitFields.paymaster).toBe("0x36A337b8b4cE5CF6ca1dDaeef73Da4928d714DF2");
        expect(paymasterInitFields.paymasterVerificationGasLimit).toBe(45_000n);
        expect(paymasterInitFields.paymasterPostOpGasLimit).toBe(45_000n);
        expect(paymasterInitFields.paymasterData).toBe("0x22e325a297439656");
    });

    // ─── 6.2: ExperimentalAllowAllParallelPaymaster approved data ────────────────────────────

    test('6.2 getApprovedPaymasterData returns magic signature', async () => {
        // Minimal UserOp stub — no network call needed
        const userOp = { sender: eoaAddress, nonce: 0n, callData: '0x' };

        const paymasterData = await allowAllPaymaster.getApprovedPaymasterData(userOp);
        expect(paymasterData).toBe(
            "0x7603fbcd3c6cebdb7193b716f62fe7e9d4afd859df4bf7fcdb2e9d486f57a1ca" +
            "0020" +
            "22e325a297439656"
        );
    });

    // ─── 6.3: Sponsored delegation with ExperimentalAllowAllParallelPaymaster ─────────────────

    test('6.3 delegation + transfer sponsored by ExperimentalAllowAllParallelPaymaster', async () => {
        // Pass paymasterFields in overrides — gas estimation includes paymaster data
        const userOp = await account.createUserOperation(
            [{ to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', value: 0n, data: '0x' }],
            providerRpc,
            bundlerRpc,
            { eip7702Auth: { chainId }, paymasterFields: paymasterInitFields },
        );

        // Sign 7702 delegation
        userOp.eip7702Auth = ak.createAndSignEip7702DelegationAuthorization(
            BigInt(userOp.eip7702Auth.chainId),
            userOp.eip7702Auth.address,
            BigInt(userOp.eip7702Auth.nonce),
            eoaPrivateKey,
        );

        // Sign UserOp — paymaster signature is excluded from userOpHash in v0.9
        userOp.signature = account.signUserOperation(userOp, eoaPrivateKey, chainId);

        // Set approved paymaster data AFTER signing (parallel signing in v0.9)
        userOp.paymasterData = await allowAllPaymaster.getApprovedPaymasterData(userOp);

        const receipt = await sendAndWait(account, userOp, bundlerRpc);
        expect(receipt).not.toBeNull();
        expect(receipt.success).toBe(true);
    });

    // ─── 6.4: Regular transfer sponsored by ExperimentalAllowAllParallelPaymaster ─────────────

    test('6.4 regular transfer sponsored by ExperimentalAllowAllParallelPaymaster', async () => {
        const userOp = await account.createUserOperation(
            [{ to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', value: 0n, data: '0x' }],
            providerRpc,
            bundlerRpc,
            { paymasterFields: paymasterInitFields },
        );

        userOp.signature = account.signUserOperation(userOp, eoaPrivateKey, chainId);
        userOp.paymasterData = await allowAllPaymaster.getApprovedPaymasterData(userOp);

        const receipt = await sendAndWait(account, userOp, bundlerRpc);
        expect(receipt.success).toBe(true);
    });

    // ─── 6.5: Batch transaction sponsored by ExperimentalAllowAllParallelPaymaster ────────────

    test('6.5 batch transaction sponsored by ExperimentalAllowAllParallelPaymaster', async () => {
        const userOp = await account.createUserOperation(
            [
                { to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', value: 0n, data: '0x' },
                { to: '0x1111111111111111111111111111111111111111', value: 0n, data: '0x' },
            ],
            providerRpc,
            bundlerRpc,
            { paymasterFields: paymasterInitFields },
        );

        userOp.signature = account.signUserOperation(userOp, eoaPrivateKey, chainId);
        userOp.paymasterData = await allowAllPaymaster.getApprovedPaymasterData(userOp);

        const receipt = await sendAndWait(account, userOp, bundlerRpc);
        expect(receipt.success).toBe(true);
    });

    // ─── 6.6: Passkey registration sponsored by ExperimentalAllowAllParallelPaymaster ─────────

    test('6.6 passkey registration sponsored by ExperimentalAllowAllParallelPaymaster', async () => {
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
            { paymasterFields: paymasterInitFields },
        );

        userOp.signature = account.signUserOperation(userOp, eoaPrivateKey, chainId);
        userOp.paymasterData = await allowAllPaymaster.getApprovedPaymasterData(userOp);

        const receipt = await sendAndWait(account, userOp, bundlerRpc);
        expect(receipt.success).toBe(true);

        const isRegistered = await account.isKeyRegistered(providerRpc, keyHash);
        expect(isRegistered).toBe(true);
    });

    // ─── 6.7: Passkey-signed UserOp sponsored by ExperimentalAllowAllParallelPaymaster ────────

    test('6.7 passkey-signed UserOp sponsored by ExperimentalAllowAllParallelPaymaster', async () => {
        const dummyWebAuthnSig = ak.Calibur7702Account.createDummyWebAuthnSignature(keyHash);

        const userOp = await account.createUserOperation(
            [{ to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', value: 0n, data: '0x' }],
            providerRpc,
            bundlerRpc,
            { dummySignature: dummyWebAuthnSig, paymasterFields: paymasterInitFields },
        );

        // Sign with passkey — userOpHash excludes paymaster signature in v0.9
        const userOpHash = ak.createUserOperationHash(userOp, ak.ENTRYPOINT_V9, chainId);
        userOp.signature = buildWebAuthnSignature(
            account, keyHash, userOpHash, p256KeyPair.privateKey,
        );

        // Set approved paymaster data after signing
        userOp.paymasterData = await allowAllPaymaster.getApprovedPaymasterData(userOp);

        const receipt = await sendAndWait(account, userOp, bundlerRpc);
        expect(receipt.success).toBe(true);
    });

    // ─── 6.8: Key revocation sponsored by ExperimentalAllowAllParallelPaymaster ───────────────

    test('6.8 key revocation sponsored by ExperimentalAllowAllParallelPaymaster', async () => {
        const revokeTx = ak.Calibur7702Account.createRevokeKeyMetaTransaction(keyHash);

        const userOp = await account.createUserOperation(
            [revokeTx],
            providerRpc,
            bundlerRpc,
            { paymasterFields: paymasterInitFields },
        );

        userOp.signature = account.signUserOperation(userOp, eoaPrivateKey, chainId);
        userOp.paymasterData = await allowAllPaymaster.getApprovedPaymasterData(userOp);

        const receipt = await sendAndWait(account, userOp, bundlerRpc);
        expect(receipt.success).toBe(true);

        const isRegistered = await account.isKeyRegistered(providerRpc, keyHash);
        expect(isRegistered).toBe(false);
    });

    // ─── 6.9: Custom ExperimentalAllowAllParallelPaymaster address ────────────────────────────

    test('6.9 custom paymaster address is accepted', async () => {
        const customAddress = "0x1234567890abcdef1234567890abcdef12345678";
        const custom = new ak.ExperimentalAllowAllParallelPaymaster(customAddress);

        const fields = await custom.getPaymasterFieldsInitValues(chainId);
        expect(fields.paymaster).toBe(customAddress);
        expect(fields.paymasterData).toBe("0x22e325a297439656");
        expect(fields.paymasterVerificationGasLimit).toBe(45_000n);
    });
});
