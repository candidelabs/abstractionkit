// Regression tests for the options SafeMultiChainSigAccountV1 forwards when it
// formats a signature. Offline.
//
// - formatSignaturesToUseroperationsSignatures with ONE operation ignored
//   `options.validAfter` / `options.validUntil` and encoded 0/0, while the
//   Merkle branch (two or more) honoured them. The owner signs a SafeOp hash
//   that commits to the window, so the module recomputed a different hash.
// - A WebAuthn override key present with value `undefined` erased the class's
//   Passkey module v0.2.1 default, and the base formatter filled in v0.2.0.

const ak = require('../../dist/index.cjs');

const PASSKEY = {
    x: 0x7a2fa39b3c61b3cbab8e44abeac8c9c7a4c1f76d42ae6f47b3b2a96d5c4f1a2bn,
    y: 0x2e8c5f6d4b7a9c1e3f5a8d7b6c4e2f1a9d8c7b6a5e4f3d2c1b0a9f8e7d6c5b4an,
};
const EOA = '0x1a02592A3484c2077d2E5D24482497F85e1980C6';
const ACCOUNT = '0x' + '42'.repeat(20);
const EOA_SIGNATURE = '0x' + '11'.repeat(64) + '1b';

const hex = (addr) => addr.slice(2).toLowerCase();
const op = (nonce) => ({
    sender: ACCOUNT,
    nonce: BigInt(nonce),
    factory: null,
    factoryData: null,
    callData: '0x',
    callGasLimit: 1n,
    verificationGasLimit: 1n,
    preVerificationGas: 1n,
    maxFeePerGas: 1n,
    maxPriorityFeePerGas: 1n,
    paymaster: null,
    paymasterVerificationGasLimit: null,
    paymasterPostOpGasLimit: null,
    paymasterData: null,
    signature: '0x',
    eip7702Auth: null,
});

// 0x ‖ merkle depth (1 byte) ‖ validAfter (6 bytes) ‖ validUntil (6 bytes) ‖ ...
const header = (signature) => signature.slice(0, 2 + 2 + 12 + 12);
const WINDOW = '00000000000a' + '000000000014'; // validAfter 10, validUntil 20

describe.each([
    ['SafeMultiChainSigAccountV1', ak.SafeMultiChainSigAccountV1],
    ['SafeMultiChainSigAccountV2', ak.SafeMultiChainSigAccountV2],
])('%s formatSignaturesToUseroperationsSignatures validity window', (_name, Account) => {
    const pairs = [{ signer: EOA, signature: EOA_SIGNATURE }];
    const format = (entries) => Account.formatSignaturesToUseroperationsSignatures(entries, pairs);

    test('a single operation encodes the window given in options', () => {
        const [signature] = format([{ userOperation: op(0), chainId: 1n, options: { validAfter: 10n, validUntil: 20n } }]);
        expect(header(signature)).toBe('0x00' + WINDOW);
    });

    test('a single operation still encodes a top-level window', () => {
        const [signature] = format([{ userOperation: op(0), chainId: 1n, validAfter: 10n, validUntil: 20n }]);
        expect(header(signature)).toBe('0x00' + WINDOW);
    });

    test('options win over the top-level window, for one operation as for several', () => {
        const entry = (nonce, chainId) => ({
            userOperation: op(nonce),
            chainId,
            validAfter: 1n,
            validUntil: 2n,
            options: { validAfter: 10n, validUntil: 20n },
        });
        expect(header(format([entry(0, 1n)])[0])).toBe('0x00' + WINDOW);
        expect(header(format([entry(0, 1n), entry(1, 10n)])[0])).toBe('0x01' + WINDOW);
    });

    test('no window at all still encodes 0/0', () => {
        const [signature] = format([{ userOperation: op(0), chainId: 1n }]);
        expect(header(signature)).toBe('0x00' + '0'.repeat(24));
    });
});

describe.each([
    ['SafeMultiChainSigAccountV1', ak.SafeMultiChainSigAccountV1],
    ['SafeMultiChainSigAccountV2', ak.SafeMultiChainSigAccountV2],
])('%s an explicit undefined override keeps the v0.2.1 defaults', (_name, Account) => {
    const account = new Account(ACCOUNT);
    const dummy = Account.createDummySignerSignaturePairForExpectedSigners([PASSKEY], { isInit: false })[0];
    const pairs = [{ signer: PASSKEY, signature: dummy.signature }];
    const v021Proxy = hex(Account.createWebAuthnSignerVerifierAddress(PASSKEY.x, PASSKEY.y));
    const v020Proxy = hex(ak.SafeAccountV0_3_0.createWebAuthnSignerVerifierAddress(PASSKEY.x, PASSKEY.y));
    const UNDEFINED_KEYS = {
        webAuthnSignerFactory: undefined,
        webAuthnSignerSingleton: undefined,
        webAuthnSignerProxyCreationCode: undefined,
        eip7212WebAuthnPrecompileVerifier: undefined,
        eip7212WebAuthnContractVerifier: undefined,
    };

    test('formatUserOperationSignature for a deployed account', () => {
        const reference = account.formatUserOperationSignature(pairs, { isInit: false });
        const signature = account.formatUserOperationSignature(pairs, { isInit: false, ...UNDEFINED_KEYS });
        expect(signature).toBe(reference);
        expect(signature.toLowerCase()).toContain(v021Proxy);
        expect(signature.toLowerCase()).not.toContain(v020Proxy);
    });

    test('formatUserOperationSignature for the init operation', () => {
        const signature = account.formatUserOperationSignature(pairs, { isInit: true, webAuthnSharedSigner: undefined });
        expect(signature.toLowerCase()).toContain(hex(Account.DEFAULT_WEB_AUTHN_SHARED_SIGNER));
        expect(signature.toLowerCase()).not.toContain(hex(ak.SafeAccountV0_3_0.DEFAULT_WEB_AUTHN_SHARED_SIGNER));
    });

    test('formatSignaturesToUseroperationsSignatures for one and for several operations', () => {
        const entry = (nonce, chainId) => ({
            userOperation: op(nonce),
            chainId,
            webAuthnSignatureOverrides: { isInit: false, ...UNDEFINED_KEYS },
        });
        for (const entries of [[entry(0, 1n)], [entry(0, 1n), entry(1, 10n)]]) {
            for (const signature of Account.formatSignaturesToUseroperationsSignatures(entries, pairs)) {
                expect(signature.toLowerCase()).toContain(v021Proxy);
                expect(signature.toLowerCase()).not.toContain(v020Proxy);
            }
        }
    });

    test('an explicit undefined validity window falls back to the top-level one', () => {
        const [signature] = Account.formatSignaturesToUseroperationsSignatures(
            [
                {
                    userOperation: op(0),
                    chainId: 1n,
                    validAfter: 10n,
                    validUntil: 20n,
                    options: { validAfter: undefined, validUntil: undefined },
                },
            ],
            [{ signer: EOA, signature: EOA_SIGNATURE }],
        );
        expect(header(signature)).toBe('0x00' + WINDOW);
    });

    test('a real override still wins', () => {
        const custom = '0x' + '77'.repeat(20);
        const signature = account.formatUserOperationSignature(pairs, {
            isInit: false,
            webAuthnSignerFactory: custom,
        });
        const expected = hex(
            Account.createWebAuthnSignerVerifierAddress(PASSKEY.x, PASSKEY.y, { webAuthnSignerFactory: custom }),
        );
        expect(signature.toLowerCase()).toContain(expected);
    });
});
