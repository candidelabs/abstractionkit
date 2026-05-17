const { Wallet } = require('ethers');
const { sendJsonRpcRequest } = require('../../../../dist/index.cjs');
const { safeMultiSigMatrix, unrunnable, nodeUrl, bundlerUrl } = require('../../_runnable.cjs');

jest.setTimeout(120000);

const ONE_ETH = 10n ** 18n;
const toHex = (n) => `0x${n.toString(16)}`;

describe('multisig safe account', () => {
    test.concurrent.each(safeMultiSigMatrix())(
        '2-of-2 owners must both sign: $chainName / $accountVersion (chainId $chainId)',
        async (entry) => {
            const node = nodeUrl(entry);
            const bundler = bundlerUrl(entry);
            const { accountClass: Account } = entry;

            const owner1 = Wallet.createRandom();
            const owner2 = Wallet.createRandom();
            const account = Account.initializeNewAccount(
                [owner1.address, owner2.address],
                { threshold: 2 },
            );

            await sendJsonRpcRequest(node, 'anvil_setBalance', [account.accountAddress, toHex(ONE_ETH)]);

            const recipient = Wallet.createRandom().address;
            const value = 1_000_000_000_000_000n;

            const userOp = await account.createUserOperation(
                [{ to: recipient, value, data: '0x' }],
                node,
                bundler,
                { expectedSigners: [owner1.address, owner2.address] },
            );
            userOp.signature = account.signUserOperation(
                userOp,
                [owner1.privateKey, owner2.privateKey],
                BigInt(entry.chainId),
            );

            const sent = await account.sendUserOperation(userOp, bundler);
            const receipt = await sent.included();
            expect(receipt?.success).toBe(true);

            const bal = await sendJsonRpcRequest(node, 'eth_getBalance', [recipient, 'latest']);
            expect(BigInt(bal)).toBe(value);
        },
    );

    if (unrunnable.length > 0) {
        test.skip.each(unrunnable)('$name (setup failed)', () => {});
    }
});
