const { Wallet } = require('ethers');
const {
    SafeAccountV0_3_0,
    sendJsonRpcRequest,
} = require('../../../../dist/index.cjs');
const { runnable, unrunnable, nodeUrl, bundlerUrl } = require('../../_runnable.cjs');

jest.setTimeout(240000);

const ONE_ETH = 10n ** 18n;
const toHex = (n) => `0x${n.toString(16)}`;

const approvedHashSig = (signerAddress) =>
    '0x000000000000000000000000' +
    signerAddress.slice(2).toLowerCase() +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '01';

describe('nested safe accounts', () => {
    test.concurrent.each(runnable)(
        'main Safe owned by 2 Safes executes via approveHash: $name (chainId $chainId)',
        async (chain) => {
            const node = nodeUrl(chain);
            const bundler = bundlerUrl(chain);
            const chainId = BigInt(chain.chainId);

            const s1o1 = Wallet.createRandom();
            const s1o2 = Wallet.createRandom();
            const s2o1 = Wallet.createRandom();
            const s2o2 = Wallet.createRandom();

            const sub1 = SafeAccountV0_3_0.initializeNewAccount(
                [s1o1.address, s1o2.address],
                { threshold: 2 },
            );
            const sub2 = SafeAccountV0_3_0.initializeNewAccount(
                [s2o1.address, s2o2.address],
                { threshold: 2 },
            );

            const mainAddress = SafeAccountV0_3_0.createAccountAddress(
                [sub1.accountAddress, sub2.accountAddress],
                { threshold: 2 },
            );
            const mainAccount = new SafeAccountV0_3_0(mainAddress);

            await Promise.all([
                sendJsonRpcRequest(node, 'anvil_setBalance', [sub1.accountAddress, toHex(ONE_ETH)]),
                sendJsonRpcRequest(node, 'anvil_setBalance', [sub2.accountAddress, toHex(ONE_ETH)]),
                sendJsonRpcRequest(node, 'anvil_setBalance', [mainAddress, toHex(ONE_ETH)]),
            ]);

            const [mainFactoryAddress, mainFactoryData] =
                SafeAccountV0_3_0.createFactoryAddressAndData(
                    [sub1.accountAddress, sub2.accountAddress],
                    { threshold: 2 },
                );

            const deployMainOp = await sub1.createUserOperation(
                [{ to: mainFactoryAddress, data: mainFactoryData, value: 0n }],
                node,
                bundler,
            );
            deployMainOp.signature = sub1.signUserOperation(
                deployMainOp,
                [s1o1.privateKey, s1o2.privateKey],
                chainId,
            );
            await (await sub1.sendUserOperation(deployMainOp, bundler)).included();

            const sub1Pair = { signer: sub1.accountAddress, signature: approvedHashSig(sub1.accountAddress) };
            const sub2Pair = { signer: sub2.accountAddress, signature: approvedHashSig(sub2.accountAddress) };

            const recipient = Wallet.createRandom().address;
            const value = 1_000_000_000_000_000n;

            const mainOp = await mainAccount.createUserOperation(
                [{ to: recipient, value, data: '0x' }],
                node,
                bundler,
                { dummySignerSignaturePairs: [sub1Pair, sub2Pair] },
            );

            const mainOpHash = SafeAccountV0_3_0.getUserOperationEip712Hash(mainOp, chainId);
            const approveHashSelector = '0xd4d9bdcd';
            const approveHashData =
                approveHashSelector + mainOpHash.slice(2).padStart(64, '0');
            const approveHashTx = { to: mainAddress, value: 0n, data: approveHashData };

            const sub1ApproveOp = await sub1.createUserOperation([approveHashTx], node, bundler);
            sub1ApproveOp.signature = sub1.signUserOperation(
                sub1ApproveOp,
                [s1o1.privateKey, s1o2.privateKey],
                chainId,
            );
            const sub2ApproveOp = await sub2.createUserOperation([approveHashTx], node, bundler);
            sub2ApproveOp.signature = sub2.signUserOperation(
                sub2ApproveOp,
                [s2o1.privateKey, s2o2.privateKey],
                chainId,
            );

            const [sub1Resp, sub2Resp] = await Promise.all([
                sub1.sendUserOperation(sub1ApproveOp, bundler),
                sub2.sendUserOperation(sub2ApproveOp, bundler),
            ]);
            await Promise.all([sub1Resp.included(), sub2Resp.included()]);

            mainOp.signature = SafeAccountV0_3_0.formatSignaturesToUseroperationSignature([
                sub1Pair,
                sub2Pair,
            ]);

            const mainSent = await mainAccount.sendUserOperation(mainOp, bundler);
            const mainReceipt = await mainSent.included();
            expect(mainReceipt?.success).toBe(true);

            const bal = await sendJsonRpcRequest(node, 'eth_getBalance', [recipient, 'latest']);
            expect(BigInt(bal)).toBe(value);
        },
    );

    if (unrunnable.length > 0) {
        test.skip.each(unrunnable)('$name (setup failed)', () => {});
    }
});
