// e2e for issue #152: the public `estimateUserOperationGas({ expectedSigners })`
// estimator must return a verificationGasLimit sufficient for an operation
// carrying that many REAL signatures. Bundler estimation runs with dummy
// signatures whose validation short-circuits, so each real signature costs
// ~55k more at inclusion than simulation paid for. `createUserOperation`
// compensates internally; this test covers the direct-estimator path, where
// a caller applies the returned values as overrides and the raw bundler
// numbers (pre-fix) underprice the operation.

const { Wallet } = require('ethers');
const { sendJsonRpcRequest } = require('../../../../dist/index.cjs');
const { safeMultiSigMatrix, unrunnable, nodeUrl, bundlerUrl } = require('../../_runnable.cjs');

jest.setTimeout(120000);

const ONE_ETH = 10n ** 18n;
const toHex = (n) => `0x${n.toString(16)}`;

describe('estimateUserOperationGas with expectedSigners covers real multi-sig cost', () => {
    test.concurrent.each(safeMultiSigMatrix())(
        '3-of-3 owners, estimator-driven gas limits: $chainName / $accountVersion (chainId $chainId)',
        async (entry) => {
            const node = nodeUrl(entry);
            const bundler = bundlerUrl(entry);
            const { accountClass: Account } = entry;

            const owners = [Wallet.createRandom(), Wallet.createRandom(), Wallet.createRandom()];
            const ownerAddresses = owners.map((o) => o.address);
            const account = Account.initializeNewAccount(ownerAddresses, { threshold: 3 });

            await sendJsonRpcRequest(node, 'anvil_setBalance', [account.accountAddress, toHex(ONE_ETH)]);

            const recipient = Wallet.createRandom().address;
            const value = 1_000_000_000_000_000n;

            const userOp = await account.createUserOperation(
                [{ to: recipient, value, data: '0x' }],
                node,
                bundler,
                { expectedSigners: ownerAddresses },
            );

            // Re-derive the gas limits through the public estimator and apply
            // them raw, as an external caller driving estimation directly would.
            const [preVerificationGas, verificationGasLimit, callGasLimit] =
                await account.estimateUserOperationGas(userOp, bundler, {
                    expectedSigners: ownerAddresses,
                });
            userOp.preVerificationGas = preVerificationGas;
            userOp.verificationGasLimit = verificationGasLimit;
            userOp.callGasLimit = callGasLimit;

            userOp.signature = account.signUserOperation(
                userOp,
                owners.map((o) => o.privateKey),
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
