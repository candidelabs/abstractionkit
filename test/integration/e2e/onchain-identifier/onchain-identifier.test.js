const { Wallet } = require('ethers');
const { sendJsonRpcRequest } = require('../../../../dist/index.cjs');
const { safeMultiSigMatrix, unrunnable, nodeUrl, bundlerUrl } = require('../../_runnable.cjs');

jest.setTimeout(120000);

const ONE_ETH = 10n ** 18n;
const toHex = (n) => `0x${n.toString(16)}`;

describe('onchain identifier', () => {
    test.concurrent.each(safeMultiSigMatrix())(
        'identifier embedded in callData + tx input: $chainName / $accountVersion (chainId $chainId)',
        async (entry) => {
            const node = nodeUrl(entry);
            const bundler = bundlerUrl(entry);
            const { accountClass: Account } = entry;

            const owner = Wallet.createRandom();
            const account = Account.initializeNewAccount([owner.address], {
                onChainIdentifierParams: {
                    project: 'abstractionkit-e2e',
                    platform: 'Web',
                    tool: 'abstractionkit',
                    toolVersion: '0.3.2',
                },
            });
            const identifier = account.onChainIdentifier;
            expect(identifier).toMatch(/^[0-9a-fA-F]{64}$/);

            await sendJsonRpcRequest(node, 'anvil_setBalance', [account.accountAddress, toHex(ONE_ETH)]);

            const recipient = Wallet.createRandom().address;
            const userOp = await account.createUserOperation(
                [{ to: recipient, value: 1_000_000_000_000_000n, data: '0x' }],
                node,
                bundler,
            );

            expect(userOp.callData.toLowerCase().endsWith(identifier.toLowerCase())).toBe(true);

            userOp.signature = account.signUserOperation(userOp, [owner.privateKey], BigInt(entry.chainId));
            const sent = await account.sendUserOperation(userOp, bundler);
            const receipt = await sent.included();
            expect(receipt?.success).toBe(true);

            const tx = await sendJsonRpcRequest(node, 'eth_getTransactionByHash', [
                receipt.receipt.transactionHash,
            ]);
            expect(tx.input.toLowerCase()).toContain(identifier.toLowerCase());
        },
    );

    if (unrunnable.length > 0) {
        test.skip.each(unrunnable)('$name (setup failed)', () => {});
    }
});
