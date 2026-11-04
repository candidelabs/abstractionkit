// Each Safe account instance carries the Safe Passkey module config its
// WebAuthn owners are bound to (`webAuthnConfig`), resolved from the class
// actually constructed. Owner-management helpers must derive passkey owner
// addresses from it, so on the multi-chain classes (module v0.2.1) they
// produce the same owner that signing does, not a v0.2.0 address. Offline.

const ak = require('../../dist/index.cjs');

const KEY = {
    x: 0x7a2fa39b3c61b3cbab8e44abeac8c9c7a4c1f76d42ae6f47b3b2a96d5c4f1a2bn,
    y: 0x2e8c5f6d4b7a9c1e3f5a8d7b6c4e2f1a9d8c7b6a5e4f3d2c1b0a9f8e7d6c5b4an,
};
const ACCOUNT = '0x1111111111111111111111111111111111111111';
const EOA = '0x2222222222222222222222222222222222222222';
const SENTINEL = '0x0000000000000000000000000000000000000001';
const FAKE_RPC = 'https://rpc.example.invalid';

const CLASSES = [
    ['SafeAccountV0_2_0', ak.SafeAccountV0_2_0],
    ['SafeAccountV0_3_0', ak.SafeAccountV0_3_0],
    ['SafeMultiChainSigAccountV1', ak.SafeMultiChainSigAccountV1],
    ['SafeMultiChainSigAccountV2', ak.SafeMultiChainSigAccountV2],
];

function defaultsOf(Cls) {
    return {
        webAuthnSharedSigner: Cls.DEFAULT_WEB_AUTHN_SHARED_SIGNER,
        webAuthnSignerFactory: Cls.DEFAULT_WEB_AUTHN_SIGNER_FACTORY,
        webAuthnSignerSingleton: Cls.DEFAULT_WEB_AUTHN_SIGNER_SINGLETON,
        webAuthnSignerProxyCreationCode: Cls.DEFAULT_WEB_AUTHN_SIGNER_PROXY_CREATION_CODE,
        eip7212WebAuthnPrecompileVerifier: Cls.DEFAULT_WEB_AUTHN_PRECOMPILE,
        eip7212WebAuthnContractVerifier: Cls.DEFAULT_WEB_AUTHN_CONTRACT_VERIFIER,
    };
}

// The ABI word at `index` (after the 4-byte selector) read as an address.
function addressArg(callData, index) {
    const start = 10 + index * 64;
    return '0x' + callData.slice(start + 24, start + 64).toLowerCase();
}

