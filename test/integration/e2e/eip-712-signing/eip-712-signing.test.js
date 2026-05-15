const { Wallet } = require('ethers');
const { sendJsonRpcRequest } = require('../../../../dist/index.cjs');
const { safeMultiSigMatrix, unrunnable, nodeUrl, bundlerUrl } = require('../../_runnable.cjs');

jest.setTimeout(120000);

const ONE_ETH = 10n ** 18n;
const toHex = (n) => `0x${n.toString(16)}`;

describe('eip-712 signing', () => {
    test.concurrent.each(safeMultiSigMatrix())(
        'sign userop via EIP-712 typed data: $chainName / $accountVersion (chainId $chainId)',
        async (entry) => {
            const node = nodeUrl(entry);
            const bundler = bundlerUrl(entry);
            const { accountClass: Account } = entry;

            const owner = Wallet.createRandom();
            const account = Account.initializeNewAccount([owner.address]);

            await sendJsonRpcRequest(node, 'anvil_setBalance', [account.accountAddress, toHex(ONE_ETH)]);

            const recipient = Wallet.createRandom().address;
            const value = 1_000_000_000_000_000n;

            const userOp = await account.createUserOperation(
                [{ to: recipient, value, data: '0x' }],
                node,
                bundler,
            );

            const { domain, types, messageValue } = Account.getUserOperationEip712Data(
                userOp,
                BigInt(entry.chainId),
            );
            const { EIP712Domain, ...typesForSigning } = types;
            const signature = await owner.signTypedData(domain, typesForSigning, messageValue);

            // MultiChainSigV1's on-chain module verifies against a Merkle root
            // even for single-op signatures, so the formatter needs to mark
            // this signature as multi-chain so the wrapper includes the Merkle
            // proof bit. For other Safe versions the override is ignored.
            const isMultiChain = entry.accountVersion === 'MultiChainSigV1';
            const singleFormatted = Account.formatEip712SingleSignatureToUseroperationSignature(
                signature,
                { isMultiChainSignature: isMultiChain },
            );
            const pluralFormatted = Account.formatEip712SignaturesToUseroperationSignature(
                ['0x0000000000000000000000000000000000000000'],
                [signature],
                { isMultiChainSignature: isMultiChain },
            );
            expect(singleFormatted).toBe(pluralFormatted);

            userOp.signature = singleFormatted;

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
