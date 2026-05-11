const { sendJsonRpcRequest } = require('../../dist/index.cjs');

jest.setTimeout(30000);

const NODE_RPC_URL = 'http://127.0.0.1:8545';
const EXPECTED_CHAIN_ID = 11155111;

describe('node rpc chain id', () => {
    test('returns Sepolia chain id (11155111)', async () => {
        const result = await sendJsonRpcRequest(NODE_RPC_URL, 'eth_chainId', []);
        expect(parseInt(result, 16)).toBe(EXPECTED_CHAIN_ID);
    });
});
