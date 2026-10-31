// Behaviour that changed in Social Recovery Module v0.2.0 after Certora's
// audit, exercised through the SDK. The happy path (confirm, execute,
// finalize) for both versions lives in recovery.test.js.
const { Interface, JsonRpcProvider, Wallet } = require('ethers');
const {
    Operation,
    SAFE_MESSAGE_MODULE_TYPE,
    SafeAccountV0_3_0,
    SocialRecoveryModuleV2,
    sendJsonRpcRequest,
} = require('../../../../dist/index.cjs');
const { runnable, unrunnable, nodeUrl, bundlerUrl } = require('../../_runnable.cjs');

jest.setTimeout(300000);

const TEN_ETH_HEX = '0x8AC7230489E80000';
// Safe v1.4.1 SignMessageLib. Delegatecalled by a Safe, it marks a message
// as signed so the Safe accepts it with an empty EIP-1271 signature.
const SIGN_MESSAGE_LIB = '0xd53cd0aB83D845Ac265BE939c57F53AD838012c9';
const signMessageLib = new Interface(['function signMessage(bytes _data)']);

// Shared RPC helpers for one chain.
function harness(chain) {
    const node = nodeUrl(chain);
    const bundler = bundlerUrl(chain);
    const chainId = BigInt(chain.chainId);
    const provider = new JsonRpcProvider(node, Number(chainId), { staticNetwork: true });

    async function fund(...addresses) {
        for (const address of addresses) {
            await sendJsonRpcRequest(node, 'anvil_setBalance', [address, TEN_ETH_HEX]);
        }
    }

    async function sendUserOp(account, signer, transactions) {
        const userOp = await account.createUserOperation(transactions, node, bundler, {
            verificationGasLimitPercentageMultiplier: 200,
        });
        userOp.signature = account.signUserOperation(userOp, [signer.privateKey], chainId);
        return (await account.sendUserOperation(userOp, bundler)).included();
    }

    async function sendTx(wallet, metaTransaction) {
        const tx = await wallet.sendTransaction({ to: metaTransaction.to, data: metaTransaction.data });
        const receipt = await tx.wait();
        expect(receipt.status).toBe(1);
    }

    async function expectRevert(from, metaTransaction, reason) {
        await expect(
            provider.call({ from, to: metaTransaction.to, data: metaTransaction.data }),
        ).rejects.toMatchObject({ reason });
    }

    // Deploys a fresh single-owner Safe and returns it as a deployed account.
    async function deploySafe(owner) {
        const account = SafeAccountV0_3_0.initializeNewAccount([owner.address]);
        await fund(account.accountAddress);
        const receipt = await sendUserOp(account, owner, [{ to: owner.address, value: 0n, data: '0x' }]);
        expect(receipt?.success).toBe(true);
        return new SafeAccountV0_3_0(account.accountAddress);
    }

    return { node, chainId, provider, fund, sendUserOp, sendTx, expectRevert, deploySafe };
}

describe.each(runnable)('Social Recovery Module v0.2.0 audit fixes e2e: $name (chainId $chainId)', (chain) => {
    const { node, chainId, provider, fund, sendUserOp, sendTx, expectRevert, deploySafe } =
        harness(chain);

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
        await fund(guardian1.address, guardian2.address);
    });

    const sendUserOpFromOwner = (account, transactions) => sendUserOp(account, owner, transactions);
    const sendFromGuardian = sendTx;

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
        smartAccount = await deploySafe(owner);
        accountAddress = smartAccount.accountAddress;

        // The guardian calls go through MultiSend; v0.2.0 rejects them unless
        // their calldata has the exact canonical length (Certora L-05).
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

