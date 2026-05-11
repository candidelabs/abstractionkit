const { Wallet } = require('ethers');
const { privateKeyToAccount } = require('viem/accounts');
const { SafeAccountV0_3_0, fromViem, sendJsonRpcRequest } = require('../../../../dist/index.cjs');
const { runnable, unrunnable, nodeUrl, bundlerUrl } = require('../../_runnable.cjs');

jest.setTimeout(120000);

const ONE_ETH = 10n ** 18n;
const toHex = (n) => `0x${n.toString(16)}`;

describe('signer: fromViem', () => {
    test.concurrent.each(runnable)(
        'viem LocalAccount adapter signs userop: $name (chainId $chainId)',
        async (chain) => {
            const node = nodeUrl(chain);
            const bundler = bundlerUrl(chain);

            const ethersWallet = Wallet.createRandom();
            const localAccount = privateKeyToAccount(ethersWallet.privateKey);
            const signer = fromViem(localAccount);
            expect(signer.address.toLowerCase()).toBe(ethersWallet.address.toLowerCase());
            expect(typeof signer.signHash).toBe('function');
            expect(typeof signer.signTypedData).toBe('function');

            const account = SafeAccountV0_3_0.initializeNewAccount([signer.address]);
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
                BigInt(chain.chainId),
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
