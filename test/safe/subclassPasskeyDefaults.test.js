// Regression tests: a consumer subclass of SafeAccountV0_2_0 / SafeAccountV0_3_0
// that overrides the Passkey module defaults (for example to move to module
// v0.2.1) must be initialised with the same owner it later signs with.
//
// The signing statics already read the defaults of the class they are called
// on, but the init path read `SafeAccount.DEFAULT_WEB_AUTHN_*` by name: the
// account was set up with the base shared signer and swapped to the base
// proxy, while signatures named the subclass's. Offline.

const ak = require('../../dist/index.cjs');

const PASSKEY = {
    x: 0x7a2fa39b3c61b3cbab8e44abeac8c9c7a4c1f76d42ae6f47b3b2a96d5c4f1a2bn,
    y: 0x2e8c5f6d4b7a9c1e3f5a8d7b6c4e2f1a9d8c7b6a5e4f3d2c1b0a9f8e7d6c5b4an,
};
const EOA = '0x1a02592A3484c2077d2E5D24482497F85e1980C6';
const V021 = ak.SafeMultiChainSigAccountV1;
const hex = (addr) => addr.slice(2).toLowerCase();

const SHARED_SIGNER_OVERRIDES = {
    webAuthnSharedSigner: V021.DEFAULT_WEB_AUTHN_SHARED_SIGNER,
    eip7212WebAuthnPrecompileVerifierForSharedSigner: V021.DEFAULT_WEB_AUTHN_PRECOMPILE,
    eip7212WebAuthnContractVerifierForSharedSigner: V021.DEFAULT_WEB_AUTHN_CONTRACT_VERIFIER,
};

function withV021Defaults(Base) {
    return class extends Base {
        static DEFAULT_WEB_AUTHN_SHARED_SIGNER = V021.DEFAULT_WEB_AUTHN_SHARED_SIGNER;
        static DEFAULT_WEB_AUTHN_PRECOMPILE = V021.DEFAULT_WEB_AUTHN_PRECOMPILE;
        static DEFAULT_WEB_AUTHN_CONTRACT_VERIFIER = V021.DEFAULT_WEB_AUTHN_CONTRACT_VERIFIER;
        static DEFAULT_WEB_AUTHN_SIGNER_FACTORY = V021.DEFAULT_WEB_AUTHN_SIGNER_FACTORY;
        static DEFAULT_WEB_AUTHN_SIGNER_SINGLETON = V021.DEFAULT_WEB_AUTHN_SIGNER_SINGLETON;
        static DEFAULT_WEB_AUTHN_SIGNER_PROXY_CREATION_CODE = V021.DEFAULT_WEB_AUTHN_SIGNER_PROXY_CREATION_CODE;
    };
}

