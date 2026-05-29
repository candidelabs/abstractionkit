// Unit tests for the Safe 4337 module-migration helpers and the fallback-handler
// reader. Deterministic and offline: a hand-rolled mock Transport stands in for
// the node, and when a previous module is supplied the disable path skips RPC
// entirely.

const { AbiCoder, getAddress } = require('ethers');
const {
    SafeAccountV0_2_0,
    SafeAccountV0_3_0,
    SafeMultiChainSigAccountV1,
    SAFE_FALLBACK_HANDLER_STORAGE_SLOT,
} = require('../../dist/index.cjs');

const DISABLE_MODULE = '0xe009cfde'; // disableModule(address,address)
const ENABLE_MODULE = '0x610b5925'; // enableModule(address)
const SET_FALLBACK_HANDLER = '0xf08a0323'; // setFallbackHandler(address)
const SENTINEL = '0x0000000000000000000000000000000000000001';

const ACCOUNT = '0x1111111111111111111111111111111111111111';
const V07_MODULE = SafeAccountV0_3_0.DEFAULT_SAFE_4337_MODULE_ADDRESS;
const V09_MODULE = SafeMultiChainSigAccountV1.DEFAULT_SAFE_4337_MODULE_ADDRESS;
const V06_MODULE = SafeAccountV0_2_0.DEFAULT_SAFE_4337_MODULE_ADDRESS;

// Decode the i-th 32-byte address argument (after the 4-byte selector).
function addrArg(data, i) {
    const start = 10 + i * 64;
    return getAddress('0x' + data.slice(start, start + 64).slice(-40));
}

// A Transport whose request handler is supplied per-test. `calls` records every
// request so method/params can be asserted.
function mockTransport(handler) {
    const calls = [];
    return {
        request: async (args) => {
            calls.push(args);
            return handler(args);
        },
        calls,
    };
}

describe('SafeAccount.createModuleMigrationMetaTransactions', () => {
    test('returns [disable, enable, setFallbackHandler] with correct selectors and targets', async () => {
        const account = new SafeAccountV0_3_0(ACCOUNT);
        const batch = await account.createModuleMigrationMetaTransactions(
            'https://unused.invalid',
            V07_MODULE,
            V09_MODULE,
            { prevModuleAddress: SENTINEL }, // skip the on-chain predecessor lookup
        );

        expect(batch).toHaveLength(3);
        for (const tx of batch) {
            expect(getAddress(tx.to)).toBe(getAddress(ACCOUNT));
            expect(tx.value).toBe(0n);
        }

        // 1. disableModule(prev, oldModule)
        expect(batch[0].data.slice(0, 10)).toBe(DISABLE_MODULE);
        expect(addrArg(batch[0].data, 0)).toBe(getAddress(SENTINEL));
        expect(addrArg(batch[0].data, 1)).toBe(getAddress(V07_MODULE));

        // 2. enableModule(newModule)
        expect(batch[1].data.slice(0, 10)).toBe(ENABLE_MODULE);
        expect(addrArg(batch[1].data, 0)).toBe(getAddress(V09_MODULE));

        // 3. setFallbackHandler(newModule)
        expect(batch[2].data.slice(0, 10)).toBe(SET_FALLBACK_HANDLER);
        expect(addrArg(batch[2].data, 0)).toBe(getAddress(V09_MODULE));
    });

    test('looks up the predecessor on-chain when prevModuleAddress is omitted', async () => {
        // getModulesPaginated returns the old module at index 0, so the
        // predecessor is the sentinel.
        const transport = mockTransport(({ method }) => {
            if (method === 'eth_call') {
                return AbiCoder.defaultAbiCoder().encode(
                    ['address[]', 'address'],
                    [[V07_MODULE], SENTINEL],
                );
            }
            throw new Error(`unexpected method ${method}`);
        });

        const account = new SafeAccountV0_3_0(ACCOUNT);
        const batch = await account.createModuleMigrationMetaTransactions(
            transport,
            V07_MODULE,
            V09_MODULE,
        );

        expect(transport.calls.some((c) => c.method === 'eth_call')).toBe(true);
        expect(batch[0].data.slice(0, 10)).toBe(DISABLE_MODULE);
        expect(addrArg(batch[0].data, 0)).toBe(getAddress(SENTINEL)); // predecessor
        expect(addrArg(batch[0].data, 1)).toBe(getAddress(V07_MODULE)); // module disabled
    });
});

