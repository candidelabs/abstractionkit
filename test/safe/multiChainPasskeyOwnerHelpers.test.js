// Regression tests: the owner helpers on the base SafeAccount derived
// passkey owner addresses from the v0.2.0 Safe Passkey module defaults no
// matter which class was constructed. On SafeMultiChainSigAccountV1 / V2
// (Passkey module v0.2.1) that registered an owner signing never matched,
// and swap/remove looked up an address that was never an owner. The helpers
// now dispatch through the constructed class's static address derivation.
// Offline, with a mocked node transport.

const { AbiCoder } = require('ethers');
const ak = require('../../dist/index.cjs');

const ACCOUNT = '0x' + '42'.repeat(20);
const EOA_OWNER = '0x1a02592A3484c2077d2E5D24482497F85e1980C6';
const CUSTOM_SIGNER_FACTORY = '0x' + '77'.repeat(20);
const PASSKEY = {
    x: 0x7a2fa39b3c61b3cbab8e44abeac8c9c7a4c1f76d42ae6f47b3b2a96d5c4f1a2bn,
    y: 0x2e8c5f6d4b7a9c1e3f5a8d7b6c4e2f1a9d8c7b6a5e4f3d2c1b0a9f8e7d6c5b4an,
};
const OTHER_PASSKEY = {
    x: 0x1111111111111111111111111111111111111111111111111111111111111111n,
    y: 0x2222222222222222222222222222222222222222222222222222222222222222n,
};

const GET_OWNERS_SELECTOR = '0xa0e67e2b';

const V0_2_0_PROXY = ak.SafeAccountV0_3_0.createWebAuthnSignerVerifierAddress(PASSKEY.x, PASSKEY.y);
const V0_2_1_PROXY = ak.SafeMultiChainSigAccountV1.createWebAuthnSignerVerifierAddress(
    PASSKEY.x,
    PASSKEY.y,
);

// A node whose Safe reports `owners` and where `deployed` addresses have code.
function nodeMock({ owners = [], deployed = [] } = {}) {
    const lower = deployed.map((a) => a.toLowerCase());
    return {
        request: async ({ method, params }) => {
            if (method === 'eth_getCode') {
                return lower.includes(params[0].toLowerCase()) ? '0x6080' : '0x';
            }
            if (method === 'eth_call' && params[0].data.startsWith(GET_OWNERS_SELECTOR)) {
                return AbiCoder.defaultAbiCoder().encode(['address[]'], [owners]);
            }
            throw new Error(`unexpected rpc ${method}`);
        },
    };
}

const includesAddress = (hex, address) =>
    hex.toLowerCase().includes(address.slice(2).toLowerCase());

test('the v0.2.0 and v0.2.1 modules derive different proxies for the same key', () => {
    expect(V0_2_0_PROXY).not.toBe(V0_2_1_PROXY);
});

