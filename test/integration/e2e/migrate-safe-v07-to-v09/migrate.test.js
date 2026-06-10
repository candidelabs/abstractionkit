// e2e: migrate a DEPLOYED Safe from EntryPoint v0.7 (SafeAccountV0_3_0) to
// EntryPoint v0.9 (SafeMultiChainSigAccountV1) by swapping the 4337 module +
// fallback handler, then prove the upgraded account operates on v0.9.
//
// Cross-EntryPoint: the deploy + migrate ops are validated by the v0.7 module
// and routed through the v7 bundler; the post-migration op runs through the v9
// bundler against the same anvil node. Self-funded via anvil_setBalance — no
// paymaster needed.

const { Wallet } = require('ethers');
const {
    SafeAccountV0_3_0,
    SafeMultiChainSigAccountV1,
    sendJsonRpcRequest,
} = require('../../../../dist/index.cjs');
const { runnable, unrunnable, nodeUrl, bundlerUrl } = require('../../_runnable.cjs');

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
        const batch = await oldAccount.createMigrateToSafeMultiChainSigAccountV1MetaTransactions(node);
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
});

if (unrunnable.length > 0) {
    describe.skip.each(unrunnable)('Safe v0.7 -> v0.9 migration e2e: $name (setup failed)', () => {
        test('skipped', () => {});
    });
}
