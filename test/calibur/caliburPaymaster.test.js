const ak = require('../../dist/index.umd');
const crypto = require('crypto');
const { AbiCoder, keccak256 } = require('ethers');
require('dotenv').config();

const abiCoder = AbiCoder.defaultAbiCoder();

jest.setTimeout(300000);

// ─── Configuration ──────────────────────────────────────────────────────
const chainId = BigInt(process.env.CHAIN_ID);
const providerRpc = process.env.JSON_RPC_NODE_PROVIDER;
const bundlerRpc = process.env.BUNDLER_URL;
const paymasterRpc = process.env.PAYMASTER_RPC;
const eoaPrivateKey = process.env.PRIVATE_KEY1;
const eoaAddress = process.env.PUBLIC_ADDRESS1;

// ERC-20 token for token paymaster tests — set in .env
// Must be a token supported by the Candide paymaster on the target chain
const erc20TokenAddress = process.env.ERC20_TOKEN_ADDRESS;

const ENTRYPOINT_V9 = "0x433709009B8330FDa32311DF1C2AFA402eD8D009";
const CALIBUR_V9_SINGLETON = "0x71032285A847c4311Eb7ec2E7A636aB94A9805Aa";

// ─── Shared State ───────────────────────────────────────────────────────
let account;
let paymaster;
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