describe.each([
    ['SafeMultiChainSigAccountV1', ak.SafeMultiChainSigAccountV1],
    ['SafeMultiChainSigAccountV2', ak.SafeMultiChainSigAccountV2],
])('%s passkey owner helpers', (_name, Account) => {
    const account = new Account(ACCOUNT);

    test('addOwner registers the v0.2.1 proxy and deploys it through the v0.2.1 factory', async () => {
        const metaTxs = await account.createAddOwnerWithThresholdMetaTransactions(PASSKEY, 1, {
            nodeRpcUrl: nodeMock(),
        });
        expect(metaTxs).toHaveLength(2);
        const [deploy, add] = metaTxs;
        expect(deploy.to.toLowerCase()).toBe(
            ak.SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_SIGNER_FACTORY.toLowerCase(),
        );
        expect(includesAddress(add.data, V0_2_1_PROXY)).toBe(true);
        expect(includesAddress(add.data, V0_2_0_PROXY)).toBe(false);
    });

    test('addOwner skips the deploy when the v0.2.1 proxy already has code', async () => {
        const metaTxs = await account.createAddOwnerWithThresholdMetaTransactions(PASSKEY, 1, {
            nodeRpcUrl: nodeMock({ deployed: [V0_2_1_PROXY] }),
        });
        expect(metaTxs).toHaveLength(1);
        expect(includesAddress(metaTxs[0].data, V0_2_1_PROXY)).toBe(true);
    });

    test('removeOwner finds a v0.2.1 passkey owner', async () => {
        const metaTx = await account.createRemoveOwnerMetaTransaction(
            nodeMock({ owners: [EOA_OWNER, V0_2_1_PROXY] }),
            PASSKEY,
            1,
        );
        expect(includesAddress(metaTx.data, V0_2_1_PROXY)).toBe(true);
        expect(includesAddress(metaTx.data, EOA_OWNER)).toBe(true); // prevOwner
    });

    test('swapOwner finds a v0.2.1 passkey owner and derives the replacement the same way', async () => {
        const replacement = ak.SafeMultiChainSigAccountV1.createWebAuthnSignerVerifierAddress(
            OTHER_PASSKEY.x,
            OTHER_PASSKEY.y,
        );
        const metaTxs = await account.createSwapOwnerMetaTransactions(
            nodeMock({ owners: [V0_2_1_PROXY], deployed: [V0_2_1_PROXY] }),
            OTHER_PASSKEY,
            PASSKEY,
        );
        expect(metaTxs).toHaveLength(2);
        const [deploy, swap] = metaTxs;
        expect(deploy.to.toLowerCase()).toBe(
            ak.SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_SIGNER_FACTORY.toLowerCase(),
        );
        expect(includesAddress(swap.data, V0_2_1_PROXY)).toBe(true);
        expect(includesAddress(swap.data, replacement)).toBe(true);
    });

    test('the registered owner is the address the account signs with', () => {
        // Hand the formatter the raw public key so it derives the signer
        // address itself, the way signUserOperation does for a passkey owner.
        const [dummy] = Account.createDummySignerSignaturePairForExpectedSigners([PASSKEY], {
            isInit: false,
        });
        const signature = account.formatUserOperationSignature(
            [{ signer: PASSKEY, signature: dummy.signature }],
            { isInit: false },
        );
        expect(includesAddress(signature, V0_2_1_PROXY)).toBe(true);
        expect(includesAddress(signature, V0_2_0_PROXY)).toBe(false);
    });

    test('a per-call override still wins over the class default', async () => {
        const expected = ak.SafeMultiChainSigAccountV1.createWebAuthnSignerVerifierAddress(
            PASSKEY.x,
            PASSKEY.y,
            { webAuthnSignerFactory: CUSTOM_SIGNER_FACTORY },
        );
        const [deploy, add] = await account.createAddOwnerWithThresholdMetaTransactions(PASSKEY, 1, {
            nodeRpcUrl: nodeMock(),
            webAuthnSignerFactory: CUSTOM_SIGNER_FACTORY,
        });
        expect(deploy.to.toLowerCase()).toBe(CUSTOM_SIGNER_FACTORY.toLowerCase());
        expect(includesAddress(add.data, expected)).toBe(true);
        expect(includesAddress(add.data, V0_2_1_PROXY)).toBe(false);
    });
});

describe('SafeAccountV0_3_0 keeps the v0.2.0 defaults', () => {
    const account = new ak.SafeAccountV0_3_0(ACCOUNT);

    test('addOwner registers the v0.2.0 proxy', async () => {
        const [deploy, add] = await account.createAddOwnerWithThresholdMetaTransactions(PASSKEY, 1, {
            nodeRpcUrl: nodeMock(),
        });
        expect(deploy.to.toLowerCase()).toBe(
            ak.SafeAccountV0_3_0.DEFAULT_WEB_AUTHN_SIGNER_FACTORY.toLowerCase(),
        );
        expect(includesAddress(add.data, V0_2_0_PROXY)).toBe(true);
    });

    test('removeOwner still rejects an owner that is not current', async () => {
        await expect(
            account.createRemoveOwnerMetaTransaction(nodeMock({ owners: [EOA_OWNER] }), PASSKEY, 1),
        ).rejects.toThrow('ownerToDelete is not a current owner.');
    });
});
