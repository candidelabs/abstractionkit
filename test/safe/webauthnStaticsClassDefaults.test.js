// Regression tests: every public WebAuthn-aware static on SafeAccount must
// derive a passkey owner from the Passkey module defaults of the class it is
// called on. The multi-chain classes bind owners to module v0.2.1 while the
// base declares v0.2.0, so a static that reads `SafeAccount.DEFAULT_*` by
// name silently produces an address the account never signs with when it is
// invoked as `SafeMultiChainSigAccountV1.someStatic(...)`.
//
// The reference for each class is its own createWebAuthnSignerVerifierAddress,
// which the multi-chain classes override explicitly. Offline.

const ak = require('../../dist/index.cjs');

const PASSKEY = {
    x: 0x7a2fa39b3c61b3cbab8e44abeac8c9c7a4c1f76d42ae6f47b3b2a96d5c4f1a2bn,
    y: 0x2e8c5f6d4b7a9c1e3f5a8d7b6c4e2f1a9d8c7b6a5e4f3d2c1b0a9f8e7d6c5b4an,
};
const EOA = '0x1a02592A3484c2077d2E5D24482497F85e1980C6';
const CUSTOM_SIGNER_FACTORY = '0x' + '77'.repeat(20);
const MESSAGE_HASH = '0x' + 'ab'.repeat(32);
const ACCOUNT = '0x' + '42'.repeat(20);

const hex = (addr) => addr.slice(2).toLowerCase();
const includesAddress = (blob, addr) => blob.toLowerCase().includes(hex(addr));

const V0_2_0_PROXY = ak.SafeAccountV0_3_0.createWebAuthnSignerVerifierAddress(PASSKEY.x, PASSKEY.y);
const V0_2_1_PROXY = ak.SafeMultiChainSigAccountV1.createWebAuthnSignerVerifierAddress(PASSKEY.x, PASSKEY.y);

const CLASSES = [
    ['SafeAccountV0_3_0', ak.SafeAccountV0_3_0, V0_2_0_PROXY, V0_2_1_PROXY, false],
    ['SafeMultiChainSigAccountV1', ak.SafeMultiChainSigAccountV1, V0_2_1_PROXY, V0_2_0_PROXY, true],
    ['SafeMultiChainSigAccountV2', ak.SafeMultiChainSigAccountV2, V0_2_1_PROXY, V0_2_0_PROXY, true],
];

test('the two module releases derive different proxies for the same key', () => {
    expect(V0_2_0_PROXY).not.toBe(V0_2_1_PROXY);
});

