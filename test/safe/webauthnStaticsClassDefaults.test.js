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
                return '0x' + '0'.repeat(63) + '1';
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

describe('detached calls', () => {
    test('a detached static keeps working and falls back to the v0.2.0 base defaults', () => {
        const detached = ak.SafeMultiChainSigAccountV1.getSignerLowerCaseAddress;
        expect(detached(PASSKEY, { isInit: false })).toBe(V0_2_0_PROXY.toLowerCase());
    });
});
