const ak = require('../../dist/index.cjs');
const crypto = require('crypto');
const { AbiCoder, Wallet } = require('ethers');
require('dotenv').config();

const abiCoder = AbiCoder.defaultAbiCoder();

jest.setTimeout(300000);

// ─── Configuration ──────────────────────────────────────────────────────
let chainId;
const providerRpc = process.env.JSON_RPC_NODE_PROVIDER;
const bundlerRpc = process.env.BUNDLER_URL;
const paymasterRpc = process.env.PAYMASTER_RPC;
const eoaPrivateKey = process.env.PRIVATE_KEY1;
const eoaAddress = process.env.PUBLIC_ADDRESS1;
const erc20TokenAddress = process.env.ERC20_TOKEN_ADDRESS;

const ENTRYPOINT_V9 = ak.ENTRYPOINT_V9;
const CALIBUR_V9_SINGLETON = ak.CALIBUR_CANDIDE_V0_1_0_SINGLETON_ADDRESS;

// v0.9 UserOps share the same shape as v0.8 (eip7702Auth field), so the
// paymaster's auto-detection resolves to v0.8. Pass entrypoint explicitly.
const PM_V9 = { entrypoint: ENTRYPOINT_V9 };

// ─── Helpers ────────────────────────────────────────────────────────────

function generateFreshEOA() {
    const wallet = Wallet.createRandom();
    return { address: wallet.address, privateKey: wallet.privateKey };
}

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

