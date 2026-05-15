const { Wallet } = require('ethers');
const {
    sendJsonRpcRequest,
    createAndSignEip7702DelegationAuthorization,
} = require('../../../../dist/index.cjs');
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
            // EIP-7702 accounts: the EOA address IS the account address, so we
            // construct from the random wallet's own address.
            let account;
            if (entry.isSafeMultiSig) {
                account = Account.initializeNewAccount([owner.address]);
            } else {
                account = new Account(owner.address);
            }

            await sendJsonRpcRequest(node, 'anvil_setBalance', [account.accountAddress, toHex(ONE_ETH)]);

            const recipient1 = Wallet.createRandom().address;
            const recipient2 = Wallet.createRandom().address;
            const value1 = 1_000_000_000_000_000n;
            const value2 = 2_000_000_000_000_000n;

            // First userOp must carry an eip7702Auth to delegate the EOA to the
            // singleton; the SDK skips the authorisation if the EOA is already
            // delegated. The delegation and the delegation signature are only
            // needed once — subsequent userOps from the same EOA can omit the
            // eip7702Auth field. Pass `{ chainId }` so the SDK fills dummy r/s
            // for gas estimation, then overwrite with a real signed
            // authorization before sending.
            const createOverrides = {};
            if (!entry.isSafeMultiSig) {
                createOverrides.eip7702Auth = { chainId: BigInt(entry.chainId) };
            }
            let userOp = await account.createUserOperation(
                [
                    { to: recipient1, value: value1, data: '0x' },
                    { to: recipient2, value: value2, data: '0x' },
                ],
                node,
                bundler,
                createOverrides,
            );
            if (entry.isSafeMultiSig) {
                userOp.signature = account.signUserOperation(userOp, [owner.privateKey], BigInt(entry.chainId));
            } else {
                // Delegation signature is only needed once — replace the SDK's
                // dummy auth with a real one signed by the EOA. Subsequent
                // userOps from this EOA can skip this step entirely.
                userOp.eip7702Auth = createAndSignEip7702DelegationAuthorization(
                    BigInt(userOp.eip7702Auth.chainId),
                    userOp.eip7702Auth.address,
                    BigInt(userOp.eip7702Auth.nonce),
                    owner.privateKey,
                );
                userOp.signature = account.signUserOperation(userOp, owner.privateKey, BigInt(entry.chainId));
            }

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
