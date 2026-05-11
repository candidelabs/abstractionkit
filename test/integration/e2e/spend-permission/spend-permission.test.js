const { Wallet } = require('ethers');
const {
    SafeAccountV0_3_0,
    AllowanceModule,
    sendJsonRpcRequest,
} = require('../../../../dist/index.cjs');
const { runnable, unrunnable, nodeUrl, bundlerUrl } = require('../../_runnable.cjs');

jest.setTimeout(180000);

const ONE_ETH = 10n ** 18n;
const toHex = (n) => `0x${n.toString(16)}`;

// WETH addresses on each chain (canonical WETH9 on mainnet, OP Stack predeploy on the others).
const WETH = {
    ethereum: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    optimism: '0x4200000000000000000000000000000000000006',
    base: '0x4200000000000000000000000000000000000006',
};
const WETH_DEPOSIT_SELECTOR = '0xd0e30db0';
const ERC20_BALANCE_OF_SELECTOR = '0x70a08231';

async function erc20BalanceOf(node, token, holder) {
    const data = ERC20_BALANCE_OF_SELECTOR + holder.slice(2).toLowerCase().padStart(64, '0');
    const result = await sendJsonRpcRequest(node, 'eth_call', [{ to: token, data }, 'latest']);
    return BigInt(result);
}

describe('spend permission (allowance module)', () => {
    test.concurrent.each(runnable)(
        'set allowance, delegate transfers WETH: $name (chainId $chainId)',
        async (chain) => {
            const node = nodeUrl(chain);
            const bundler = bundlerUrl(chain);
            const chainId = BigInt(chain.chainId);
            const weth = WETH[chain.name];

            const sourceOwner = Wallet.createRandom();
            const delegateOwner = Wallet.createRandom();
            const sourceSafe = SafeAccountV0_3_0.initializeNewAccount([sourceOwner.address]);
            const delegateSafe = SafeAccountV0_3_0.initializeNewAccount([delegateOwner.address]);

            await Promise.all([
                sendJsonRpcRequest(node, 'anvil_setBalance', [sourceSafe.accountAddress, toHex(2n * ONE_ETH)]),
                sendJsonRpcRequest(node, 'anvil_setBalance', [delegateSafe.accountAddress, toHex(ONE_ETH)]),
            ]);

            const allowanceModule = new AllowanceModule();
            const allowanceAmount = 100n;

            const wrapEth = { to: weth, value: ONE_ETH, data: WETH_DEPOSIT_SELECTOR };
            const enableModule = allowanceModule.createEnableModuleMetaTransaction(sourceSafe.accountAddress);
            const addDelegate = allowanceModule.createAddDelegateMetaTransaction(delegateSafe.accountAddress);
            const setAllowance = allowanceModule.createRecurringAllowanceMetaTransaction(
                delegateSafe.accountAddress,
                weth,
                allowanceAmount,
                3n,
                0n,
            );

            const setupOp = await sourceSafe.createUserOperation(
                [wrapEth, enableModule, addDelegate, setAllowance],
                node,
                bundler,
            );
            setupOp.signature = sourceSafe.signUserOperation(
                setupOp,
                [sourceOwner.privateKey],
                chainId,
            );
            const setupReceipt = await (await sourceSafe.sendUserOperation(setupOp, bundler)).included();
            expect(setupReceipt?.success).toBe(true);

            expect(await erc20BalanceOf(node, weth, sourceSafe.accountAddress)).toBe(ONE_ETH);

            const recipient = Wallet.createRandom().address;
            const transferAmount = 50n;
            const transferTx = allowanceModule.createAllowanceTransferMetaTransaction(
                sourceSafe.accountAddress,
                weth,
                recipient,
                transferAmount,
                delegateSafe.accountAddress,
            );

            const transferOp = await delegateSafe.createUserOperation(
                [transferTx],
                node,
                bundler,
            );
            transferOp.signature = delegateSafe.signUserOperation(
                transferOp,
                [delegateOwner.privateKey],
                chainId,
            );
            const transferReceipt = await (
                await delegateSafe.sendUserOperation(transferOp, bundler)
            ).included();
            expect(transferReceipt?.success).toBe(true);

            expect(await erc20BalanceOf(node, weth, recipient)).toBe(transferAmount);
        },
    );

    if (unrunnable.length > 0) {
        test.skip.each(unrunnable)('$name (setup failed)', () => {});
    }
});