describe('SafeAccountV0_3_0.createMigrateToSafeMultiChainSigAccountV1MetaTransactions', () => {
    test('disables the v0.7 module and enables/sets the v0.9 module', async () => {
        const account = new SafeAccountV0_3_0(ACCOUNT);
        const batch = await account.createMigrateToSafeMultiChainSigAccountV1MetaTransactions(
            'https://unused.invalid',
            { prevModuleAddress: SENTINEL },
        );

        expect(batch).toHaveLength(3);
        expect(addrArg(batch[0].data, 1)).toBe(getAddress(V07_MODULE)); // disable v0.7
        expect(addrArg(batch[1].data, 0)).toBe(getAddress(V09_MODULE)); // enable v0.9
        expect(addrArg(batch[2].data, 0)).toBe(getAddress(V09_MODULE)); // fallback -> v0.9
    });

    test('honors explicit module overrides', async () => {
        const customOld = '0x00000000000000000000000000000000000000a7';
        const customNew = '0x00000000000000000000000000000000000000a9';
        const account = new SafeAccountV0_3_0(ACCOUNT);
        const batch = await account.createMigrateToSafeMultiChainSigAccountV1MetaTransactions(
            'https://unused.invalid',
            { safeV07ModuleAddress: customOld, safeV09ModuleAddress: customNew, prevModuleAddress: SENTINEL },
        );
        expect(addrArg(batch[0].data, 1)).toBe(getAddress(customOld));
        expect(addrArg(batch[1].data, 0)).toBe(getAddress(customNew));
        expect(addrArg(batch[2].data, 0)).toBe(getAddress(customNew));
    });
});

describe('SafeAccountV0_2_0.createMigrateToSafeAccountV0_3_0MetaTransactions (prevModuleAddress regression)', () => {
    test('defaults to migrating the v0.6 module to the v0.7 module', async () => {
        const transport = mockTransport(({ method }) => {
            if (method === 'eth_call') {
                return AbiCoder.defaultAbiCoder().encode(
                    ['address[]', 'address'],
                    [[V06_MODULE], SENTINEL],
                );
            }
            throw new Error(`unexpected method ${method}`);
        });
        const account = new SafeAccountV0_2_0(ACCOUNT);
        const batch = await account.createMigrateToSafeAccountV0_3_0MetaTransactions(transport);

        expect(addrArg(batch[0].data, 1)).toBe(getAddress(V06_MODULE)); // disable v0.6
        expect(addrArg(batch[1].data, 0)).toBe(getAddress(V07_MODULE)); // enable v0.7
        expect(addrArg(batch[2].data, 0)).toBe(getAddress(V07_MODULE)); // fallback -> v0.7
    });

    test('explicit prevModuleAddress is used as the predecessor, NOT the module being disabled', async () => {
        // Regression: previously safeV06ModuleAddress was mis-wired into
        // prevModuleAddress, producing disableModule(prev=module, module).
        const predecessor = '0x00000000000000000000000000000000000000aa';
        const moduleToDisable = '0x00000000000000000000000000000000000000bb';
        const account = new SafeAccountV0_2_0(ACCOUNT);
        const batch = await account.createMigrateToSafeAccountV0_3_0MetaTransactions(
            'https://unused.invalid',
            { safeV06ModuleAddress: moduleToDisable, prevModuleAddress: predecessor },
        );

        expect(batch[0].data.slice(0, 10)).toBe(DISABLE_MODULE);
        expect(addrArg(batch[0].data, 0)).toBe(getAddress(predecessor)); // prev
        expect(addrArg(batch[0].data, 1)).toBe(getAddress(moduleToDisable)); // module
        // The bug would have made these equal:
        expect(addrArg(batch[0].data, 0)).not.toBe(addrArg(batch[0].data, 1));
    });
});

describe('SafeAccount.getFallbackHandler', () => {
    test('reads the fallback-handler storage slot and returns a checksummed address', async () => {
        const stored = '0x'
            + '0'.repeat(24)
            + V09_MODULE.slice(2).toLowerCase(); // 32-byte word: left-padded address
        const transport = mockTransport(({ method, params }) => {
            expect(method).toBe('eth_getStorageAt');
            expect(params[0]).toBe(ACCOUNT);
            expect(params[1]).toBe(SAFE_FALLBACK_HANDLER_STORAGE_SLOT);
            expect(params[2]).toBe('latest');
            return stored;
        });

        const account = new SafeAccountV0_3_0(ACCOUNT);
        const handler = await account.getFallbackHandler(transport);
        expect(handler).toBe(getAddress(V09_MODULE));
    });
});
