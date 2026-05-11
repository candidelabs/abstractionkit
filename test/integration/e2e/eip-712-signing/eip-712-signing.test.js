const { Wallet } = require('ethers');
const { SafeAccountV0_3_0, sendJsonRpcRequest } = require('../../../../dist/index.cjs');
const { runnable, unrunnable, nodeUrl, bundlerUrl } = require('../../_runnable.cjs');

jest.setTimeout(120000);

const ONE_ETH = 10n ** 18n;
const toHex = (n) => `0x${n.toString(16)}`;

describe('eip-712 signing', () => {
    test.concurrent.each(runnable)(
        'sign userop via EIP-712 typed data: $name (chainId $chainId)',
        async (chain) => {
            const node = nodeUrl(chain);
            const bundler = bundlerUrl(chain);

            const owner = Wallet.createRandom();
            const account = SafeAccountV0_3_0.initializeNewAccount([owner.address]);

            await sendJsonRpcRequest(node, 'anvil_setBalance', [account.accountAddress, toHex(ONE_ETH)]);

            const recipient = Wallet.createRandom().address;
            const value = 1_000_000_000_000_000n;

            const userOp = await account.createUserOperation(
                [{ to: recipient, value, data: '0x' }],
                node,
                bundler,
            );

            const { domain, types, messageValue } = SafeAccountV0_3_0.getUserOperationEip712Data(
                userOp,
                BigInt(chain.chainId),
            );
            const { EIP712Domain, ...typesForSigning } = types;
            const signature = await owner.signTypedData(domain, typesForSigning, messageValue);

            userOp.signature = SafeAccountV0_3_0.formatEip712SingleSignatureToUseroperationSignature(signature);

            const sent = await account.sendUserOperation(userOp, bundler);
            const receipt = await sent.included();

            expect(receipt).not.toBeNull();
            expect(receipt.success).toBe(true);

            const bal = await sendJsonRpcRequest(node, 'eth_getBalance', [recipient, 'latest']);
            expect(BigInt(bal)).toBe(value);
        },
    );

    if (unrunnable.length > 0) {
        test.skip.each(unrunnable)('$name (setup failed)', () => {});
    }
});
