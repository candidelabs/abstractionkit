// Regression test: during account init the encoded owner for a WebAuthn
// signer is the shared signer, so sorting must use the shared-signer
// address too — not the per-owner verifier-proxy address. Offline.

const ak = require('../../dist/index.cjs');

const WEBAUTHN_KEY = {
    x: 0x7a2fa39b3c61b3cbab8e44abeac8c9c7a4c1f76d42ae6f47b3b2a96d5c4f1a2bn,
    y: 0x2e8c5f6d4b7a9c1e3f5a8d7b6c4e2f1a9d8c7b6a5e4f3d2c1b0a9f8e7d6c5b4an,
};

const SHARED_SIGNER = ak.SafeAccountV0_3_0.DEFAULT_WEB_AUTHN_SHARED_SIGNER;
// one below the shared signer, so: verifierProxy < EOA < sharedSigner
const EOA = '0x' + (BigInt(SHARED_SIGNER) - 1n).toString(16).padStart(40, '0');

const WEBAUTHN_SIG = '0x' + 'ab'.repeat(320);
const EOA_SIG = '0x' + '22'.repeat(32) + '33'.repeat(32) + '1c';

describe('WebAuthn init signature sorting', () => {
    const verifierProxy = ak.SafeAccountV0_3_0.createWebAuthnSignerVerifierAddress(
        WEBAUTHN_KEY.x,
        WEBAUTHN_KEY.y,
    );

    test('fixture precondition: verifierProxy < EOA < sharedSigner', () => {
        expect(verifierProxy.toLowerCase() < EOA.toLowerCase()).toBe(true);
        expect(EOA.toLowerCase() < SHARED_SIGNER.toLowerCase()).toBe(true);
    });

    test('isInit: true sorts by the shared-signer address that gets encoded', () => {
        const sig = ak.SafeAccountV0_3_0.buildSignaturesFromSingerSignaturePairs(
            [
                { signer: WEBAUTHN_KEY, signature: WEBAUTHN_SIG },
                { signer: EOA, signature: EOA_SIG },
            ],
            { isInit: true },
        );
        const seg1 = sig.slice(2, 132);
        const seg2 = sig.slice(132, 262);
        // EOA (lower address) must come first: its segment ends with v=0x1c
        expect(seg1.endsWith('1c')).toBe(true);
        // contract-signature segment second: owner = shared signer, v=0
        expect(seg2.slice(24, 64)).toBe(SHARED_SIGNER.slice(2).toLowerCase());
        expect(seg2.slice(128, 130)).toBe('00');
    });

    test('isInit: false still sorts by the verifier-proxy address', () => {
        const sig = ak.SafeAccountV0_3_0.buildSignaturesFromSingerSignaturePairs(
            [
                { signer: EOA, signature: EOA_SIG },
                { signer: WEBAUTHN_KEY, signature: WEBAUTHN_SIG },
            ],
            { isInit: false },
        );
        const seg1 = sig.slice(2, 132);
        // verifier proxy (lower address) comes first as the contract signature
        expect(seg1.slice(24, 64)).toBe(verifierProxy.slice(2).toLowerCase());
        expect(seg1.slice(128, 130)).toBe('00');
    });
});
