// Two things the per-class matrix suites do not prove on-chain:
//
// 1. Which Safe singleton a freshly deployed account actually runs. The matrix
//    suites only check that an op succeeded, so a V2 that silently derived its
//    address from the v1.4.1 singleton would pass every one of them.
// 2. A true multi-chain signature: one Merkle root signed once and executed
//    on two forks through the Safe 4337 multi-chain signature module.
//
// The second part needs at least two runnable chains; with one it is skipped.

const { Wallet, getAddress } = require('ethers');
const {
    SafeMultiChainSigAccountV1,
    SafeMultiChainSigAccountV2,
    fromEthersWallet,
    sendJsonRpcRequest,
} = require('../../../../dist/index.cjs');
const { runnable, unrunnable, nodeUrl, bundlerUrl, safeMultiSigMatrix } = require('../../_runnable.cjs');

jest.setTimeout(240000);

const ONE_ETH_HEX = '0xde0b6b3a7640000';
const TRANSFER = 1_000_000_000_000_000n;
// A SafeProxy keeps its singleton in storage slot 0.
const SINGLETON_SLOT = '0x0';

const EXPECTED_SAFE_VERSION = {
    V0_2_0: '1.4.1',
    V0_3_0: '1.4.1',
    MultiChainSigV1: '1.4.1',
    MultiChainSigV2: '1.5.0',
};

async function deployedSingleton(node, address) {
    const word = await sendJsonRpcRequest(node, 'eth_getStorageAt', [address, SINGLETON_SLOT, 'latest']);
    return getAddress(`0x${word.slice(-40)}`);
}

describe('deployed Safe singleton', () => {
    test.concurrent.each(safeMultiSigMatrix())(
        'the proxy runs the class singleton: $chainName / $accountVersion (chainId $chainId)',
        async (entry) => {
            const node = nodeUrl(entry);
            const bundler = bundlerUrl(entry);
            const { accountClass: Account } = entry;
            const owner = Wallet.createRandom();
            const account = Account.initializeNewAccount([owner.address]);
            await sendJsonRpcRequest(node, 'anvil_setBalance', [account.accountAddress, ONE_ETH_HEX]);

            const userOp = await account.createUserOperation(
                [{ to: owner.address, value: 0n, data: '0x' }],
                node,
                bundler,
            );
            userOp.signature = account.signUserOperation(userOp, [owner.privateKey], BigInt(entry.chainId));
            const receipt = await (await account.sendUserOperation(userOp, bundler)).included();
            expect(receipt?.success).toBe(true);

            expect(await deployedSingleton(node, account.accountAddress)).toBe(
                getAddress(account.safeAccountSingleton.singletonAddress),
            );
            expect(await account.getSafeVersion(node)).toBe(EXPECTED_SAFE_VERSION[entry.accountVersion]);
        },
    );

    if (unrunnable.length > 0) {
        test.skip.each(unrunnable)('$name (setup failed)', () => {});
    }
});

const MULTI_CHAIN_CLASSES = [
    ['MultiChainSigV1', SafeMultiChainSigAccountV1],
    ['MultiChainSigV2', SafeMultiChainSigAccountV2],
];

const crossChain = runnable.length >= 2 ? describe : describe.skip;

crossChain.each(MULTI_CHAIN_CLASSES)('one signature, every chain: %s', (_name, Account) => {
    // describe.skip still evaluates this callback, so never assume two chains
    // here; with fewer the tests are skipped and targets is just shorter.
    const targets = runnable.slice(0, 2).map((chain) => ({
        chain,
        chainId: BigInt(chain.chainId),
        node: nodeUrl(chain),
        bundler: bundlerUrl({ ...chain, entrypoint: 'v9' }),
    }));

    const owner = Wallet.createRandom();
    let account;

    // Build one op per chain against the same counterfactual account. The
    // multi-chain signature carries a Merkle proof the estimation dummy does
    // not, so pad the gas limits that depend on signature length.
    async function createOps(makeTransactions) {
        const ops = [];
        for (const target of targets) {
            const userOperation = await account.createUserOperation(
                makeTransactions(target),
                target.node,
                target.bundler,
                {
                    verificationGasLimitPercentageMultiplier: 100,
                    preVerificationGasPercentageMultiplier: 50,
                },
            );
            ops.push({ userOperation, chainId: target.chainId });
        }
        return ops;
    }

    async function sendAll(ops, signatures) {
        return Promise.all(
            ops.map(async ({ userOperation }, i) => {
                userOperation.signature = signatures[i];
                const sent = await account.sendUserOperation(userOperation, targets[i].bundler);
                return sent.included();
            }),
        );
    }

    beforeAll(async () => {
        account = Account.initializeNewAccount([owner.address]);
        for (const target of targets) {
            await sendJsonRpcRequest(target.node, 'anvil_setBalance', [account.accountAddress, ONE_ETH_HEX]);
        }
    });

    test('signUserOperations deploys and executes on both chains from one Merkle root', async () => {
        const recipients = targets.map(() => Wallet.createRandom().address);
        const ops = await createOps((target) => [
            { to: recipients[targets.indexOf(target)], value: TRANSFER, data: '0x' },
        ]);
        expect(ops.every(({ userOperation }) => userOperation.nonce === 0n)).toBe(true);

        const signatures = account.signUserOperations(ops, [owner.privateKey]);
        expect(signatures).toHaveLength(2);
        expect(signatures[0]).not.toBe(signatures[1]); // same root, different proof leaf order

        const receipts = await sendAll(ops, signatures);
        for (const receipt of receipts) expect(receipt?.success).toBe(true);

        for (const [i, target] of targets.entries()) {
            const bal = await sendJsonRpcRequest(target.node, 'eth_getBalance', [recipients[i], 'latest']);
            expect(BigInt(bal)).toBe(TRANSFER);
            expect(await deployedSingleton(target.node, account.accountAddress)).toBe(
                getAddress(account.safeAccountSingleton.singletonAddress),
            );
        }
    });

    test('signUserOperationsWithSigners does the same through the ethers adapter', async () => {
        const recipients = targets.map(() => Wallet.createRandom().address);
        const ops = await createOps((target) => [
            { to: recipients[targets.indexOf(target)], value: TRANSFER, data: '0x' },
        ]);

        const signatures = await account.signUserOperationsWithSigners(ops, [fromEthersWallet(owner)]);
        expect(signatures).toEqual(account.signUserOperations(ops, [owner.privateKey]));

        const receipts = await sendAll(ops, signatures);
        for (const receipt of receipts) expect(receipt?.success).toBe(true);

        for (const [i, target] of targets.entries()) {
            const bal = await sendJsonRpcRequest(target.node, 'eth_getBalance', [recipients[i], 'latest']);
            expect(BigInt(bal)).toBe(TRANSFER);
        }
    });

    test('a proof for the other chain is rejected at validation', async () => {
        const ops = await createOps(() => [{ to: owner.address, value: 0n, data: '0x' }]);
        const signatures = account.signUserOperations(ops, [owner.privateKey]);

        // Each signature proves its own leaf; swapping them keeps the signed
        // root but presents the wrong leaf for the op, so the module recovers
        // a non-owner and the bundler rejects with AA24.
        for (const [i, { userOperation }] of ops.entries()) {
            userOperation.signature = signatures[1 - i];
            await expect(account.sendUserOperation(userOperation, targets[i].bundler)).rejects.toThrow();
        }
    });
});
