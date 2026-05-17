const { Bundler, ENTRYPOINT_V7 } = require('../../../../dist/index.cjs');
const { runnable, unrunnable, bundlerUrl } = require('../../_runnable.cjs');

jest.setTimeout(120000);

const randomUserOpHash = () =>
    `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`;

describe('bundler rpc', () => {
    test.concurrent.each(runnable)(
        '$name (chainId $chainId): chainId, supportedEntryPoints, byHash/receipt for unknown hash',
        async (chain) => {
            const bundler = new Bundler(bundlerUrl(chain));

            const chainId = await bundler.chainId();
            expect(BigInt(chainId)).toBe(BigInt(chain.chainId));

            const entryPoints = await bundler.supportedEntryPoints();
            expect(Array.isArray(entryPoints)).toBe(true);
            expect(entryPoints.length).toBeGreaterThan(0);
            expect(entryPoints.map((e) => e.toLowerCase())).toContain(ENTRYPOINT_V7.toLowerCase());

            const unknownHash = randomUserOpHash();
            expect(await bundler.getUserOperationByHash(unknownHash)).toBeNull();
            expect(await bundler.getUserOperationReceipt(unknownHash)).toBeNull();
        },
    );

    if (unrunnable.length > 0) {
        test.skip.each(unrunnable)('$name (setup failed)', () => {});
    }
});