describe.each(CLASSES)('%s WebAuthn statics', (_name, Account, expected, other, isMultiChain) => {
    // A valid-shaped dummy WebAuthn signature for the formatting paths.
    const dummy = Account.createDummySignerSignaturePairForExpectedSigners([PASSKEY], { isInit: false })[0];
    const rawPair = () => [{ signer: PASSKEY, signature: dummy.signature }];

    test('createDummySignerSignaturePairForExpectedSigners names the class proxy', () => {
        expect(dummy.signer).toBe(expected);
    });

    test('createDummySignerSignaturePairForExpectedSigners uses the class shared signer on init', () => {
        const [pair] = Account.createDummySignerSignaturePairForExpectedSigners([PASSKEY], { isInit: true });
        expect(pair.signer.toLowerCase()).toBe(Account.DEFAULT_WEB_AUTHN_SHARED_SIGNER.toLowerCase());
    });

    test('getSignerLowerCaseAddress derives the class proxy, and the class shared signer on init', () => {
        expect(Account.getSignerLowerCaseAddress(PASSKEY, { isInit: false })).toBe(expected.toLowerCase());
        expect(Account.getSignerLowerCaseAddress(PASSKEY, { isInit: true })).toBe(
            Account.DEFAULT_WEB_AUTHN_SHARED_SIGNER.toLowerCase(),
        );
        expect(Account.getSignerLowerCaseAddress(EOA)).toBe(EOA.toLowerCase());
    });

    test('sortSignatures orders by the class-derived proxy address', () => {
        const pairs = [
            { signer: PASSKEY, signature: dummy.signature },
            { signer: EOA, signature: '0x' + '11'.repeat(65) },
        ];
        Account.sortSignatures(pairs, { isInit: false });
        const sorted = [expected.toLowerCase(), EOA.toLowerCase()].sort((a, b) => a.localeCompare(b));
        expect(pairs.map((p) => (typeof p.signer === 'string' ? p.signer.toLowerCase() : expected.toLowerCase()))).toEqual(
            sorted,
        );
    });

    test('buildSignaturesFromSingerSignaturePairs encodes the class proxy', () => {
        const sig = Account.buildSignaturesFromSingerSignaturePairs(rawPair(), { isInit: false });
        expect(includesAddress(sig, expected)).toBe(true);
        expect(includesAddress(sig, other)).toBe(false);
    });

    test('formatSignaturesToUseroperationSignature encodes the class proxy', () => {
        const sig = Account.formatSignaturesToUseroperationSignature(rawPair(), {
            isInit: false,
            isMultiChainSignature: isMultiChain,
        });
        expect(includesAddress(sig, expected)).toBe(true);
        expect(includesAddress(sig, other)).toBe(false);
    });

    test('the static formatter agrees with the instance formatter', () => {
        const account = new Account(ACCOUNT);
        const viaStatic = Account.formatSignaturesToUseroperationSignature(rawPair(), {
            isInit: false,
            isMultiChainSignature: isMultiChain,
        });
        const viaInstance = account.formatUserOperationSignature(rawPair(), { isInit: false });
        expect(viaStatic).toBe(viaInstance);
    });

    test('createDeployWebAuthnVerifierMetaTransaction targets the class factory and verifiers', () => {
        const tx = Account.createDeployWebAuthnVerifierMetaTransaction(PASSKEY.x, PASSKEY.y);
        expect(tx.to.toLowerCase()).toBe(Account.DEFAULT_WEB_AUTHN_SIGNER_FACTORY.toLowerCase());
        // createSigner(x, y, uint176 verifiers): verifiers = precompile[-2 bytes] ++ contract verifier
        const verifiers = (
            Account.DEFAULT_WEB_AUTHN_PRECOMPILE.slice(-4) + Account.DEFAULT_WEB_AUTHN_CONTRACT_VERIFIER.slice(2)
        ).toLowerCase();
        expect(tx.data.toLowerCase().endsWith(verifiers)).toBe(true);
    });

    test('verifyWebAuthnSignatureForMessageHash simulates the class singleton and verifiers', async () => {
        let captured;
        const transport = {
            request: async ({ method, params }) => {
                expect(method).toBe('eth_call');
                captured = params;
                // isValidSignature answers with the ERC-1271 magic value, left-aligned
                return '0x1626ba7e' + '0'.repeat(56);
            },
        };
        const ok = await Account.verifyWebAuthnSignatureForMessageHash(transport, PASSKEY, MESSAGE_HASH, '0x1234');
        expect(ok).toBe(true);
        // The proxy runtime code is injected as a state override; it embeds the
        // singleton it delegates to and the verifier pair.
        const override = JSON.stringify(captured[2]).toLowerCase();
        expect(override).toContain(hex(Account.DEFAULT_WEB_AUTHN_SIGNER_SINGLETON));
        expect(override).toContain(
            (Account.DEFAULT_WEB_AUTHN_PRECOMPILE.slice(-4) + Account.DEFAULT_WEB_AUTHN_CONTRACT_VERIFIER.slice(2)).toLowerCase(),
        );
    });

    // The signer proxy returns bytes4, never a bool. Decoding it as a bool read
    // the last byte, which is zero for a valid signature too, so every
    // signature was reported invalid.
    test.each([
        ['zero, what the proxy returns for a bad signature', '0x' + '0'.repeat(64)],
        ['a bool-style true, which the proxy never returns', '0x' + '0'.repeat(63) + '1'],
        ['another selector', '0xffffffff' + '0'.repeat(56)],
    ])('verifyWebAuthnSignatureForMessageHash is false for %s', async (_name, result) => {
        const transport = { request: async () => result };
        expect(await Account.verifyWebAuthnSignatureForMessageHash(transport, PASSKEY, MESSAGE_HASH, '0x1234')).toBe(
            false,
        );
    });

    test('a per-call override still wins over the class default', () => {
        const custom = Account.createWebAuthnSignerVerifierAddress(PASSKEY.x, PASSKEY.y, {
            webAuthnSignerFactory: CUSTOM_SIGNER_FACTORY,
        });
        expect(custom).not.toBe(expected);
        expect(
            Account.getSignerLowerCaseAddress(PASSKEY, { isInit: false, webAuthnSignerFactory: CUSTOM_SIGNER_FACTORY }),
        ).toBe(custom.toLowerCase());
        const [pair] = Account.createDummySignerSignaturePairForExpectedSigners([PASSKEY], {
            isInit: false,
            webAuthnSignerFactory: CUSTOM_SIGNER_FACTORY,
        });
        expect(pair.signer).toBe(custom);
    });
});

