const { Wallet } = require('ethers');
const {
    SafeAccountV0_3_0,
    SocialRecoveryModuleV1,
    SocialRecoveryModuleV2,
    SocialRecoveryModuleGracePeriodSelectorV2,
    SocialRecoveryModuleGracePeriodSelectorV1,
    sendJsonRpcRequest,
} = require('../../../../dist/index.cjs');
const { runnable, unrunnable, nodeUrl, bundlerUrl } = require('../../_runnable.cjs');

jest.setTimeout(300000);

const TEN_ETH_HEX = '0x8AC7230489E80000';

// The v0.2.0 3-minute deployment exists on testnets only, and these suites
// fork mainnets, so v0.2.0 uses the 3-day deployment and warps time.
const versions = [
    {
        version: 'v0.1.0',
        createModule: () => new SocialRecoveryModuleV1(SocialRecoveryModuleGracePeriodSelectorV1.After3Minutes),
        gracePeriodSeconds: 3 * 60,
    },
    {
        version: 'v0.2.0',
        createModule: () => new SocialRecoveryModuleV2(SocialRecoveryModuleGracePeriodSelectorV2.After3Days),
        gracePeriodSeconds: 3 * 24 * 60 * 60,
    },
];
const cases = runnable.flatMap((chain) => versions.map((v) => ({ ...chain, ...v })));
const GET_OWNERS_SELECTOR = '0xa0e67e2b'; // Safe.getOwners()

describe.each(cases)('Social Recovery Module $version e2e: $name (chainId $chainId)', (chain) => {
    const node = nodeUrl(chain);
    const bundler = bundlerUrl(chain);
    const chainId = BigInt(chain.chainId);

    const owner = Wallet.createRandom();
    const newOwner = Wallet.createRandom();
    const guardian1 = Wallet.createRandom();
    const guardian2 = Wallet.createRandom();

    const srm = chain.createModule();
    const isV2 = chain.version === 'v0.2.0';

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

        const signatures = [
            { signer: guardian1.address, signature: sig1 },
            { signer: guardian2.address, signature: sig2 },
        ];
        // execute=true: also start the recovery in the same call
        const multiConfirm = isV2
            ? srm.createMultiConfirmRecoveryMetaTransaction(
                  accountAddress,
                  [newOwner.address],
                  1,
                  messageValue.nonce,
                  signatures,
                  true,
              )
            : srm.createMultiConfirmRecoveryMetaTransaction(
                  accountAddress,
                  [newOwner.address],
                  1,
                  signatures,
                  true,
              );

        // NOTE: We send this as a userop from the Safe purely for consistency with
        // the rest of the suite. `multiConfirmRecovery` is permissioned by guardian
        // signatures (not msg.sender), so any funded EOA can submit it as a regular
        // transaction with the same effect.
        const receipt = await sendUserOpFromOwner(smartAccount, [multiConfirm]);
        expect(receipt?.success).toBe(true);

        const request = await srm.getRecoveryRequest(node, accountAddress);
        expect(request.guardiansApprovalCount).toBe(2n);
        expect(request.newOwners).toEqual([newOwner.address]);
        if (isV2) {
            expect(request.nonce).toBe(messageValue.nonce);
            expect(request.executableAt).toBeGreaterThan(0n);
        } else {
            expect(request.executeAfter).toBeGreaterThan(0n);
        }
    });

    test('finalize recovery after grace period', async () => {
        await sendJsonRpcRequest(node, 'evm_increaseTime', [chain.gracePeriodSeconds + 1]);
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
