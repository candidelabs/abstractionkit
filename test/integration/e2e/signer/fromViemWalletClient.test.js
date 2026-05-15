const { Wallet } = require('ethers');
const { createWalletClient, http } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const {
    fromViemWalletClient,
    sendJsonRpcRequest,
    createAndSignEip7702DelegationAuthorization,
} = require('../../../../dist/index.cjs');
const { runnableMatrix, unrunnable, nodeUrl, bundlerUrl } = require('../../_runnable.cjs');

jest.setTimeout(120000);

const ONE_ETH = 10n ** 18n;
const toHex = (n) => `0x${n.toString(16)}`;

// Calibur only accepts `signHash`-capable signers (its userOp signature is a
// raw ECDSA over the userOp hash, then wrapped). A viem WalletClient signer
// only exposes `signTypedData`, so this adapter combination is unsupported by
// design — `signUserOperationWithSigner` throws offline with an actionable
// error. Filter Calibur out so the matrix only covers compatible pairings.
const matrix = runnableMatrix().filter((entry) => entry.accountVersion !== 'Calibur');

describe('signer: fromViemWalletClient', () => {
    test.concurrent.each(matrix)(
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

            // EIP-7702 accounts: the EOA address IS the account address, so we
            // construct from the random wallet's own address.
            let account;
            if (entry.isSafeMultiSig) {
                account = Account.initializeNewAccount([signer.address]);
            } else {
                account = new Account(signer.address);
            }
            await sendJsonRpcRequest(node, 'anvil_setBalance', [account.accountAddress, toHex(ONE_ETH)]);

            const recipient = Wallet.createRandom().address;
            const value = 1_000_000_000_000_000n;

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
            const userOp = await account.createUserOperation(
                [{ to: recipient, value, data: '0x' }],
                node,
                bundler,
                createOverrides,
            );
            if (entry.isSafeMultiSig) {
                userOp.signature = await account.signUserOperationWithSigners(
                    userOp,
                    [signer],
                    BigInt(entry.chainId),
                );
            } else {
                // Delegation signature is only needed once — replace the SDK's
                // dummy auth with a real one signed by the EOA. Subsequent
                // userOps from this EOA can skip this step entirely.
                userOp.eip7702Auth = createAndSignEip7702DelegationAuthorization(
                    BigInt(userOp.eip7702Auth.chainId),
                    userOp.eip7702Auth.address,
                    BigInt(userOp.eip7702Auth.nonce),
                    ethersWallet.privateKey,
                );
                userOp.signature = await account.signUserOperationWithSigner(
                    userOp,
                    signer,
                    BigInt(entry.chainId),
                );
            }

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