// A Safe as guardian signs through EIP-1271: either with its owners'
// signatures, or by pre-approving the recovery hash on-chain and leaving the
// signature empty. Before v0.2.0 (Certora L-01) an empty signature only
// counted when the signer itself sent the transaction, so a relayer could not
// submit a pre-approved Safe guardian.
describe.each(runnable)('Social Recovery Module v0.2.0 Safe guardian e2e: $name (chainId $chainId)', (chain) => {
    const { node, chainId, provider, fund, sendUserOp, sendTx, expectRevert, deploySafe } =
        harness(chain);

    const owner = Wallet.createRandom();
    const guardianSafeOwner = Wallet.createRandom();
    const guardian1 = Wallet.createRandom();
    const relayer = Wallet.createRandom().connect(provider);
    const newOwnerA = Wallet.createRandom();
    const newOwnerB = Wallet.createRandom();

    const srm = new SocialRecoveryModuleV2();

    let smartAccount;
    let accountAddress;
    let guardianSafe;

    beforeAll(async () => {
        await fund(relayer.address);
    });

    async function signAsGuardian1(newOwners, nonce) {
        const { domain, types, messageValue } = await srm.getRecoveryRequestEip712Data(
            node,
            chainId,
            accountAddress,
            newOwners,
            1n,
            { recoveryNonce: nonce },
        );
        return { signer: guardian1.address, signature: await guardian1.signTypedData(domain, types, messageValue) };
    }

    // EIP-1271 signature of the guardian Safe: its owner signs the recovery
    // hash as a SafeMessage for that Safe.
    async function signAsGuardianSafe(newOwners, nonce) {
        const recoveryHash = await srm.getRecoveryHash(node, accountAddress, newOwners, 1, nonce);
        const domain = { chainId: Number(chainId), verifyingContract: guardianSafe.accountAddress };
        const signature = await guardianSafeOwner.signTypedData(domain, SAFE_MESSAGE_MODULE_TYPE, {
            message: recoveryHash,
        });
        return { signer: guardianSafe.accountAddress, signature };
    }

    test('set up an account guarded by a Safe and an EOA (threshold 2)', async () => {
        guardianSafe = await deploySafe(guardianSafeOwner);
        smartAccount = await deploySafe(owner);
        accountAddress = smartAccount.accountAddress;

        const receipt = await sendUserOp(smartAccount, owner, [
            srm.createEnableModuleMetaTransaction(accountAddress),
            srm.createAddGuardianWithThresholdMetaTransaction(guardianSafe.accountAddress, 1n),
            srm.createAddGuardianWithThresholdMetaTransaction(guardian1.address, 2n),
        ]);
        expect(receipt?.success).toBe(true);
        expect(await srm.isGuardian(node, accountAddress, guardianSafe.accountAddress)).toBe(true);
    });

    test('an empty signature counts only once the Safe guardian approved the hash', async () => {
        const nonce = await srm.nonce(node, accountAddress);
        await expectRevert(
            relayer.address,
            srm.createMultiConfirmRecoveryMetaTransaction(
                accountAddress,
                [newOwnerB.address],
                1,
                nonce,
                [{ signer: guardianSafe.accountAddress, signature: '0x' }, await signAsGuardian1([newOwnerB.address], nonce)],
                true,
            ),
            'SM: Invalid guardian signature',
        );
    });

    test('a relayer submits a Safe guardian confirmation signed by its owner', async () => {
        const nonce = await srm.nonce(node, accountAddress);
        await sendTx(
            relayer,
            srm.createMultiConfirmRecoveryMetaTransaction(
                accountAddress,
                [newOwnerA.address],
                1,
                nonce,
                [await signAsGuardianSafe([newOwnerA.address], nonce)],
                false,
            ),
        );
        expect(
            await srm.hasGuardianApproved(
                node,
                accountAddress,
                guardianSafe.accountAddress,
                [newOwnerA.address],
                1,
            ),
        ).toBe(true);
    });

    test('a relayer submits an empty signature for a Safe guardian that pre-approved the hash (L-01)', async () => {
        const nonce = await srm.nonce(node, accountAddress);
        const recoveryHash = await srm.getRecoveryHash(node, accountAddress, [newOwnerB.address], 1, nonce);

        const approve = await sendUserOp(guardianSafe, guardianSafeOwner, [
            {
                to: SIGN_MESSAGE_LIB,
                value: 0n,
                data: signMessageLib.encodeFunctionData('signMessage', [recoveryHash]),
                operation: Operation.Delegate,
            },
        ]);
        expect(approve?.success).toBe(true);

        await sendTx(
            relayer,
            srm.createMultiConfirmRecoveryMetaTransaction(
                accountAddress,
                [newOwnerB.address],
                1,
                nonce,
                [{ signer: guardianSafe.accountAddress, signature: '0x' }, await signAsGuardian1([newOwnerB.address], nonce)],
                true,
            ),
        );

        const request = await srm.getRecoveryRequest(node, accountAddress);
        expect(request.guardiansApprovalCount).toBe(2n);
        expect(request.newOwners).toEqual([newOwnerB.address]);
        expect(request.nonce).toBe(nonce);
        expect(request.executableAt).toBeGreaterThan(0n);
    });
});

if (unrunnable.length > 0) {
    describe.skip.each(unrunnable)('Social Recovery Module v0.2.0 e2e: $name (setup failed)', () => {
        test('skipped', () => {});
    });
}