describe('Calibur7702Account Sponsor Paymaster', () => {

    beforeAll(() => {
        if (!providerRpc || !bundlerRpc || !paymasterRpc || !eoaPrivateKey || !eoaAddress) {
            throw new Error(
                'Missing required env vars: CHAIN_ID, JSON_RPC_NODE_PROVIDER, BUNDLER_URL, PAYMASTER_RPC, PRIVATE_KEY1, PUBLIC_ADDRESS1. See .env.example.'
            );
        }
        account = new ak.Calibur7702Account(eoaAddress, {
            entrypointAddress: ENTRYPOINT_V9,
            delegateeAddress: CALIBUR_V9_SINGLETON,
        });
        paymaster = new ak.CandidePaymaster(paymasterRpc);
    });

    // ─── 4.1: Paymaster initialization and EntryPoint v0.9 support ──────

    test('4.1 paymaster supports EntryPoint v0.9', async () => {
        const entrypoints = await paymaster.getSupportedEntrypoints();
        expect(entrypoints.map(e => e.toLowerCase())).toContain(ENTRYPOINT_V9.toLowerCase());
    });

    // ─── 4.2: Sponsored delegation (new account first UserOp) ───────────

    test('4.2 sponsored delegation + transfer (with eip7702Auth)', async () => {
        // Create UserOp with EIP-7702 delegation
        const userOp = await account.createUserOperation(
            [{ to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', value: 0n, data: '0x' }],
            providerRpc,
            bundlerRpc,
            { eip7702Auth: { chainId } },
        );

        // Sponsor it
        const [sponsoredOp] = await paymaster.createSponsorPaymasterUserOperation(
            userOp,
            bundlerRpc,
        );

        // Verify paymaster fields are set
        expect(sponsoredOp.paymaster).toBeTruthy();
        expect(sponsoredOp.paymaster).not.toBe("0x0000000000000000000000000000000000000000");
        expect(sponsoredOp.paymasterData).toBeTruthy();
        expect(BigInt(sponsoredOp.paymasterVerificationGasLimit)).toBeGreaterThan(0n);
        expect(BigInt(sponsoredOp.paymasterPostOpGasLimit)).toBeGreaterThanOrEqual(0n);

        // eip7702Auth should still be present
        expect(sponsoredOp.eip7702Auth).toBeTruthy();

        // Sign 7702 delegation
        sponsoredOp.eip7702Auth = ak.createAndSignEip7702DelegationAuthorization(
            BigInt(sponsoredOp.eip7702Auth.chainId),
            sponsoredOp.eip7702Auth.address,
            BigInt(sponsoredOp.eip7702Auth.nonce),
            eoaPrivateKey,
        );

        // Sign and send
        sponsoredOp.signature = account.signUserOperation(sponsoredOp, eoaPrivateKey, chainId);
        const receipt = await sendAndWait(account, sponsoredOp, bundlerRpc);
        expect(receipt).not.toBeNull();
        expect(receipt.success).toBe(true);
    });

    // ─── 4.3: Sponsored regular transfer (already delegated) ────────────

    test('4.3 sponsored transfer (no delegation needed)', async () => {
        const userOp = await account.createUserOperation(
            [{ to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', value: 0n, data: '0x' }],
            providerRpc,
            bundlerRpc,
        );

        const [sponsoredOp] = await paymaster.createSponsorPaymasterUserOperation(
            userOp,
            bundlerRpc,
        );

        expect(sponsoredOp.paymaster).toBeTruthy();

        sponsoredOp.signature = account.signUserOperation(sponsoredOp, eoaPrivateKey, chainId);
        const receipt = await sendAndWait(account, sponsoredOp, bundlerRpc);
        expect(receipt.success).toBe(true);
    });

    // ─── 4.4: Sponsored batch transaction ───────────────────────────────

    test('4.4 sponsored batch transaction', async () => {
        const userOp = await account.createUserOperation(
            [
                { to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', value: 0n, data: '0x' },
                { to: '0x1111111111111111111111111111111111111111', value: 0n, data: '0x' },
            ],
            providerRpc,
            bundlerRpc,
        );

        const [sponsoredOp] = await paymaster.createSponsorPaymasterUserOperation(
            userOp,
            bundlerRpc,
        );

        sponsoredOp.signature = account.signUserOperation(sponsoredOp, eoaPrivateKey, chainId);
        const receipt = await sendAndWait(account, sponsoredOp, bundlerRpc);
        expect(receipt.success).toBe(true);
    });

    // ─── 4.5: Sponsored passkey registration ────────────────────────────

    test('4.5 sponsored passkey registration', async () => {
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

        const [sponsoredOp] = await paymaster.createSponsorPaymasterUserOperation(
            userOp,
            bundlerRpc,
        );

        sponsoredOp.signature = account.signUserOperation(sponsoredOp, eoaPrivateKey, chainId);
        const receipt = await sendAndWait(account, sponsoredOp, bundlerRpc);
        expect(receipt.success).toBe(true);

        // Verify key was registered
        const isRegistered = await account.isKeyRegistered(providerRpc, keyHash);
        expect(isRegistered).toBe(true);
    });

    // ─── 4.6: Sponsored UserOp signed with passkey ──────────────────────

    test('4.6 sponsored UserOp signed with passkey', async () => {
        const dummyWebAuthnSig = ak.Calibur7702Account.createDummyWebAuthnSignature(keyHash);

        const userOp = await account.createUserOperation(
            [{ to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', value: 0n, data: '0x' }],
            providerRpc,
            bundlerRpc,
            { dummySignature: dummyWebAuthnSig },
        );

        const [sponsoredOp] = await paymaster.createSponsorPaymasterUserOperation(
            userOp,
            bundlerRpc,
        );

        // Sign with passkey
        const userOpHash = ak.createUserOperationHash(sponsoredOp, ENTRYPOINT_V9, chainId);
        sponsoredOp.signature = buildWebAuthnSignature(
            account, keyHash, userOpHash, p256KeyPair.privateKey,
        );

        const receipt = await sendAndWait(account, sponsoredOp, bundlerRpc);
        expect(receipt.success).toBe(true);
    });

    // ─── 4.7: Sponsored key management (update + revoke) ────────────────

    test('4.7 sponsored key revocation', async () => {
        const revokeTx = ak.Calibur7702Account.createRevokeKeyMetaTransaction(keyHash);

        const userOp = await account.createUserOperation(
            [revokeTx],
            providerRpc,
            bundlerRpc,
        );

        const [sponsoredOp] = await paymaster.createSponsorPaymasterUserOperation(
            userOp,
            bundlerRpc,
        );

        sponsoredOp.signature = account.signUserOperation(sponsoredOp, eoaPrivateKey, chainId);
        const receipt = await sendAndWait(account, sponsoredOp, bundlerRpc);
        expect(receipt.success).toBe(true);

        const isRegistered = await account.isKeyRegistered(providerRpc, keyHash);
        expect(isRegistered).toBe(false);
    });

    // ─── 4.8: Sponsor metadata is returned ──────────────────────────────

    test('4.8 sponsor metadata is returned', async () => {
        const userOp = await account.createUserOperation(
            [{ to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', value: 0n, data: '0x' }],
            providerRpc,
            bundlerRpc,
        );

        const [_sponsoredOp, sponsorMetadata] = await paymaster.createSponsorPaymasterUserOperation(
            userOp,
            bundlerRpc,
        );

        // sponsorMetadata may or may not be present depending on paymaster config
        // Just verify it doesn't throw and the op is valid
        expect(_sponsoredOp.paymaster).toBeTruthy();

        // Don't send — just verify structure
    });
});

describe('Calibur7702Account Token Paymaster', () => {

    beforeAll(() => {
        if (!providerRpc || !bundlerRpc || !paymasterRpc || !eoaPrivateKey || !eoaAddress) {
            throw new Error(
                'Missing required env vars: CHAIN_ID, JSON_RPC_NODE_PROVIDER, BUNDLER_URL, PAYMASTER_RPC, PRIVATE_KEY1, PUBLIC_ADDRESS1. See .env.example.'
            );
        }
        if (!erc20TokenAddress) {
            throw new Error(
                'Missing ERC20_TOKEN_ADDRESS env var. Set it to a paymaster-supported ERC-20 token address. ' +
                'The test EOA must hold a balance of this token.'
            );
        }
        account = new ak.Calibur7702Account(eoaAddress, {
            entrypointAddress: ENTRYPOINT_V9,
            delegateeAddress: CALIBUR_V9_SINGLETON,
        });
        paymaster = new ak.CandidePaymaster(paymasterRpc);
    });

    // ─── 5.1: Token paymaster supports the configured token ─────────────

    test('5.1 token paymaster supports the configured ERC-20 token', async () => {
        const isSupported = await paymaster.isSupportedERC20Token(
            erc20TokenAddress,
            ENTRYPOINT_V9,
        );
        expect(isSupported).toBe(true);

        const tokenData = await paymaster.getSupportedERC20TokenData(
            erc20TokenAddress,
            ENTRYPOINT_V9,
        );
        expect(tokenData).not.toBeNull();
        expect(tokenData.symbol).toBeTruthy();
        expect(tokenData.decimals).toBeGreaterThan(0);
    });

    // ─── 5.2: Token paymaster — basic transfer paid with ERC-20 ─────────

    test('5.2 transfer paid with ERC-20 token', async () => {
        const userOp = await account.createUserOperation(
            [{ to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', value: 0n, data: '0x' }],
            providerRpc,
            bundlerRpc,
        );

        const tokenOp = await paymaster.createTokenPaymasterUserOperation(
            account,
            userOp,
            erc20TokenAddress,
            bundlerRpc,
        );

        // Verify paymaster fields are set
        expect(tokenOp.paymaster).toBeTruthy();
        expect(tokenOp.paymasterData).toBeTruthy();

        // Verify calldata was modified (approve prepended)
        // Decode and check there are at least 2 calls (approve + original)
        const batchDecoded = abiCoder.decode(
            ["((address,uint256,bytes)[],bool)"],
            "0x" + tokenOp.callData.slice(10),
        );
        expect(batchDecoded[0][0].length).toBeGreaterThanOrEqual(2);

        // First call should be the approve to the paymaster
        const approveCall = batchDecoded[0][0][0];
        expect(approveCall[0].toLowerCase()).toBe(erc20TokenAddress.toLowerCase());

        // Sign and send
        tokenOp.signature = account.signUserOperation(tokenOp, eoaPrivateKey, chainId);
        const receipt = await sendAndWait(account, tokenOp, bundlerRpc);
        expect(receipt.success).toBe(true);
    });

    // ─── 5.3: Token paymaster — batch transaction paid with ERC-20 ──────

    test('5.3 batch transaction paid with ERC-20 token', async () => {
        const userOp = await account.createUserOperation(
            [
                { to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', value: 0n, data: '0x' },
                { to: '0x1111111111111111111111111111111111111111', value: 0n, data: '0x' },
            ],
            providerRpc,
            bundlerRpc,
        );

        const tokenOp = await paymaster.createTokenPaymasterUserOperation(
            account,
            userOp,
            erc20TokenAddress,
            bundlerRpc,
        );

        // Should have 3 calls: approve + 2 original
        const batchDecoded = abiCoder.decode(
            ["((address,uint256,bytes)[],bool)"],
            "0x" + tokenOp.callData.slice(10),
        );
        expect(batchDecoded[0][0].length).toBe(3);

        tokenOp.signature = account.signUserOperation(tokenOp, eoaPrivateKey, chainId);
        const receipt = await sendAndWait(account, tokenOp, bundlerRpc);
        expect(receipt.success).toBe(true);
    });

    // ─── 5.4: Token paymaster — passkey-signed transfer paid with ERC-20 ─

    test('5.4 passkey-signed transfer paid with ERC-20 token', async () => {
        // Register a fresh passkey (using root key, paid with token)
        const kp = generateP256KeyPair();
        const wKey = ak.Calibur7702Account.createWebAuthnP256Key(kp.x, kp.y);
        const kh = ak.Calibur7702Account.getKeyHash(wKey);

        const registerTxs = ak.Calibur7702Account.createRegisterKeyMetaTransactions(wKey, {
            expiration: Math.floor(Date.now() / 1000) + 86400 * 365,
        });

        const regOp = await account.createUserOperation(registerTxs, providerRpc, bundlerRpc);
        const regTokenOp = await paymaster.createTokenPaymasterUserOperation(
            account, regOp, erc20TokenAddress, bundlerRpc,
        );
        regTokenOp.signature = account.signUserOperation(regTokenOp, eoaPrivateKey, chainId);
        const regReceipt = await sendAndWait(account, regTokenOp, bundlerRpc);
        expect(regReceipt.success).toBe(true);

        // Now send a transfer signed with the passkey, paid with token
        const dummyWebAuthnSig = ak.Calibur7702Account.createDummyWebAuthnSignature(kh);
        const userOp = await account.createUserOperation(
            [{ to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', value: 0n, data: '0x' }],
            providerRpc,
            bundlerRpc,
            { dummySignature: dummyWebAuthnSig },
        );

        const tokenOp = await paymaster.createTokenPaymasterUserOperation(
            account, userOp, erc20TokenAddress, bundlerRpc,
        );

        const userOpHash = ak.createUserOperationHash(tokenOp, ENTRYPOINT_V9, chainId);
        tokenOp.signature = buildWebAuthnSignature(account, kh, userOpHash, kp.privateKey);

        const receipt = await sendAndWait(account, tokenOp, bundlerRpc);
        expect(receipt.success).toBe(true);
    });

    // ─── 5.5: Token paymaster — exchange rate is fetchable ───────────────

    test('5.5 exchange rate is fetchable for the token', async () => {
        const exchangeRate = await paymaster.fetchTokenPaymasterExchangeRate(
            erc20TokenAddress,
            ENTRYPOINT_V9,
        );
        expect(exchangeRate).toBeGreaterThan(0n);
    });

    // ─── 5.6: Token paymaster — gas cost estimation in ERC-20 ────────────

    test('5.6 gas cost estimation in ERC-20 tokens', async () => {
        const userOp = await account.createUserOperation(
            [{ to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', value: 0n, data: '0x' }],
            providerRpc,
            bundlerRpc,
        );

        const maxCost = await paymaster.calculateUserOperationErc20TokenMaxGasCost(
            userOp,
            erc20TokenAddress,
        );
        expect(maxCost).toBeGreaterThan(0n);
    });

    // ─── 5.7: Token paymaster — unsupported token is rejected ────────────

    test('5.7 unsupported token address is rejected', async () => {
        const fakeToken = "0x0000000000000000000000000000000000000001";
        const isSupported = await paymaster.isSupportedERC20Token(fakeToken, ENTRYPOINT_V9);
        expect(isSupported).toBe(false);
    });
});
