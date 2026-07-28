// Regression tests: a V0.6 overrides.initCode must be resolved before the
// dummy signature and gas estimation are built — isInit derives from the
// final initCode, not from the account's factory fields, so a caller-supplied
// "0x" selects the deployed-account WebAuthn owner encoding and the
// estimation op carries the same initCode as the returned op. Offline.

const ak = require('../../dist/index.cjs');

const WEBAUTHN_KEY = {
    x: 0x7a2fa39b3c61b3cbab8e44abeac8c9c7a4c1f76d42ae6f47b3b2a96d5c4f1a2bn,
    y: 0x2e8c5f6d4b7a9c1e3f5a8d7b6c4e2f1a9d8c7b6a5e4f3d2c1b0a9f8e7d6c5b4an,
};
const EOA_OWNER = '0x' + '42'.repeat(20);

const GAS_RESULT = {
    callGasLimit: '0x10000',
    verificationGasLimit: '0x10000',
    preVerificationGas: '0x10000',
};

// signature layout: 0x + validAfter (6 bytes) + validUntil (6 bytes) + static
// segments (65 bytes per signer: r = padded owner address, s = offset, v).
// The encoded owner address sits in bytes 12..32 of the first segment's r.
function encodedOwner(signature) {
    return signature.slice(2 + 24).slice(24, 64);
}

async function createV6UserOperation(overrides = {}) {
    const captured = [];
    const bundler = new ak.Bundler({
        request: async ({ method, params }) => {
            captured.push({ method, params });
            return GAS_RESULT;
        },
    });
    const account = ak.SafeAccountV0_2_0.initializeNewAccount([EOA_OWNER]);
    const userOperation = await account.createUserOperation(
        [{ to: EOA_OWNER, value: 0n, data: '0x' }],
        undefined,
        bundler,
        {
            nonce: 0n,
            maxFeePerGas: 1n,
            maxPriorityFeePerGas: 1n,
            expectedSigners: [WEBAUTHN_KEY],
            ...overrides,
        },
    );
    const estimatedOp = captured.find(
        (c) => c.method === 'eth_estimateUserOperationGas',
    ).params[0];
    return { userOperation, estimatedOp };
}

describe('V0.6 overrides.initCode and isInit resolution', () => {
    test('without an override the estimation op carries the factory initCode and the init-mode shared signer', async () => {
        const { userOperation, estimatedOp } = await createV6UserOperation();
        expect(userOperation.initCode).not.toBe('0x');
        expect(estimatedOp.initCode).toBe(userOperation.initCode);
        expect(encodedOwner(estimatedOp.signature)).toBe(
            ak.SafeAccountV0_2_0.DEFAULT_WEB_AUTHN_SHARED_SIGNER.slice(2).toLowerCase(),
        );
    });

    test('overriding initCode to "0x" selects the deployed-account owner encoding and estimation initCode', async () => {
        const { userOperation, estimatedOp } = await createV6UserOperation({
            initCode: '0x',
        });
        expect(userOperation.initCode).toBe('0x');
        expect(estimatedOp.initCode).toBe('0x');
        const verifierProxy = ak.SafeAccountV0_2_0.createWebAuthnSignerVerifierAddress(
            WEBAUTHN_KEY.x,
            WEBAUTHN_KEY.y,
        );
        expect(encodedOwner(estimatedOp.signature)).toBe(
            verifierProxy.slice(2).toLowerCase(),
        );
    });

    test('a custom initCode override reaches the estimation op verbatim', async () => {
        const customInitCode = '0x' + '11'.repeat(20) + 'deadbeef';
        const { userOperation, estimatedOp } = await createV6UserOperation({
            initCode: customInitCode,
        });
        expect(userOperation.initCode).toBe(customInitCode);
        expect(estimatedOp.initCode).toBe(customInitCode);
        // still init mode: the shared signer is the encoded owner
        expect(encodedOwner(estimatedOp.signature)).toBe(
            ak.SafeAccountV0_2_0.DEFAULT_WEB_AUTHN_SHARED_SIGNER.slice(2).toLowerCase(),
        );
    });
});
