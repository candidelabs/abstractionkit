// Behaviour that changed in Social Recovery Module v0.2.0 after Certora's
// audit, exercised through the SDK. The happy path (confirm, execute,
// finalize) for both versions lives in recovery.test.js.
const { JsonRpcProvider, Wallet } = require('ethers');
const {
    SafeAccountV0_3_0,
    SocialRecoveryModuleV2,
    sendJsonRpcRequest,
} = require('../../../../dist/index.cjs');
const { runnable, unrunnable, nodeUrl, bundlerUrl } = require('../../_runnable.cjs');

jest.setTimeout(300000);

const TEN_ETH_HEX = '0x8AC7230489E80000';

describe.each(runnable)('Social Recovery Module v0.2.0 audit fixes e2e: $name (chainId $chainId)', (chain) => {
    const node = nodeUrl(chain);
    const bundler = bundlerUrl(chain);
    const chainId = BigInt(chain.chainId);
    const provider = new JsonRpcProvider(node, Number(chainId), { staticNetwork: true });

    const owner = Wallet.createRandom();
    const newOwner = Wallet.createRandom();
    const guardian1 = Wallet.createRandom().connect(provider);
    const guardian2 = Wallet.createRandom().connect(provider);
    const guardian3 = Wallet.createRandom();
    const relayer = Wallet.createRandom();

    // 3-day deployment: the 3-minute one is testnet-only and these suites fork mainnets.
    const srm = new SocialRecoveryModuleV2();

    let smartAccount;
    let accountAddress;
    // Recovery nonce when the recovery under test was executed.
    let executedNonce;

    beforeAll(async () => {
        smartAccount = SafeAccountV0_3_0.initializeNewAccount([owner.address]);
        accountAddress = smartAccount.accountAddress;
        for (const address of [accountAddress, guardian1.address, guardian2.address]) {
            await sendJsonRpcRequest(node, 'anvil_setBalance', [address, TEN_ETH_HEX]);
        }
    });

    async function sendUserOpFromOwner(account, transactions) {
        const userOp = await account.createUserOperation(transactions, node, bundler, {
            verificationGasLimitPercentageMultiplier: 200,
        });
        userOp.signature = account.signUserOperation(userOp, [owner.privateKey], chainId);
        return (await account.sendUserOperation(userOp, bundler)).included();
    }

    async function sendFromGuardian(guardian, metaTransaction) {
        const tx = await guardian.sendTransaction({ to: metaTransaction.to, data: metaTransaction.data });
        const receipt = await tx.wait();
        expect(receipt.status).toBe(1);
    }

    async function expectRevert(from, metaTransaction, reason) {
        await expect(
            provider.call({ from, to: metaTransaction.to, data: metaTransaction.data }),
        ).rejects.toMatchObject({ reason });
    }

    async function signRecovery(newOwners, nonce) {
        const { domain, types, messageValue } = await srm.getRecoveryRequestEip712Data(
            node,
            chainId,
            accountAddress,
            newOwners,
            1n,
            { recoveryNonce: nonce },
        );
        return Promise.all(
            [guardian1, guardian2].map(async (guardian) => ({
                signer: guardian.address,
                signature: await guardian.signTypedData(domain, types, messageValue),
            })),
        );
    }

    test('set up an account with two guardians (threshold 2)', async () => {
        const deploy = await sendUserOpFromOwner(smartAccount, [
            { to: owner.address, value: 0n, data: '0x' },
        ]);
        expect(deploy?.success).toBe(true);

        // The guardian calls go through MultiSend; v0.2.0 rejects them unless
        // their calldata has the exact canonical length (Certora L-05).
        smartAccount = new SafeAccountV0_3_0(accountAddress);
        const receipt = await sendUserOpFromOwner(smartAccount, [
            srm.createEnableModuleMetaTransaction(accountAddress),
            srm.createAddGuardianWithThresholdMetaTransaction(guardian1.address, 1n),
            srm.createAddGuardianWithThresholdMetaTransaction(guardian2.address, 2n),
        ]);
        expect(receipt?.success).toBe(true);
        expect(await srm.getGuardians(node, accountAddress)).toHaveLength(2);
        expect(await srm.threshold(node, accountAddress)).toBe(2n);
    });

    test('confirmRecovery rejects a nonce other than the current one (I-09)', async () => {
        const nonce = await srm.nonce(node, accountAddress);
        const confirm = srm.createConfirmRecoveryMetaTransaction(
            accountAddress,
            [newOwner.address],
            1,
            nonce + 1n,
            false,
        );
        await expectRevert(guardian1.address, confirm, 'SM: invalid nonce');
    });

    test('confirmRecovery rejects a guardian as a new owner (M-01)', async () => {
        const nonce = await srm.nonce(node, accountAddress);
        const confirm = srm.createConfirmRecoveryMetaTransaction(
            accountAddress,
            [guardian2.address],
            1,
            nonce,
            false,
        );
        await expectRevert(guardian1.address, confirm, 'SM: new owner cannot be guardian');
    });

    test('a single guardian confirms without executing', async () => {
        const nonce = await srm.nonce(node, accountAddress);
        await sendFromGuardian(
            guardian1,
            srm.createConfirmRecoveryMetaTransaction(accountAddress, [newOwner.address], 1, nonce, false),
        );

        expect(
            await srm.hasGuardianApproved(node, accountAddress, guardian1.address, [newOwner.address], 1),
        ).toBe(true);
        expect(await srm.getRecoveryApprovals(node, accountAddress, [newOwner.address], 1)).toBe(1n);
        expect((await srm.getRecoveryRequest(node, accountAddress)).executableAt).toBe(0n);
    });

    test('the second guardian confirms and executes the recovery', async () => {
        executedNonce = await srm.nonce(node, accountAddress);
        await sendFromGuardian(
            guardian2,
            srm.createConfirmRecoveryMetaTransaction(
                accountAddress,
                [newOwner.address],
                1,
                executedNonce,
                true,
            ),
        );

        const request = await srm.getRecoveryRequest(node, accountAddress);
        expect(request.guardiansApprovalCount).toBe(2n);
        expect(request.nonce).toBe(executedNonce);
        expect(request.executableAt).toBeGreaterThan(0n);
        expect(request.newOwners).toEqual([newOwner.address]);
        expect(await srm.nonce(node, accountAddress)).toBe(executedNonce + 1n);
    });

    test('a guardian configuration change cancels the recovery (L-03)', async () => {
        const receipt = await sendUserOpFromOwner(smartAccount, [
            srm.createAddGuardianWithThresholdMetaTransaction(guardian3.address, 2n),
        ]);
        expect(receipt?.success).toBe(true);

        const request = await srm.getRecoveryRequest(node, accountAddress);
        expect(request.executableAt).toBe(0n);
        expect(request.newOwners).toEqual([]);
        expect(await srm.nonce(node, accountAddress)).toBe(executedNonce + 2n);
        await expectRevert(
            relayer.address,
            srm.createFinalizeRecoveryMetaTransaction(accountAddress),
            'SM: no ongoing recovery',
        );
    });

    test('cancelRecovery with no recovery in progress invalidates collected signatures (I-02)', async () => {
        const nonce = await srm.nonce(node, accountAddress);
        const signatures = await signRecovery([newOwner.address], nonce);

        const receipt = await sendUserOpFromOwner(smartAccount, [
            srm.createCancelRecoveryMetaTransaction(),
        ]);
        expect(receipt?.success).toBe(true);
        expect(await srm.nonce(node, accountAddress)).toBe(nonce + 1n);

        // The signatures name the old nonce, which is no longer current.
        await expectRevert(
            relayer.address,
            srm.createMultiConfirmRecoveryMetaTransaction(
                accountAddress,
                [newOwner.address],
                1,
                nonce,
                signatures,
                true,
            ),
            'SM: invalid nonce',
        );
        // Under the current nonce the recovery hash differs, so they no longer verify.
        await expectRevert(
            relayer.address,
            srm.createMultiConfirmRecoveryMetaTransaction(
                accountAddress,
                [newOwner.address],
                1,
                nonce + 1n,
                signatures,
                true,
            ),
            'SM: Invalid guardian signature',
        );
    });
});

if (unrunnable.length > 0) {
    describe.skip.each(unrunnable)('Social Recovery Module v0.2.0 audit fixes e2e: $name (setup failed)', () => {
        test('skipped', () => {});
    });
}
