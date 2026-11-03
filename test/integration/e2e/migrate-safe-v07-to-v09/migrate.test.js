// e2e: migrate a DEPLOYED Safe from EntryPoint v0.7 (SafeAccountV0_3_0) to
// EntryPoint v0.9 (SafeMultiChainSigAccountV1) by swapping the 4337 module +
// fallback handler, then prove the upgraded account operates on v0.9.
//
// Cross-EntryPoint: the deploy + migrate ops are validated by the v0.7 module
// and routed through the v7 bundler; the post-migration op runs through the v9
// bundler against the same anvil node. Self-funded via anvil_setBalance — no
// paymaster needed.

const { Wallet } = require('ethers');
const { hexToBytes, keccak256, numberToBytes, toBytes } = require('viem');
const {
    SafeAccountV0_3_0,
    SafeMultiChainSigAccountV1,
    sendJsonRpcRequest,
    SafeMultiChainSigAccountV2,
    fromSafeWebauthn,
    pubkeyCoordinatesFromJson,
    pubkeyCoordinatesToJson,
    webauthnSignatureFromAssertion,
} = require('../../../../dist/index.cjs');
const { runnable, unrunnable, nodeUrl, bundlerUrl } = require('../../_runnable.cjs');
const { WebAuthnCredentials, UserVerificationRequirement, extractPublicKey } = require('../passkeys/_webauthn.cjs');

jest.setTimeout(300000);

const TEN_ETH_HEX = '0x8AC7230489E80000';
const V07_MODULE = SafeAccountV0_3_0.DEFAULT_SAFE_4337_MODULE_ADDRESS;
const V09_MODULE = SafeMultiChainSigAccountV1.DEFAULT_SAFE_4337_MODULE_ADDRESS;

describe.each(runnable)('Safe v0.7 -> v0.9 migration e2e: $name (chainId $chainId)', (chain) => {
    const node = nodeUrl(chain);
    const v07Bundler = bundlerUrl({ ...chain, entrypoint: 'v7' });
    const v09Bundler = bundlerUrl({ ...chain, entrypoint: 'v9' });
    const chainId = BigInt(chain.chainId);

    const owner = Wallet.createRandom();

    let oldAccount; // SafeAccountV0_3_0 view (EP v0.7)
    let accountAddress;

    async function sendUserOp(account, bundler, transactions) {
        const userOp = await account.createUserOperation(transactions, node, bundler, {
            verificationGasLimitPercentageMultiplier: 200,
        });
        userOp.signature = account.signUserOperation(userOp, [owner.privateKey], chainId);
        return (await account.sendUserOperation(userOp, bundler)).included();
    }

    beforeAll(async () => {
        oldAccount = SafeAccountV0_3_0.initializeNewAccount([owner.address]);
        accountAddress = oldAccount.accountAddress;
        await sendJsonRpcRequest(node, 'anvil_setBalance', [accountAddress, TEN_ETH_HEX]);
    });

    test('deploy the Safe on EntryPoint v0.7', async () => {
        const receipt = await sendUserOp(oldAccount, v07Bundler, [
            { to: owner.address, value: 0n, data: '0x' },
        ]);
        expect(receipt?.success).toBe(true);

        const code = await sendJsonRpcRequest(node, 'eth_getCode', [accountAddress, 'latest']);
        expect(code).not.toBe('0x');
        // The v0.7 module is the active module on the fresh Safe.
        expect(await oldAccount.isModuleEnabled(node, V07_MODULE)).toBe(true);
    });

    test('migrate to the v0.9 multi-chain module (validated by the v0.7 module)', async () => {
        oldAccount = new SafeAccountV0_3_0(accountAddress);
        const batch = await oldAccount.createMigrateToSafeMultiChainSigAccountMetaTransactions(node);
        expect(batch).toHaveLength(3);

        const receipt = await sendUserOp(oldAccount, v07Bundler, batch);
        expect(receipt?.success).toBe(true);
    });

    test('on-chain state reflects the upgrade', async () => {
        expect(await oldAccount.isModuleEnabled(node, V09_MODULE)).toBe(true);
        expect(await oldAccount.isModuleEnabled(node, V07_MODULE)).toBe(false);

        const fallbackHandler = await oldAccount.getFallbackHandler(node);
        expect(fallbackHandler.toLowerCase()).toBe(V09_MODULE.toLowerCase());
    });

    test('the upgraded account executes a UserOperation on EntryPoint v0.9', async () => {
        const newAccount = new SafeMultiChainSigAccountV1(accountAddress);
        const recipient = Wallet.createRandom().address;
        const value = 1_000_000_000_000_000n;

        const receipt = await sendUserOp(newAccount, v09Bundler, [
            { to: recipient, value, data: '0x' },
        ]);
        expect(receipt?.success).toBe(true);

        const bal = await sendJsonRpcRequest(node, 'eth_getBalance', [recipient, 'latest']);
        expect(BigInt(bal)).toBe(value);
    });

    test('the upgraded account also executes through SafeMultiChainSigAccountV2', async () => {
        // Same module and EntryPoint; the singleton only matters for deployment.
        const newAccount = new SafeMultiChainSigAccountV2(accountAddress);
        expect(newAccount.safe4337ModuleAddress).toBe(V09_MODULE);
        const recipient = Wallet.createRandom().address;
        const value = 1_000_000_000_000_000n;

        const receipt = await sendUserOp(newAccount, v09Bundler, [
            { to: recipient, value, data: '0x' },
        ]);
        expect(receipt?.success).toBe(true);

        const bal = await sendJsonRpcRequest(node, 'eth_getBalance', [recipient, 'latest']);
        expect(BigInt(bal)).toBe(value);
    });
});

