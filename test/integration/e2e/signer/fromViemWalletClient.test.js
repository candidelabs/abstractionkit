const { Wallet } = require('ethers');
const { createWalletClient, http } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { fromViemWalletClient, sendJsonRpcRequest } = require('../../../../dist/index.cjs');
const { runnableMatrix, unrunnable, nodeUrl, bundlerUrl } = require('../../_runnable.cjs');

jest.setTimeout(120000);

const ONE_ETH = 10n ** 18n;
const toHex = (n) => `0x${n.toString(16)}`;

describe('signer: fromViemWalletClient', () => {
    test.concurrent.each(runnableMatrix())(
        'viem WalletClient adapter signs userop: $chainName / $accountVersion (chainId $chainId)',
        async (entry) => {
            const node = nodeUrl(entry);
            const bundler = bundlerUrl(entry);
            const { accountClass: Account } = entry;

            const ethersWallet = Wallet.createRandom();
            const localAccount = privateKeyToAccount(ethersWallet.privateKey);
            const walletClient = createWalletClient({
                account: localAccount,
                transport: http(node),
            });
            const signer = fromViemWalletClient(walletClient);
            expect(signer.address.toLowerCase()).toBe(ethersWallet.address.toLowerCase());
            expect(typeof signer.signHash).toBe('undefined');
            expect(typeof signer.signTypedData).toBe('function');

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
