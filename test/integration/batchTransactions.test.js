const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Wallet } = require('ethers');
const {
    SafeAccountV0_3_0,
    sendJsonRpcRequest,
} = require('../../dist/index.cjs');
const chains = require('./chains.cjs');

jest.setTimeout(120000);

const STATUS_FILE = path.join(os.tmpdir(), 'abstractionkit-integration-status.json');
const okByName = Object.fromEntries(
    JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8')).map((s) => [s.name, s.ok === true]),
);
const runnable = chains.filter((c) => okByName[c.name]);
const unrunnable = chains.filter((c) => !okByName[c.name]);

const ONE_ETH = 10n ** 18n;
const toHex = (n) => `0x${n.toString(16)}`;

describe('batch transactions', () => {
    test.concurrent.each(runnable)(
        'two ETH transfers in one userop: $name (chainId $chainId)',
        async (chain) => {
            const nodeUrl = `http://127.0.0.1:${chain.anvilHostPort}`;
            const bundlerUrl = `http://127.0.0.1:${chain.bundlerHostPort}/rpc`;

            const owner = Wallet.createRandom();
            const account = SafeAccountV0_3_0.initializeNewAccount([owner.address]);

            await sendJsonRpcRequest(nodeUrl, 'anvil_setBalance', [
                account.accountAddress,
                toHex(ONE_ETH),
            ]);

            const recipient1 = Wallet.createRandom().address;
            const recipient2 = Wallet.createRandom().address;
            const value1 = 1_000_000_000_000_000n;
            const value2 = 2_000_000_000_000_000n;

            let userOp = await account.createUserOperation(
                [
                    { to: recipient1, value: value1, data: '0x' },
                    { to: recipient2, value: value2, data: '0x' },
                ],
                nodeUrl,
                bundlerUrl,
            );
            userOp.signature = account.signUserOperation(
                userOp,
                [owner.privateKey],
                BigInt(chain.chainId),
            );

            const sent = await account.sendUserOperation(userOp, bundlerUrl);
            const receipt = await sent.included();

            expect(receipt).not.toBeNull();
            expect(receipt.success).toBe(true);

            const bal1 = await sendJsonRpcRequest(nodeUrl, 'eth_getBalance', [recipient1, 'latest']);
            const bal2 = await sendJsonRpcRequest(nodeUrl, 'eth_getBalance', [recipient2, 'latest']);
            expect(BigInt(bal1)).toBe(value1);
            expect(BigInt(bal2)).toBe(value2);
        },
    );

    test.skip.each(unrunnable)('two ETH transfers in one userop: $name (setup failed)', () => {});
});