describe.each(CLASSES)('%s baseEstimateUserOperationGas', (_name, Account, expected) => {
    const GAS = { callGasLimit: '0x10000', verificationGasLimit: '0x10000', preVerificationGas: '0x10000' };
    const BASE_OP = {
        nonce: 0n,
        callData: '0x',
        callGasLimit: 0n,
        verificationGasLimit: 0n,
        preVerificationGas: 0n,
        maxFeePerGas: 0n,
        maxPriorityFeePerGas: 0n,
        paymaster: null,
        paymasterVerificationGasLimit: null,
        paymasterPostOpGasLimit: null,
        paymasterData: null,
        signature: '0x',
    };

    async function estimatedSignature(account, op, viaBase) {
        let captured;
        const bundler = new ak.Bundler({
            request: async ({ params }) => {
                captured = params[0];
                return GAS;
            },
        });
        const method = viaBase ? 'baseEstimateUserOperationGas' : 'estimateUserOperationGas';
        await account[method]({ ...op }, bundler, { expectedSigners: [PASSKEY] });
        return captured.signature;
    }

    test('the dummy signature names the class shared signer on a deployment op', async () => {
        const account = Account.initializeNewAccount([PASSKEY]);
        const op = { ...BASE_OP, sender: account.accountAddress, factory: account.factoryAddress, factoryData: account.factoryData };
        const viaBase = await estimatedSignature(account, op, true);
        const viaPublic = await estimatedSignature(account, op, false);
        expect(includesAddress(viaBase, Account.DEFAULT_WEB_AUTHN_SHARED_SIGNER)).toBe(true);
        expect(includesAddress(viaPublic, Account.DEFAULT_WEB_AUTHN_SHARED_SIGNER)).toBe(true);
    });

    test('the dummy signature names the class proxy on a deployed account', async () => {
        const account = new Account(ACCOUNT);
        const op = { ...BASE_OP, sender: ACCOUNT, factory: null, factoryData: null };
        const viaBase = await estimatedSignature(account, op, true);
        const viaPublic = await estimatedSignature(account, op, false);
        expect(includesAddress(viaBase, expected)).toBe(true);
        expect(includesAddress(viaPublic, expected)).toBe(true);
    });
});

describe('detached calls', () => {
    test('a detached static keeps working and falls back to the v0.2.0 base defaults', () => {
        const detached = ak.SafeMultiChainSigAccountV1.getSignerLowerCaseAddress;
        expect(detached(PASSKEY, { isInit: false })).toBe(V0_2_0_PROXY.toLowerCase());
    });
});

