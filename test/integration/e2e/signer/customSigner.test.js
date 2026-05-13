const { Wallet } = require('ethers');
const { sendJsonRpcRequest } = require('../../../../dist/index.cjs');
const { runnableMatrix, unrunnable, nodeUrl, bundlerUrl } = require('../../_runnable.cjs');

jest.setTimeout(120000);

const ONE_ETH = 10n ** 18n;
const toHex = (n) => `0x${n.toString(16)}`;

describe('signer: customSigner', () => {
    test.concurrent.each(runnableMatrix())(
        'inline ExternalSigner signs userop: $chainName / $accountVersion (chainId $chainId)',
        async (entry) => {
            const node = nodeUrl(entry);
            const bundler = bundlerUrl(entry);
            const { accountClass: Account } = entry;

            const wallet = Wallet.createRandom();
            const signer = {
                address: wallet.address,
                signHash: async (hash) => wallet.signingKey.sign(hash).serialized,
            };

            const account = Account.initializeNewAccount([signer.address]);
            await sendJsonRpcRequest(node, 'anvil_setBalance', [account.accountAddress, toHex(ONE_ETH)]);

            const recipient = Wallet.createRandom().address;
            const value = 1_000_000_000_000_000n;

            const userOp = await account.createUserOperation(
                [{ to: recipient, value, data: '0x' }],
                node,
                bundler,
            );
            userOp.signature = await account.signUserOperationWithSigners(
                userOp,
                [signer],
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
