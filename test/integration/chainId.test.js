const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sendJsonRpcRequest } = require('../../dist/index.cjs');
const chains = require('./chains.cjs');

jest.setTimeout(30000);

const STATUS_FILE = path.join(os.tmpdir(), 'abstractionkit-integration-status.json');
const status = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
const statusByName = Object.fromEntries(status.map((s) => [s.name, s]));

describe.each(chains)('eth_chainId on $name (chainId $chainId)', (chain) => {
    const ok = statusByName[chain.name]?.ok === true;
    const maybe = ok ? test : test.skip;
    const nodeUrl = `http://127.0.0.1:${chain.anvilHostPort}`;
    const bundlerUrl = `http://127.0.0.1:${chain.bundlerHostPort}/rpc`;
    let nodeChainId;
    let bundlerChainId;

    maybe('node returns chain id', async () => {
        const result = await sendJsonRpcRequest(nodeUrl, 'eth_chainId', []);
        nodeChainId = parseInt(result, 16);
        expect(nodeChainId).toBe(chain.chainId);
    });

    maybe('bundler returns chain id', async () => {
        const result = await sendJsonRpcRequest(bundlerUrl, 'eth_chainId', []);
        bundlerChainId = parseInt(result, 16);
        expect(bundlerChainId).toBe(chain.chainId);
    });

    maybe('node and bundler agree on chain id', () => {
        expect(nodeChainId).toBe(bundlerChainId);
    });
});