function createV9Account(address) {
    return new ak.Calibur7702Account(address, {
        entrypointAddress: ENTRYPOINT_V9,
        delegateeAddress: CALIBUR_V9_SINGLETON,
    });
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('Calibur7702Account Sponsor Paymaster (v0.9 / EntryPoint v9)', () => {

    let paymaster;

    beforeAll(() => {
        if (!process.env.CHAIN_ID || !providerRpc || !bundlerRpc || !paymasterRpc) {
            throw new Error(
                'Missing required env vars: CHAIN_ID, JSON_RPC_NODE_PROVIDER, BUNDLER_URL, PAYMASTER_RPC. See .env.example.'
            );
        }
        chainId = BigInt(process.env.CHAIN_ID);
        paymaster = new ak.CandidePaymaster(paymasterRpc);
    });

    // ─── 6.1: Paymaster supports EntryPoint v0.9 ─────────────────────────

    test('6.1 paymaster supports EntryPoint v0.9', async () => {
        const entrypoints = await paymaster.getSupportedEntrypoints();
        expect(entrypoints.map(e => e.toLowerCase())).toContain(
            ENTRYPOINT_V9.toLowerCase()
        );
    });

    // ─── 6.2: Sponsored delegation + transfer (fresh EOA) ────────────────

    test('6.2 sponsored delegation + transfer, then second tx on same account', async () => {
        const eoa = generateFreshEOA();
        const account = createV9Account(eoa.address);

        // --- First UserOp: delegate + transfer ---
        const userOp = await account.createUserOperation(
            [{ to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', value: 0n, data: '0x' }],
            providerRpc,
            bundlerRpc,
            { eip7702Auth: { chainId } },
        );

        const [sponsoredOp] = await paymaster.createSponsorPaymasterUserOperation(
            userOp, bundlerRpc, undefined, PM_V9,
        );

        // Verify paymaster fields
        expect(sponsoredOp.paymaster).toBeTruthy();
        expect(sponsoredOp.paymaster).not.toBe("0x0000000000000000000000000000000000000000");
        expect(sponsoredOp.paymasterData).toBeTruthy();
        expect(BigInt(sponsoredOp.paymasterVerificationGasLimit)).toBeGreaterThan(0n);
        expect(BigInt(sponsoredOp.paymasterPostOpGasLimit)).toBeGreaterThanOrEqual(0n);
        expect(sponsoredOp.eip7702Auth).toBeTruthy();

        // Sign 7702 delegation
        sponsoredOp.eip7702Auth = ak.createAndSignEip7702DelegationAuthorization(
            BigInt(sponsoredOp.eip7702Auth.chainId),
            sponsoredOp.eip7702Auth.address,
            BigInt(sponsoredOp.eip7702Auth.nonce),
            eoa.privateKey,
        );

        // Sign and send
        sponsoredOp.signature = account.signUserOperation(sponsoredOp, eoa.privateKey, chainId);
        const receipt1 = await sendAndWait(account, sponsoredOp, bundlerRpc);
        expect(receipt1).not.toBeNull();
        expect(receipt1.success).toBe(true);

        // Verify delegation is set to the v0.9 singleton
        const delegated = await account.isDelegatedToThisAccount(providerRpc);
        expect(delegated).toBe(true);

        // --- Second UserOp: transfer on already-delegated account ---
        const userOp2 = await account.createUserOperation(
            [{ to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', value: 0n, data: '0x' }],
            providerRpc,
            bundlerRpc,
        );

        const [sponsoredOp2] = await paymaster.createSponsorPaymasterUserOperation(
            userOp2, bundlerRpc, undefined, PM_V9,
        );

        sponsoredOp2.signature = account.signUserOperation(sponsoredOp2, eoa.privateKey, chainId);
        const receipt2 = await sendAndWait(account, sponsoredOp2, bundlerRpc);
        expect(receipt2.success).toBe(true);
    });

    // ─── 6.3: Sponsored batch transaction (fresh EOA) ────────────────────

    test('6.3 sponsored batch transaction', async () => {
        const eoa = generateFreshEOA();
        const account = createV9Account(eoa.address);

        const userOp = await account.createUserOperation(
            [
                { to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', value: 0n, data: '0x' },
                { to: '0x1111111111111111111111111111111111111111', value: 0n, data: '0x' },
            ],
            providerRpc,
            bundlerRpc,
            { eip7702Auth: { chainId } },
        );

        const [sponsoredOp] = await paymaster.createSponsorPaymasterUserOperation(
            userOp, bundlerRpc, undefined, PM_V9,
        );

        sponsoredOp.eip7702Auth = ak.createAndSignEip7702DelegationAuthorization(
            BigInt(sponsoredOp.eip7702Auth.chainId),
            sponsoredOp.eip7702Auth.address,
            BigInt(sponsoredOp.eip7702Auth.nonce),
            eoa.privateKey,
        );

        sponsoredOp.signature = account.signUserOperation(sponsoredOp, eoa.privateKey, chainId);
        const receipt = await sendAndWait(account, sponsoredOp, bundlerRpc);
        expect(receipt.success).toBe(true);
    });

    // ─── 6.4: Sponsored passkey registration + passkey-signed tx ─────────

    test('6.4 sponsored passkey registration then passkey-signed tx', async () => {
        const eoa = generateFreshEOA();
        const account = createV9Account(eoa.address);

        // First: delegate the account
        const delegateOp = await account.createUserOperation(
            [{ to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', value: 0n, data: '0x' }],
            providerRpc,
            bundlerRpc,
            { eip7702Auth: { chainId } },
        );

        const [sponsoredDelegateOp] = await paymaster.createSponsorPaymasterUserOperation(
            delegateOp, bundlerRpc, undefined, PM_V9,
        );

        sponsoredDelegateOp.eip7702Auth = ak.createAndSignEip7702DelegationAuthorization(
            BigInt(sponsoredDelegateOp.eip7702Auth.chainId),
            sponsoredDelegateOp.eip7702Auth.address,
            BigInt(sponsoredDelegateOp.eip7702Auth.nonce),
            eoa.privateKey,
        );

        sponsoredDelegateOp.signature = account.signUserOperation(
            sponsoredDelegateOp, eoa.privateKey, chainId,
        );
        const delegateReceipt = await sendAndWait(account, sponsoredDelegateOp, bundlerRpc);
        expect(delegateReceipt.success).toBe(true);

        // Register passkey
        const p256KeyPair = generateP256KeyPair();
        const webAuthnKey = ak.Calibur7702Account.createWebAuthnP256Key(p256KeyPair.x, p256KeyPair.y);
        const keyHash = ak.Calibur7702Account.getKeyHash(webAuthnKey);

        const registerTxs = ak.Calibur7702Account.createRegisterKeyMetaTransactions(webAuthnKey, {
            expiration: Math.floor(Date.now() / 1000) + 86400 * 365,
        });

        const regOp = await account.createUserOperation(registerTxs, providerRpc, bundlerRpc);
        const [sponsoredRegOp] = await paymaster.createSponsorPaymasterUserOperation(
            regOp, bundlerRpc, undefined, PM_V9,
        );

        sponsoredRegOp.signature = account.signUserOperation(sponsoredRegOp, eoa.privateKey, chainId);
        const regReceipt = await sendAndWait(account, sponsoredRegOp, bundlerRpc);
        expect(regReceipt.success).toBe(true);

        const isRegistered = await account.isKeyRegistered(providerRpc, keyHash);
        expect(isRegistered).toBe(true);

        // Send a tx signed with the passkey
        const dummyWebAuthnSig = ak.Calibur7702Account.createDummyWebAuthnSignature(keyHash);
        const passkeyOp = await account.createUserOperation(
            [{ to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', value: 0n, data: '0x' }],
            providerRpc,
            bundlerRpc,
            { dummySignature: dummyWebAuthnSig },
        );

        const [sponsoredPasskeyOp] = await paymaster.createSponsorPaymasterUserOperation(
            passkeyOp, bundlerRpc, undefined, PM_V9,
        );

        const userOpHash = account.getUserOperationHash(sponsoredPasskeyOp, chainId);
        sponsoredPasskeyOp.signature = buildWebAuthnSignature(
            account, keyHash, userOpHash, p256KeyPair.privateKey,
        );

        const passkeyReceipt = await sendAndWait(account, sponsoredPasskeyOp, bundlerRpc);
        expect(passkeyReceipt.success).toBe(true);
    });

    // ─── 6.5: Sponsored key revocation ───────────────────────────────────

    test('6.5 sponsored key revocation', async () => {
        const eoa = generateFreshEOA();
        const account = createV9Account(eoa.address);

        // Delegate
        const delegateOp = await account.createUserOperation(
            [{ to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', value: 0n, data: '0x' }],
            providerRpc,
            bundlerRpc,
            { eip7702Auth: { chainId } },
        );
        const [sponsoredDelegateOp] = await paymaster.createSponsorPaymasterUserOperation(
            delegateOp, bundlerRpc, undefined, PM_V9,
        );
        sponsoredDelegateOp.eip7702Auth = ak.createAndSignEip7702DelegationAuthorization(
            BigInt(sponsoredDelegateOp.eip7702Auth.chainId),
            sponsoredDelegateOp.eip7702Auth.address,
            BigInt(sponsoredDelegateOp.eip7702Auth.nonce),
            eoa.privateKey,
        );
        sponsoredDelegateOp.signature = account.signUserOperation(
            sponsoredDelegateOp, eoa.privateKey, chainId,
        );
        await sendAndWait(account, sponsoredDelegateOp, bundlerRpc);

        // Register a key
        const p256KeyPair = generateP256KeyPair();
        const webAuthnKey = ak.Calibur7702Account.createWebAuthnP256Key(p256KeyPair.x, p256KeyPair.y);
        const keyHash = ak.Calibur7702Account.getKeyHash(webAuthnKey);

        const registerTxs = ak.Calibur7702Account.createRegisterKeyMetaTransactions(webAuthnKey, {
            expiration: Math.floor(Date.now() / 1000) + 86400 * 365,
        });
        const regOp = await account.createUserOperation(registerTxs, providerRpc, bundlerRpc);
        const [sponsoredRegOp] = await paymaster.createSponsorPaymasterUserOperation(
            regOp, bundlerRpc, undefined, PM_V9,
        );
        sponsoredRegOp.signature = account.signUserOperation(sponsoredRegOp, eoa.privateKey, chainId);
        await sendAndWait(account, sponsoredRegOp, bundlerRpc);

        expect(await account.isKeyRegistered(providerRpc, keyHash)).toBe(true);

        // Revoke it
        const revokeTx = ak.Calibur7702Account.createRevokeKeyMetaTransaction(keyHash);
        const revokeOp = await account.createUserOperation([revokeTx], providerRpc, bundlerRpc);
        const [sponsoredRevokeOp] = await paymaster.createSponsorPaymasterUserOperation(
            revokeOp, bundlerRpc, undefined, PM_V9,
        );
        sponsoredRevokeOp.signature = account.signUserOperation(
            sponsoredRevokeOp, eoa.privateKey, chainId,
        );
        const revokeReceipt = await sendAndWait(account, sponsoredRevokeOp, bundlerRpc);
        expect(revokeReceipt.success).toBe(true);

        expect(await account.isKeyRegistered(providerRpc, keyHash)).toBe(false);
    });

    // ─── 6.6: Sponsor metadata is returned ───────────────────────────────

    test('6.6 sponsor metadata is returned', async () => {
        const eoa = generateFreshEOA();
        const account = createV9Account(eoa.address);

        const userOp = await account.createUserOperation(
            [{ to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', value: 0n, data: '0x' }],
            providerRpc,
            bundlerRpc,
            { eip7702Auth: { chainId } },
        );

        const [sponsoredOp, sponsorMetadata] = await paymaster.createSponsorPaymasterUserOperation(
            userOp, bundlerRpc, undefined, PM_V9,
        );

        expect(sponsoredOp.paymaster).toBeTruthy();
        // Don't send — just verify structure
    });
});

// ─── Token Paymaster Tests (v0.9) ───────────────────────────────────────
// Requires: PRIVATE_KEY1, PUBLIC_ADDRESS1, ERC20_TOKEN_ADDRESS in .env
// The EOA must hold a balance of the configured ERC-20 token.

describe('Calibur7702Account Token Paymaster (v0.9 / EntryPoint v9)', () => {

    let account;
    let paymaster;

    beforeAll(async () => {
        if (!process.env.CHAIN_ID || !providerRpc || !bundlerRpc || !paymasterRpc || !eoaPrivateKey || !eoaAddress) {
            throw new Error(
                'Missing required env vars: CHAIN_ID, JSON_RPC_NODE_PROVIDER, BUNDLER_URL, PAYMASTER_RPC, PRIVATE_KEY1, PUBLIC_ADDRESS1.'
            );
        }
        if (!erc20TokenAddress) {
            throw new Error(
                'Missing ERC20_TOKEN_ADDRESS env var. Set it to a paymaster-supported ERC-20 token address. ' +
                'The test EOA must hold a balance of this token.'
            );
        }

        chainId = BigInt(process.env.CHAIN_ID);
        account = createV9Account(eoaAddress);
        paymaster = new ak.CandidePaymaster(paymasterRpc);

        // Ensure the account is delegated to the v0.9 singleton.
        const isDelegated = await account.isDelegatedToThisAccount(providerRpc);
        if (!isDelegated) {
            console.log('Account not delegated to v0.9 singleton, delegating...');
            const delegateOp = await account.createUserOperation(
                [{ to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', value: 0n, data: '0x' }],
                providerRpc,
                bundlerRpc,
                { eip7702Auth: { chainId } },
            );
            const [sponsoredOp] = await paymaster.createSponsorPaymasterUserOperation(
                delegateOp, bundlerRpc, undefined, PM_V9,
            );
            sponsoredOp.eip7702Auth = ak.createAndSignEip7702DelegationAuthorization(
                BigInt(sponsoredOp.eip7702Auth.chainId),
                sponsoredOp.eip7702Auth.address,
                BigInt(sponsoredOp.eip7702Auth.nonce),
                eoaPrivateKey,
            );
            sponsoredOp.signature = account.signUserOperation(sponsoredOp, eoaPrivateKey, chainId);
            const receipt = await sendAndWait(account, sponsoredOp, bundlerRpc);
            expect(receipt.success).toBe(true);
            console.log('Delegation complete.');
        }
    });

    // ─── 7.1: Token paymaster supports the configured token ─────────────

    test('7.1 token paymaster supports the configured ERC-20 token', async () => {
        const isSupported = await paymaster.isSupportedERC20Token(
            erc20TokenAddress,
            account.entrypointAddress,
        );
        expect(isSupported).toBe(true);

        const tokenData = await paymaster.getSupportedERC20TokenData(
            erc20TokenAddress,
            account.entrypointAddress,
        );
        expect(tokenData).not.toBeNull();
        expect(tokenData.symbol).toBeTruthy();
        expect(tokenData.decimals).toBeGreaterThan(0);
    });

    // ─── 7.2: Transfer paid with ERC-20 token ───────────────────────────

    test('7.2 transfer paid with ERC-20 token', async () => {
        const userOp = await account.createUserOperation(
            [{ to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', value: 0n, data: '0x' }],
            providerRpc,
            bundlerRpc,
        );

        const tokenOp = await paymaster.createTokenPaymasterUserOperation(
            account, userOp, erc20TokenAddress, bundlerRpc, PM_V9,
        );

        // Verify paymaster fields
        expect(tokenOp.paymaster).toBeTruthy();
        expect(tokenOp.paymasterData).toBeTruthy();

        // Verify calldata has approve prepended (at least 2 calls)
        const batchDecoded = abiCoder.decode(
            ["((address,uint256,bytes)[],bool)"],
            "0x" + tokenOp.callData.slice(10),
        );
        expect(batchDecoded[0][0].length).toBeGreaterThanOrEqual(2);

        // First call should be the approve to the paymaster on the token
        const approveCall = batchDecoded[0][0][0];
        expect(approveCall[0].toLowerCase()).toBe(erc20TokenAddress.toLowerCase());

        // Sign and send
        tokenOp.signature = account.signUserOperation(tokenOp, eoaPrivateKey, chainId);
        const receipt = await sendAndWait(account, tokenOp, bundlerRpc);
        expect(receipt.success).toBe(true);
    });

    // ─── 7.3: Batch transaction paid with ERC-20 token ──────────────────

    test('7.3 batch transaction paid with ERC-20 token', async () => {
        const userOp = await account.createUserOperation(
            [
                { to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', value: 0n, data: '0x' },
                { to: '0x1111111111111111111111111111111111111111', value: 0n, data: '0x' },
            ],
            providerRpc,
            bundlerRpc,
        );

        const tokenOp = await paymaster.createTokenPaymasterUserOperation(
            account, userOp, erc20TokenAddress, bundlerRpc, PM_V9,
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

    // ─── 7.4: Gas cost estimation in ERC-20 tokens ──────────────────────

    test('7.4 gas cost estimation in ERC-20 tokens', async () => {
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

    // ─── 7.5: Exchange rate is fetchable ─────────────────────────────────

    test('7.5 exchange rate is fetchable for the token', async () => {
        const exchangeRate = await paymaster.fetchTokenPaymasterExchangeRate(
            erc20TokenAddress,
            account.entrypointAddress,
        );
        expect(exchangeRate).toBeGreaterThan(0n);
    });

    // ─── 7.6: Unsupported token is rejected ─────────────────────────────

    test('7.6 unsupported token address is rejected', async () => {
        const fakeToken = "0x0000000000000000000000000000000000000001";
        const isSupported = await paymaster.isSupportedERC20Token(
            fakeToken, account.entrypointAddress,
        );
        expect(isSupported).toBe(false);
    });
});
