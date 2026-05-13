const { Wallet } = require('ethers');
const { sendJsonRpcRequest } = require('../../../../dist/index.cjs');
const { runnableMatrix, unrunnable, nodeUrl, bundlerUrl } = require('../../_runnable.cjs');

jest.setTimeout(120000);

const ONE_ETH = 10n ** 18n;
const toHex = (n) => `0x${n.toString(16)}`;

describe('batch transactions', () => {
    test.concurrent.each(runnableMatrix())(
        'two ETH transfers in one userop: $chainName / $accountVersion (chainId $chainId)',
        async (entry) => {
            const node = nodeUrl(entry);
            const bundler = bundlerUrl(entry);
            const { accountClass: Account } = entry;

            const owner = Wallet.createRandom();
            const account = Account.initializeNewAccount([owner.address]);

            await sendJsonRpcRequest(node, 'anvil_setBalance', [account.accountAddress, toHex(ONE_ETH)]);

            const recipient1 = Wallet.createRandom().address;
            const recipient2 = Wallet.createRandom().address;
            const value1 = 1_000_000_000_000_000n;
            const value2 = 2_000_000_000_000_000n;

            let userOp = await account.createUserOperation(
                [
                    { to: recipient1, value: value1, data: '0x' },
                    { to: recipient2, value: value2, data: '0x' },
                ],
                node,
                bundler,
            );
            userOp.signature = account.signUserOperation(userOp, [owner.privateKey], BigInt(entry.chainId));

            const sent = await account.sendUserOperation(userOp, bundler);
            const receipt = await sent.included();

            expect(receipt).not.toBeNull();
            expect(receipt.success).toBe(true);

            const bal1 = await sendJsonRpcRequest(node, 'eth_getBalance', [recipient1, 'latest']);
            const bal2 = await sendJsonRpcRequest(node, 'eth_getBalance', [recipient2, 'latest']);
            expect(BigInt(bal1)).toBe(value1);
            expect(BigInt(bal2)).toBe(value2);
        },
    );

    if (unrunnable.length > 0) {
        test.skip.each(unrunnable)('two ETH transfers in one userop: $name (setup failed)', () => {});
    }
});
