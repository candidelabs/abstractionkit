// Tests for the `polygonGasStation` override of createUserOperation. It had no
// test, and a gas station answering with an HTTP error surfaced as a TypeError
// on `undefined.maxFee`. Two of the four endpoints (zkEVM and Cardona) are
// retired and answer 404, so that path is the normal one for them.
// Offline: global fetch is mocked.

const ak = require('../dist/index.cjs');

const ACCOUNT = '0x' + '42'.repeat(20);
const TX = [{ to: ACCOUNT, value: 0n, data: '0x' }];
const GAS = { nonce: 1n, callGasLimit: 1n, verificationGasLimit: 1n, preVerificationGas: 1n };
const STATION = {
    safeLow: { maxPriorityFee: 30.1, maxFee: 30.2 },
    standard: { maxPriorityFee: 31, maxFee: 32.000000001 },
    fast: { maxPriorityFee: 0, maxFee: 40 },
};

describe('polygonGasStation override', () => {
    const originalFetch = global.fetch;
    let urls;
    afterEach(() => {
        global.fetch = originalFetch;
    });

    function mockStation(status, body) {
        urls = [];
        global.fetch = async (url) => {
            urls.push(url);
            return { ok: status === 200, status, statusText: status === 200 ? 'OK' : 'Not Found', json: async () => body };
        };
    }
    const create = (overrides) =>
        new ak.SafeAccountV0_3_0(ACCOUNT).createUserOperation(TX, undefined, undefined, { ...GAS, ...overrides });

    test.each([
        [ak.PolygonChain.Mainnet, 'v2'],
        [ak.PolygonChain.Amoy, 'amoy'],
    ])('reads the %s endpoint', async (chain, path) => {
        mockStation(200, STATION);
        await create({ polygonGasStation: chain });
        expect(urls).toEqual([`https://gasstation.polygon.technology/${path}`]);
    });

    test('maps the gas level to the station tier and converts gwei to wei, rounding up', async () => {
        mockStation(200, STATION);
        const slow = await create({ polygonGasStation: ak.PolygonChain.Mainnet, gasLevel: ak.GasOption.Slow });
        expect([slow.maxFeePerGas, slow.maxPriorityFeePerGas]).toEqual([30_200_000_000n, 30_100_000_000n]);
        const medium = await create({ polygonGasStation: ak.PolygonChain.Mainnet, gasLevel: ak.GasOption.Medium });
        expect([medium.maxFeePerGas, medium.maxPriorityFeePerGas]).toEqual([32_000_000_001n, 31_000_000_000n]);
        // a zero tip is raised to 1 wei
        const fast = await create({ polygonGasStation: ak.PolygonChain.Mainnet, gasLevel: ak.GasOption.Fast });
        expect([fast.maxFeePerGas, fast.maxPriorityFeePerGas]).toEqual([40_000_000_000n, 1n]);
    });

    test.each([ak.PolygonChain.ZkMainnet, ak.PolygonChain.Cardona])(
        'a retired endpoint (%s) fails with the HTTP status as the cause',
        async (chain) => {
            mockStation(404, { success: false, data: { message: 'Not found' } });
            const error = await create({ polygonGasStation: chain }).then(
                () => null,
                (e) => e,
            );
            expect(error).toBeInstanceOf(ak.AbstractionKitError);
            expect(error.code).toBe('BAD_DATA');
            expect(error.message).toContain(`https://gasstation.polygon.technology/${chain}`);
            expect(error.cause.message).toMatch(/HTTP 404/);
        },
    );

    test('a body without the requested tier is reported as such', async () => {
        mockStation(200, { safeLow: STATION.safeLow });
        await expect(create({ polygonGasStation: ak.PolygonChain.Mainnet })).rejects.toMatchObject({
            code: 'BAD_DATA',
            cause: { message: expect.stringContaining('no price for the requested gas level') },
        });
    });
});