describe('Safe WebAuthn instance config', () => {
    let originalFetch;
    beforeEach(() => {
        originalFetch = global.fetch;
        // The only RPC the helpers make here is eth_getCode on the new
        // passkey owner; report it undeployed so a deploy tx is emitted.
        global.fetch = async () => {
            const body = { jsonrpc: '2.0', id: 1, result: '0x' };
            return {
                ok: true,
                status: 200,
                statusText: 'OK',
                text: async () => JSON.stringify(body),
                json: async () => body,
            };
        };
    });
    afterEach(() => {
        global.fetch = originalFetch;
    });

    test('v0.2.1 and v0.2.0 classes really differ (fixture precondition)', () => {
        expect(ak.SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_SIGNER_FACTORY).not.toBe(
            ak.SafeAccountV0_3_0.DEFAULT_WEB_AUTHN_SIGNER_FACTORY,
        );
    });

    describe.each(CLASSES)('%s', (_name, Cls) => {
        const expectedOwner = Cls.createWebAuthnSignerVerifierAddress(KEY.x, KEY.y).toLowerCase();

        test('webAuthnConfig defaults to the class Passkey module', () => {
            expect(new Cls(ACCOUNT).webAuthnConfig).toEqual(defaultsOf(Cls));
            expect(Cls.initializeNewAccount([EOA]).webAuthnConfig).toEqual(defaultsOf(Cls));
        });

        test('add owner registers the address signing produces', async () => {
            const account = new Cls(ACCOUNT);
            const txs = await account.createAddOwnerWithThresholdMetaTransactions(KEY, 1, {
                nodeRpcUrl: FAKE_RPC,
            });
            expect(txs).toHaveLength(2);
            expect(txs[0].to.toLowerCase()).toBe(Cls.DEFAULT_WEB_AUTHN_SIGNER_FACTORY.toLowerCase());
            expect(txs[0]).toEqual(Cls.createDeployWebAuthnVerifierMetaTransaction(KEY.x, KEY.y));
            expect(addressArg(txs[1].data, 0)).toBe(expectedOwner);
        });

        test('swap owner registers the address signing produces', async () => {
            const account = new Cls(ACCOUNT);
            const txs = await account.createSwapOwnerMetaTransactions(FAKE_RPC, KEY, EOA, {
                prevOwner: SENTINEL,
            });
            expect(txs).toHaveLength(2);
            expect(txs[0]).toEqual(Cls.createDeployWebAuthnVerifierMetaTransaction(KEY.x, KEY.y));
            expect(addressArg(txs[1].data, 2)).toBe(expectedOwner);
        });

        test('swap and remove target the passkey owner signing produces', async () => {
            const account = new Cls(ACCOUNT);
            const [swap] = await account.createSwapOwnerMetaTransactions(FAKE_RPC, EOA, KEY, {
                prevOwner: SENTINEL,
            });
            expect(addressArg(swap.data, 1)).toBe(expectedOwner);

            const remove = await account.createRemoveOwnerMetaTransaction(FAKE_RPC, KEY, 1, {
                prevOwner: SENTINEL,
            });
            expect(addressArg(remove.data, 1)).toBe(expectedOwner);
        });
    });

    test('constructor override replaces only the fields it sets', () => {
        const factory = '0x3333333333333333333333333333333333333333';
        const account = new ak.SafeMultiChainSigAccountV1(ACCOUNT, {
            webAuthnConfig: { webAuthnSignerFactory: factory },
        });
        expect(account.webAuthnConfig).toEqual({
            ...defaultsOf(ak.SafeMultiChainSigAccountV1),
            webAuthnSignerFactory: factory,
        });
    });

    test('per-call overrides still win over the instance config', async () => {
        const account = new ak.SafeMultiChainSigAccountV1(ACCOUNT);
        const v020 = defaultsOf(ak.SafeAccountV0_3_0);
        const txs = await account.createAddOwnerWithThresholdMetaTransactions(KEY, 1, {
            nodeRpcUrl: FAKE_RPC,
            webAuthnSignerFactory: v020.webAuthnSignerFactory,
            webAuthnSignerSingleton: v020.webAuthnSignerSingleton,
            webAuthnSignerProxyCreationCode: v020.webAuthnSignerProxyCreationCode,
            eip7212WebAuthnPrecompileVerifier: v020.eip7212WebAuthnPrecompileVerifier,
            eip7212WebAuthnContractVerifier: v020.eip7212WebAuthnContractVerifier,
        });
        expect(addressArg(txs[1].data, 0)).toBe(
            ak.SafeAccountV0_3_0.createWebAuthnSignerVerifierAddress(KEY.x, KEY.y).toLowerCase(),
        );
    });

    // Offline: nonce, fees and gas are all overridden, so no RPC is made.
    const OFFLINE_OVERRIDES = {
        nonce: 0n,
        maxFeePerGas: 1n,
        maxPriorityFeePerGas: 1n,
        callGasLimit: 1n,
        verificationGasLimit: 1n,
        preVerificationGas: 1n,
        skipGasEstimation: true,
    };
    const CALL = [{ to: EOA, value: 0n, data: '0x' }];

    test.each(CLASSES)(
        '%s deployment op swaps the shared signer for the class verifier proxy',
        async (_name, Cls) => {
            const account = Cls.initializeNewAccount([KEY]);
            const op = await account.createUserOperation(CALL, undefined, undefined, OFFLINE_OVERRIDES);
            const callData = op.callData.toLowerCase();
            const proxy = Cls.createWebAuthnSignerVerifierAddress(KEY.x, KEY.y).toLowerCase();
            expect(callData).toContain(proxy.slice(2));
            expect(callData).toContain(Cls.DEFAULT_WEB_AUTHN_SHARED_SIGNER.toLowerCase().slice(2));
        },
    );

    test('deployment op swaps out the custom shared signer passed at init', async () => {
        const sharedSigner = '0x4444444444444444444444444444444444444444';
        const account = ak.SafeMultiChainSigAccountV1.initializeNewAccount([KEY], {
            webAuthnSharedSigner: sharedSigner,
        });
        const op = await account.createUserOperation(CALL, undefined, undefined, OFFLINE_OVERRIDES);
        expect(op.callData.toLowerCase()).toContain(sharedSigner.slice(2));
    });

    test('initializeNewAccount keeps a custom shared signer on the instance', () => {
        const sharedSigner = '0x4444444444444444444444444444444444444444';
        for (const [, Cls] of CLASSES) {
            const account = Cls.initializeNewAccount([KEY], { webAuthnSharedSigner: sharedSigner });
            expect(account.webAuthnConfig.webAuthnSharedSigner).toBe(sharedSigner);
        }
    });
});
