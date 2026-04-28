const { SafeAccountV0_3_0, SafeAccountV0_2_0 } = require('../../dist/index.cjs');

describe('SafeAccount.isDeployed', () => {
    const fakeRpc = 'https://rpc.example.invalid';
    const address = '0x1111111111111111111111111111111111111111';

    let originalFetch;
    let lastRequest;

    beforeEach(() => {
        originalFetch = global.fetch;
        lastRequest = null;
    });

    afterEach(() => {
        global.fetch = originalFetch;
    });

    function mockFetchReturning(code) {
        global.fetch = async (url, options) => {
            lastRequest = { url, body: JSON.parse(options.body) };
            return {
                json: async () => ({ jsonrpc: '2.0', id: 1, result: code }),
            };
        };
    }

    test('returns true when bytecode is deployed (V0_3_0)', async () => {
        mockFetchReturning('0x6080604052' + 'aa'.repeat(40));
        const result = await SafeAccountV0_3_0.isDeployed(address, fakeRpc);
        expect(result).toBe(true);
        expect(lastRequest.body.method).toBe('eth_getCode');
        expect(lastRequest.body.params).toEqual([address, 'latest']);
    });

    test('returns false when no bytecode is present (V0_3_0)', async () => {
        mockFetchReturning('0x');
        const result = await SafeAccountV0_3_0.isDeployed(address, fakeRpc);
        expect(result).toBe(false);
    });

    test('inherits onto V0_2_0 with same behavior', async () => {
        mockFetchReturning('0x');
        expect(await SafeAccountV0_2_0.isDeployed(address, fakeRpc)).toBe(false);

        mockFetchReturning('0xdeadbeef');
        expect(await SafeAccountV0_2_0.isDeployed(address, fakeRpc)).toBe(true);
    });

    test('treats EIP-7702 delegation prefix as deployed', async () => {
        // 0xef0100 + 20-byte delegatee. Not a Safe, but bytecode is present
        // so isDeployed must return true. Callers that need to distinguish
        // delegation from a real Safe must do that check separately.
        mockFetchReturning('0xef0100' + '11'.repeat(20));
        const result = await SafeAccountV0_3_0.isDeployed(address, fakeRpc);
        expect(result).toBe(true);
    });
});