// SafeMultiChainSigAccountV1 overrides the WebAuthn statics; they must still
// resolve omitted defaults from the class they are called on, so a subclass
// that swaps a Passkey module default gets it on the dummy-pair path too.
describe('a SafeMultiChainSigAccountV1 subclass with its own signer factory', () => {
    class CustomFactoryAccount extends ak.SafeMultiChainSigAccountV1 {
        static DEFAULT_WEB_AUTHN_SIGNER_FACTORY = CUSTOM_SIGNER_FACTORY;
    }
    const customProxy = ak.SafeMultiChainSigAccountV1.createWebAuthnSignerVerifierAddress(PASSKEY.x, PASSKEY.y, {
        webAuthnSignerFactory: CUSTOM_SIGNER_FACTORY,
    });

    test('the custom factory derives a different proxy than v0.2.1', () => {
        expect(customProxy).not.toBe(V0_2_1_PROXY);
    });

    test('createWebAuthnSignerVerifierAddress uses the subclass factory', () => {
        expect(CustomFactoryAccount.createWebAuthnSignerVerifierAddress(PASSKEY.x, PASSKEY.y)).toBe(customProxy);
    });

    test('the dummy pair names the subclass proxy, matching the raw-pair formatter', () => {
        const [pair] = CustomFactoryAccount.createDummySignerSignaturePairForExpectedSigners([PASSKEY], { isInit: false });
        expect(pair.signer).toBe(customProxy);
        const raw = CustomFactoryAccount.formatSignaturesToUseroperationSignature(
            [{ signer: PASSKEY, signature: pair.signature }],
            { isInit: false, isMultiChainSignature: true },
        );
        expect(includesAddress(raw, customProxy)).toBe(true);
    });

    test('baseEstimateUserOperationGas puts the subclass proxy in the estimation dummy', async () => {
        let captured;
        const bundler = new ak.Bundler({
            request: async ({ params }) => {
                captured = params[0];
                return { callGasLimit: '0x10000', verificationGasLimit: '0x10000', preVerificationGas: '0x10000' };
            },
        });
        const op = {
            sender: ACCOUNT,
            nonce: 0n,
            factory: null,
            factoryData: null,
            callData: '0x',
            callGasLimit: 0n,
            verificationGasLimit: 0n,
            preVerificationGas: 0n,
            maxFeePerGas: 0n,
            maxPriorityFeePerGas: 0n,
            paymaster: null,
            paymasterVerificationGasLimit: null,
            paymasterPostOpGasLimit: null,
            paymasterData: null,
            signature: '0x',
        };
        await new CustomFactoryAccount(ACCOUNT).baseEstimateUserOperationGas(op, bundler, {
            expectedSigners: [PASSKEY],
            isMultiChainSignature: true,
        });
        expect(includesAddress(captured.signature, customProxy)).toBe(true);
        expect(includesAddress(captured.signature, V0_2_1_PROXY)).toBe(false);
    });

    test('createDeployWebAuthnVerifierMetaTransaction targets the subclass factory', () => {
        const tx = CustomFactoryAccount.createDeployWebAuthnVerifierMetaTransaction(PASSKEY.x, PASSKEY.y);
        expect(tx.to.toLowerCase()).toBe(CUSTOM_SIGNER_FACTORY.toLowerCase());
    });

    test('detached multi-chain overrides fall back to the v0.2.1 defaults', () => {
        const detachedDummy = ak.SafeMultiChainSigAccountV1.createDummySignerSignaturePairForExpectedSigners;
        expect(detachedDummy([PASSKEY], { isInit: false })[0].signer).toBe(V0_2_1_PROXY);
        const detachedProxy = ak.SafeMultiChainSigAccountV1.createWebAuthnSignerVerifierAddress;
        expect(detachedProxy(PASSKEY.x, PASSKEY.y)).toBe(V0_2_1_PROXY);
    });
});

