// Regression tests: baseEstimateUserOperationGas must accept user-supplied
// dummySignerSignaturePairs containing raw WebauthnPublicKey signers —
// deriving isInit from the operation's own init fields — and must forward
// the WebAuthn verifier-config overrides so deployed accounts with custom
// verifier setups encode the correct owner address. Offline.

const ak = require('../../dist/index.cjs');

const WEBAUTHN_KEY = {
    x: 0x7a2fa39b3c61b3cbab8e44abeac8c9c7a4c1f76d42ae6f47b3b2a96d5c4f1a2bn,
    y: 0x2e8c5f6d4b7a9c1e3f5a8d7b6c4e2f1a9d8c7b6a5e4f3d2c1b0a9f8e7d6c5b4an,
};
const WEBAUTHN_SIG = '0x' + 'ab'.repeat(320);
const ACCOUNT = '0x' + '42'.repeat(20);
const CUSTOM_SIGNER_FACTORY = '0x' + '77'.repeat(20);

const GAS_RESULT = {
    callGasLimit: '0x10000',
    verificationGasLimit: '0x10000',
    preVerificationGas: '0x10000',
};

function estimateWithDummyPairs({ factory, overrides = {} }) {
    const captured = [];
    const bundler = new ak.Bundler({
        request: async ({ method, params }) => {
            captured.push({ method, params });
            return GAS_RESULT;
        },
    });
    const account = new ak.SafeAccountV0_3_0(ACCOUNT);
    const userOperation = {
        sender: ACCOUNT,
        nonce: 0n,
        factory,
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
    const estimation = account.baseEstimateUserOperationGas(userOperation, bundler, {
        dummySignerSignaturePairs: [{ signer: WEBAUTHN_KEY, signature: WEBAUTHN_SIG }],
        ...overrides,
    });
    return { estimation, captured };
}

// signature layout: 0x + validAfter (6 bytes) + validUntil (6 bytes) + static
// segments (65 bytes per signer: r = padded owner address, s = offset, v).
// The encoded owner address sits in bytes 12..32 of the first segment's r.
function encodedOwner(signature) {
    return signature.slice(2 + 24).slice(24, 64);
}

describe('WebAuthn dummySignerSignaturePairs in baseEstimateUserOperationGas', () => {
    test('init op: derives isInit from the factory field and encodes the shared signer', async () => {
        const { estimation, captured } = estimateWithDummyPairs({
            factory: '0x' + '11'.repeat(20),
        });
        await expect(estimation).resolves.toBeDefined();
        const sentOp = captured[0].params[0];
        expect(encodedOwner(sentOp.signature)).toBe(
            ak.SafeAccountV0_3_0.DEFAULT_WEB_AUTHN_SHARED_SIGNER.slice(2).toLowerCase(),
        );
    });

    test('deployed op: encodes the per-owner verifier-proxy address', async () => {
        const { estimation, captured } = estimateWithDummyPairs({ factory: null });
        await expect(estimation).resolves.toBeDefined();
        const sentOp = captured[0].params[0];
        const verifierProxy = ak.SafeAccountV0_3_0.createWebAuthnSignerVerifierAddress(
            WEBAUTHN_KEY.x,
            WEBAUTHN_KEY.y,
        );
        expect(encodedOwner(sentOp.signature)).toBe(verifierProxy.slice(2).toLowerCase());
    });

    test('deployed op: forwards custom verifier-config overrides to the encoder', async () => {
        const { estimation, captured } = estimateWithDummyPairs({
            factory: null,
            overrides: { webAuthnSignerFactory: CUSTOM_SIGNER_FACTORY },
        });
        await expect(estimation).resolves.toBeDefined();
        const sentOp = captured[0].params[0];
        const customVerifierProxy = ak.SafeAccountV0_3_0.createWebAuthnSignerVerifierAddress(
            WEBAUTHN_KEY.x,
            WEBAUTHN_KEY.y,
            { webAuthnSignerFactory: CUSTOM_SIGNER_FACTORY },
        );
        const defaultVerifierProxy = ak.SafeAccountV0_3_0.createWebAuthnSignerVerifierAddress(
            WEBAUTHN_KEY.x,
            WEBAUTHN_KEY.y,
        );
        expect(customVerifierProxy).not.toBe(defaultVerifierProxy);
        expect(encodedOwner(sentOp.signature)).toBe(customVerifierProxy.slice(2).toLowerCase());
    });
});