// A passkey-owned v0.7 Safe keeps its Passkey module v0.2.0 signer proxy after
// migration, while the multi-chain classes default to the v0.2.1 contracts.
// The post-migration operation therefore has to pass the v0.2.0 WebAuthn set
// on gas estimation and build the signer from SafeAccountV0_3_0's defaults.
describe.each(runnable)('Safe v0.7 -> v0.9 migration e2e with a passkey owner: $name (chainId $chainId)', (chain) => {
    const node = nodeUrl(chain);
    const v07Bundler = bundlerUrl({ ...chain, entrypoint: 'v7' });
    const v09Bundler = bundlerUrl({ ...chain, entrypoint: 'v9' });
    const chainId = BigInt(chain.chainId);

    const navigator = { credentials: new WebAuthnCredentials() };
    let credential;
    let publicKey;
    let accountAddress;

    // The v0.2.0 WebAuthn set the account was created with, as overrides for
    // the multi-chain classes.
    const legacyWebAuthn = {
        webAuthnSharedSigner: SafeAccountV0_3_0.DEFAULT_WEB_AUTHN_SHARED_SIGNER,
        webAuthnSignerFactory: SafeAccountV0_3_0.DEFAULT_WEB_AUTHN_SIGNER_FACTORY,
        webAuthnSignerSingleton: SafeAccountV0_3_0.DEFAULT_WEB_AUTHN_SIGNER_SINGLETON,
        webAuthnSignerProxyCreationCode: SafeAccountV0_3_0.DEFAULT_WEB_AUTHN_SIGNER_PROXY_CREATION_CODE,
        eip7212WebAuthnPrecompileVerifier: SafeAccountV0_3_0.DEFAULT_WEB_AUTHN_PRECOMPILE,
        eip7212WebAuthnContractVerifier: SafeAccountV0_3_0.DEFAULT_WEB_AUTHN_CONTRACT_VERIFIER,
    };

    function passkeySigner(isInit) {
        return fromSafeWebauthn({
            publicKey,
            isInit,
            accountClass: SafeAccountV0_3_0,
            getAssertion: async (challenge) => {
                const assertion = navigator.credentials.get({
                    publicKey: {
                        challenge,
                        rpId: 'candide.dev',
                        allowCredentials: [{ type: 'public-key', id: new Uint8Array(credential.rawId) }],
                        userVerification: UserVerificationRequirement.required,
                    },
                });
                return webauthnSignatureFromAssertion(assertion.response);
            },
        });
    }

    async function sendPasskeyUserOp(account, bundler, transactions, overrides = {}) {
        const userOp = await account.createUserOperation(transactions, node, bundler, {
            expectedSigners: [publicKey],
            verificationGasLimitPercentageMultiplier: 200,
            ...overrides,
        });
        const isInit = userOp.nonce === 0n;
        userOp.signature = await account.signUserOperationWithSigners(userOp, [passkeySigner(isInit)], chainId);
        return (await account.sendUserOperation(userOp, bundler)).included();
    }

    beforeAll(async () => {
        credential = navigator.credentials.create({
            publicKey: {
                rp: { name: 'Candide', id: 'candide.dev' },
                user: {
                    id: hexToBytes(keccak256(toBytes('migrating-passkey'))),
                    name: 'migrating-passkey',
                    displayName: 'Migrating Passkey',
                },
                challenge: numberToBytes(Date.now()),
                pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
            },
        });
        publicKey = pubkeyCoordinatesFromJson(pubkeyCoordinatesToJson(extractPublicKey(credential.response)));
        accountAddress = SafeAccountV0_3_0.createAccountAddress([publicKey]);
        await sendJsonRpcRequest(node, 'anvil_setBalance', [accountAddress, TEN_ETH_HEX]);
    });

    test('the v0.2.0 and v0.2.1 signer proxies differ for this key', () => {
        const legacy = SafeAccountV0_3_0.createWebAuthnSignerVerifierAddress(publicKey.x, publicKey.y);
        const current = SafeMultiChainSigAccountV2.createWebAuthnSignerVerifierAddress(publicKey.x, publicKey.y);
        expect(current).not.toBe(legacy);
        expect(
            SafeMultiChainSigAccountV2.createWebAuthnSignerVerifierAddress(publicKey.x, publicKey.y, legacyWebAuthn),
        ).toBe(legacy);
    });

    test('deploy the passkey-owned Safe on EntryPoint v0.7', async () => {
        const account = SafeAccountV0_3_0.initializeNewAccount([publicKey]);
        expect(account.accountAddress).toBe(accountAddress);
        const receipt = await sendPasskeyUserOp(account, v07Bundler, [
            { to: Wallet.createRandom().address, value: 0n, data: '0x' },
        ]);
        expect(receipt?.success).toBe(true);
    });

    test('migrate with a passkey-signed UserOperation', async () => {
        const account = new SafeAccountV0_3_0(accountAddress);
        const batch = await account.createMigrateToSafeMultiChainSigAccountMetaTransactions(node);
        const receipt = await sendPasskeyUserOp(account, v07Bundler, batch);
        expect(receipt?.success).toBe(true);
        expect(await account.isModuleEnabled(node, V09_MODULE)).toBe(true);
        expect(await account.isModuleEnabled(node, V07_MODULE)).toBe(false);
    });

    test('the migrated account executes on EntryPoint v0.9 through V2 with the v0.2.0 WebAuthn overrides', async () => {
        const account = new SafeMultiChainSigAccountV2(accountAddress);
        const recipient = Wallet.createRandom().address;
        const value = 1_000_000_000_000_000n;

        const receipt = await sendPasskeyUserOp(account, v09Bundler, [{ to: recipient, value, data: '0x' }], legacyWebAuthn);
        expect(receipt?.success).toBe(true);

        const bal = await sendJsonRpcRequest(node, 'eth_getBalance', [recipient, 'latest']);
        expect(BigInt(bal)).toBe(value);
    });
});

if (unrunnable.length > 0) {
    describe.skip.each(unrunnable)('Safe v0.7 -> v0.9 migration e2e: $name (setup failed)', () => {
        test('skipped', () => {});
    });
}