// The instance flows and the init-code statics on the multi-chain classes
// also resolve Passkey module defaults from the constructed class.
describe('multi-chain subclass defaults reach the instance and init-code paths', () => {
    const CUSTOM_SHARED_SIGNER = '0x' + '66'.repeat(20);
    class CustomFactoryAccount extends ak.SafeMultiChainSigAccountV1 {
        static DEFAULT_WEB_AUTHN_SIGNER_FACTORY = CUSTOM_SIGNER_FACTORY;
    }
    class CustomSharedSignerV1 extends ak.SafeMultiChainSigAccountV1 {
        static DEFAULT_WEB_AUTHN_SHARED_SIGNER = CUSTOM_SHARED_SIGNER;
    }
    class CustomSharedSignerV2 extends ak.SafeMultiChainSigAccountV2 {
        static DEFAULT_WEB_AUTHN_SHARED_SIGNER = CUSTOM_SHARED_SIGNER;
    }
    const customProxy = ak.SafeMultiChainSigAccountV1.createWebAuthnSignerVerifierAddress(PASSKEY.x, PASSKEY.y, {
        webAuthnSignerFactory: CUSTOM_SIGNER_FACTORY,
    });
    const GAS = { callGasLimit: '0x10000', verificationGasLimit: '0x10000', preVerificationGas: '0x10000' };

    function capturingBundler() {
        const calls = [];
        const bundler = new ak.Bundler({
            request: async ({ method, params }) => {
                calls.push({ method, params });
                return GAS;
            },
        });
        return { bundler, estimated: () => calls.find((c) => c.method === 'eth_estimateUserOperationGas').params[0] };
    }

    test('estimateUserOperationGas puts the subclass proxy in the estimation dummy', async () => {
        const { bundler, estimated } = capturingBundler();
        const op = {
            sender: ACCOUNT,
            nonce: 1n,
            factory: null,
            factoryData: null,
            callData: '0x',
            callGasLimit: 0n,
            verificationGasLimit: 0n,
            preVerificationGas: 0n,
            maxFeePerGas: 0n,
            maxPriorityFeePerGas: 0n,
            paymaster: null,
            paymasterVerificationGasLimit: null,
            paymasterPostOpGasLimit: null,
            paymasterData: null,
            signature: '0x',
        };
        await new CustomFactoryAccount(ACCOUNT).estimateUserOperationGas(op, bundler, { expectedSigners: [PASSKEY] });
        expect(includesAddress(estimated().signature, customProxy)).toBe(true);
        expect(includesAddress(estimated().signature, V0_2_1_PROXY)).toBe(false);
    });

    test('createUserOperation estimates with, and returns, the subclass proxy', async () => {
        const { bundler, estimated } = capturingBundler();
        const op = await new CustomFactoryAccount(ACCOUNT).createUserOperation(
            [{ to: EOA, value: 0n, data: '0x' }],
            undefined,
            bundler,
            { nonce: 1n, maxFeePerGas: 1n, maxPriorityFeePerGas: 1n, expectedSigners: [PASSKEY] },
        );
        expect(includesAddress(estimated().signature, customProxy)).toBe(true);
        expect(includesAddress(op.signature, customProxy)).toBe(true);
        expect(includesAddress(op.signature, V0_2_1_PROXY)).toBe(false);
    });

    test('formatUserOperationSignature and the multi-op formatter encode the subclass proxy', () => {
        const [dummy] = CustomFactoryAccount.createDummySignerSignaturePairForExpectedSigners([PASSKEY], { isInit: false });
        const raw = [{ signer: PASSKEY, signature: dummy.signature }];
        const viaInstance = new CustomFactoryAccount(ACCOUNT).formatUserOperationSignature(raw, { isInit: false });
        expect(includesAddress(viaInstance, customProxy)).toBe(true);

        const op = { sender: ACCOUNT, nonce: 1n, callData: '0x', signature: '0x' };
        const [single] = CustomFactoryAccount.formatSignaturesToUseroperationsSignatures(
            [{ userOperation: op, chainId: 1n, validAfter: 0n, validUntil: 0n, webAuthnSignatureOverrides: { isInit: false } }],
            raw,
        );
        expect(includesAddress(single, customProxy)).toBe(true);
    });

    test.each([
        ['V1', ak.SafeMultiChainSigAccountV1, CustomSharedSignerV1],
        ['V2', ak.SafeMultiChainSigAccountV2, CustomSharedSignerV2],
    ])('%s init-code statics use the subclass shared signer', (_n, Base, Custom) => {
        const withOverride = { webAuthnSharedSigner: CUSTOM_SHARED_SIGNER };
        expect(Custom.createAccountAddress([PASSKEY])).toBe(Base.createAccountAddress([PASSKEY], withOverride));
        expect(Custom.createAccountAddress([PASSKEY])).not.toBe(Base.createAccountAddress([PASSKEY]));
        expect(Custom.createFactoryAddressAndData([PASSKEY])).toEqual(
            Base.createFactoryAddressAndData([PASSKEY], withOverride),
        );
        const account = Custom.initializeNewAccount([PASSKEY]);
        expect(account).toBeInstanceOf(Custom);
        expect(account.accountAddress).toBe(Custom.createAccountAddress([PASSKEY]));
    });

    test('V1 createInitializerCallData uses the subclass shared signer', () => {
        const data = CustomSharedSignerV1.createInitializerCallData([PASSKEY], 1);
        expect(includesAddress(data, CUSTOM_SHARED_SIGNER)).toBe(true);
    });
});
