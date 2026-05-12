const { Wallet } = require('ethers');
const {
    SafeAccountV0_3_0,
    SocialRecoveryModule,
    SocialRecoveryModuleGracePeriodSelector,
    sendJsonRpcRequest,
} = require('../../../../dist/index.cjs');
const { runnable, unrunnable, nodeUrl, bundlerUrl } = require('../../_runnable.cjs');

jest.setTimeout(300000);

const TEN_ETH_HEX = '0x8AC7230489E80000';
const GRACE_PERIOD_SECONDS = 3 * 60;
const GET_OWNERS_SELECTOR = '0xa0e67e2b'; // Safe.getOwners()

describe.each(runnable)('Social Recovery Module e2e: $name (chainId $chainId)', (chain) => {
    const node = nodeUrl(chain);
    const bundler = bundlerUrl(chain);
    const chainId = BigInt(chain.chainId);

    const owner = Wallet.createRandom();
    const newOwner = Wallet.createRandom();
    const guardian1 = Wallet.createRandom();
    const guardian2 = Wallet.createRandom();

    // After3Minutes deployment: short grace period suitable for tests.
    const srm = new SocialRecoveryModule(SocialRecoveryModuleGracePeriodSelector.After3Minutes);

    let smartAccount;
    let accountAddress;

    beforeAll(async () => {
        smartAccount = SafeAccountV0_3_0.initializeNewAccount([owner.address]);
        accountAddress = smartAccount.accountAddress;
        await sendJsonRpcRequest(node, 'anvil_setBalance', [accountAddress, TEN_ETH_HEX]);
    });

    async function sendUserOpFromOwner(account, transactions) {
        const userOp = await account.createUserOperation(transactions, node, bundler, {
            verificationGasLimitPercentageMultiplier: 200,
        });
        userOp.signature = account.signUserOperation(userOp, [owner.privateKey], chainId);
        return (await account.sendUserOperation(userOp, bundler)).included();
    }

    test('deploy account first', async () => {
        const receipt = await sendUserOpFromOwner(smartAccount, [
            { to: owner.address, value: 0n, data: '0x' },
        ]);
        expect(receipt?.success).toBe(true);

        const code = await sendJsonRpcRequest(node, 'eth_getCode', [accountAddress, 'latest']);
        expect(code).not.toBe('0x');
    });

    test('enable social recovery module and add two guardians (threshold 2)', async () => {
        smartAccount = new SafeAccountV0_3_0(accountAddress);
        const enableModule = srm.createEnableModuleMetaTransaction(accountAddress);
        const addGuardian1 = srm.createAddGuardianWithThresholdMetaTransaction(guardian1.address, 1n);
        const addGuardian2 = srm.createAddGuardianWithThresholdMetaTransaction(guardian2.address, 2n);

        const receipt = await sendUserOpFromOwner(smartAccount, [enableModule, addGuardian1, addGuardian2]);
        expect(receipt?.success).toBe(true);
    });

    test('verify guardians and threshold', async () => {
        expect(await srm.isGuardian(node, accountAddress, guardian1.address)).toBe(true);
        expect(await srm.isGuardian(node, accountAddress, guardian2.address)).toBe(true);
        expect(await srm.threshold(node, accountAddress)).toBe(2n);
    });

    test('multi-confirm recovery with both guardian signatures + execute (one userop)', async () => {
        const { domain, types, messageValue } = await srm.getRecoveryRequestEip712Data(
            node,
            chainId,
            accountAddress,
            [newOwner.address],
            1n,
        );
        const { EIP712Domain, ...typesForSigning } = types;
        const sig1 = await guardian1.signTypedData(domain, typesForSigning, messageValue);
        const sig2 = await guardian2.signTypedData(domain, typesForSigning, messageValue);

        const multiConfirm = srm.createMultiConfirmRecoveryMetaTransaction(
            accountAddress,
            [newOwner.address],
            1,
            [
                { signer: guardian1.address, signature: sig1 },
                { signer: guardian2.address, signature: sig2 },
            ],
            true, // execute=true: also start the recovery in the same call
        );

        // NOTE: We send this as a userop from the Safe purely for consistency with
        // the rest of the suite. `multiConfirmRecovery` is permissioned by guardian
        // signatures (not msg.sender), so any funded EOA can submit it as a regular
        // transaction with the same effect.
        const receipt = await sendUserOpFromOwner(smartAccount, [multiConfirm]);
        expect(receipt?.success).toBe(true);
    });

    test('finalize recovery after grace period', async () => {
        await sendJsonRpcRequest(node, 'evm_increaseTime', [GRACE_PERIOD_SECONDS + 1]);
        await sendJsonRpcRequest(node, 'evm_mine', []);

        const finalize = srm.createFinalizeRecoveryMetaTransaction(accountAddress);

        // NOTE: `finalizeRecovery` is also public — anyone may call it once the
        // grace period has elapsed. We use a userop here for the same convenience
        // reason as above.
        const receipt = await sendUserOpFromOwner(smartAccount, [finalize]);
        expect(receipt?.success).toBe(true);
    });

    test('owner has been rotated to newOwner', async () => {
        const result = await sendJsonRpcRequest(node, 'eth_call', [
            { to: accountAddress, data: GET_OWNERS_SELECTOR },
            'latest',
        ]);
        const haystack = result.toLowerCase();
        expect(haystack).toContain(newOwner.address.slice(2).toLowerCase());
        expect(haystack).not.toContain(owner.address.slice(2).toLowerCase());
    });
});

if (unrunnable.length > 0) {
    describe.skip.each(unrunnable)('Social Recovery Module e2e: $name (setup failed)', () => {
        test('skipped', () => {});
    });
}