describe.each([
    ['SafeAccountV0_2_0', ak.SafeAccountV0_2_0],
    ['SafeAccountV0_3_0', ak.SafeAccountV0_3_0],
])('a %s subclass with Passkey module v0.2.1 defaults', (_name, Base) => {
    const Sub = withV021Defaults(Base);
    const subProxy = Sub.createWebAuthnSignerVerifierAddress(PASSKEY.x, PASSKEY.y);
    const baseProxy = Base.createWebAuthnSignerVerifierAddress(PASSKEY.x, PASSKEY.y);

    test('the subclass really derives a different owner than its parent', () => {
        expect(subProxy).not.toBe(baseProxy);
        expect(subProxy).toBe(V021.createWebAuthnSignerVerifierAddress(PASSKEY.x, PASSKEY.y));
    });

    test('initializeNewAccount configures the subclass shared signer', () => {
        const account = Sub.initializeNewAccount([PASSKEY]);
        const explicit = Base.initializeNewAccount([PASSKEY], SHARED_SIGNER_OVERRIDES);
        expect(account).toBeInstanceOf(Sub);
        expect(account.accountAddress).toBe(explicit.accountAddress);
        expect(account.factoryData).toBe(explicit.factoryData);
        expect(account.accountAddress).not.toBe(Base.initializeNewAccount([PASSKEY]).accountAddress);
        expect(account.factoryData.toLowerCase()).toContain(hex(Sub.DEFAULT_WEB_AUTHN_SHARED_SIGNER));
    });

    test('the address and init-code statics agree with initializeNewAccount', () => {
        const account = Sub.initializeNewAccount([PASSKEY]);
        expect(Sub.createAccountAddress([PASSKEY])).toBe(account.accountAddress);
        expect(Sub.createInitializerCallData([PASSKEY], 1)).toBe(
            Base.createInitializerCallData([PASSKEY], 1, SHARED_SIGNER_OVERRIDES),
        );
        if (Base === ak.SafeAccountV0_2_0) {
            const [address, initCode] = Sub.createAccountAddressAndInitCode([PASSKEY]);
            expect(address).toBe(account.accountAddress);
            expect(initCode).toBe(account.factoryAddress + account.factoryData.slice(2));
            expect(Sub.createInitCode([PASSKEY])).toBe(initCode);
        } else {
            expect(Sub.createFactoryAddressAndData([PASSKEY])).toEqual([account.factoryAddress, account.factoryData]);
        }
    });

    test('the first operation deploys and swaps to the owner the subclass signs with', async () => {
        const account = Sub.initializeNewAccount([PASSKEY]);
        const op = await account.createUserOperation([{ to: EOA, value: 0n, data: '0x' }], undefined, undefined, {
            nonce: 0n,
            maxFeePerGas: 1n,
            maxPriorityFeePerGas: 1n,
            callGasLimit: 1n,
            verificationGasLimit: 1n,
            preVerificationGas: 1n,
            expectedSigners: [PASSKEY],
        });
        const callData = op.callData.toLowerCase();
        expect(callData).toContain(hex(subProxy));
        expect(callData).not.toContain(hex(baseProxy));
        expect(callData).toContain(hex(Sub.DEFAULT_WEB_AUTHN_SIGNER_FACTORY));
        expect(callData).toContain(hex(Sub.DEFAULT_WEB_AUTHN_SHARED_SIGNER));
        // the placeholder signature names the shared signer that was configured
        expect(op.signature.toLowerCase()).toContain(hex(Sub.DEFAULT_WEB_AUTHN_SHARED_SIGNER));
        expect(op.signature.toLowerCase()).not.toContain(hex(Base.DEFAULT_WEB_AUTHN_SHARED_SIGNER));
    });

    test('a per-call override still wins over the subclass default', () => {
        const custom = '0x' + '77'.repeat(20);
        expect(Sub.createAccountAddress([PASSKEY], { webAuthnSharedSigner: custom })).toBe(
            Base.createAccountAddress([PASSKEY], { ...SHARED_SIGNER_OVERRIDES, webAuthnSharedSigner: custom }),
        );
    });

    test('the parent class itself is unchanged', () => {
        const account = Base.initializeNewAccount([PASSKEY]);
        expect(account.factoryData.toLowerCase()).toContain(hex(Base.DEFAULT_WEB_AUTHN_SHARED_SIGNER));
        expect(Base.createAccountAddress([PASSKEY])).toBe(account.accountAddress);
        // detached calls fall back to the parent's defaults
        const detached = Base.createAccountAddress;
        expect(detached([PASSKEY])).toBe(account.accountAddress);
    });
});

test('SafeAccountV0_2_0.initializeNewAccount reports the singleton it derived the address from', () => {
    const account = ak.SafeAccountV0_2_0.initializeNewAccount([EOA], { safeAccountSingleton: ak.Safe_L2_V1_5_0 });
    expect(account.safeAccountSingleton).toEqual(ak.Safe_L2_V1_5_0);
    expect(account.accountAddress).toBe(
        ak.SafeAccountV0_2_0.createAccountAddress([EOA], { safeAccountSingleton: ak.Safe_L2_V1_5_0 }),
    );
    expect(ak.SafeAccountV0_2_0.initializeNewAccount([EOA]).safeAccountSingleton).toEqual(ak.Safe_L2_V1_4_1);
    expect(
        new ak.SafeAccountV0_2_0(account.accountAddress, { safeAccountSingleton: ak.Safe_L2_V1_5_0 })
            .safeAccountSingleton,
    ).toEqual(ak.Safe_L2_V1_5_0);
});
