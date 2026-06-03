// Unit tests for the Safe 4337 module-migration helpers, the migration preflight,
// and the fallback-handler / version readers. Deterministic and offline: a
// hand-rolled mock Transport stands in for the node. Builder-shape tests pass
// `skipPreflight: true` so they exercise only calldata construction; the preflight
// is covered by its own block.

const { AbiCoder, getAddress } = require('ethers');
const {
    SafeAccountV0_2_0,
    SafeAccountV0_3_0,
    SafeMultiChainSigAccountV1,
    SAFE_FALLBACK_HANDLER_STORAGE_SLOT,
    getFunctionSelector,
} = require('../../dist/index.cjs');

const DISABLE_MODULE = '0xe009cfde'; // disableModule(address,address)
const ENABLE_MODULE = '0x610b5925'; // enableModule(address)
const SET_FALLBACK_HANDLER = '0xf08a0323'; // setFallbackHandler(address)
const SENTINEL = '0x0000000000000000000000000000000000000001';

const ACCOUNT = '0x1111111111111111111111111111111111111111';
const V07_MODULE = SafeAccountV0_3_0.DEFAULT_SAFE_4337_MODULE_ADDRESS;
const V09_MODULE = SafeMultiChainSigAccountV1.DEFAULT_SAFE_4337_MODULE_ADDRESS;
const V06_MODULE = SafeAccountV0_2_0.DEFAULT_SAFE_4337_MODULE_ADDRESS;

const VERSION_SELECTOR = getFunctionSelector('VERSION()');
const IS_MODULE_ENABLED_SELECTOR = getFunctionSelector('isModuleEnabled(address)');

// Decode the i-th 32-byte address argument (after the 4-byte selector).
function addrArg(data, i) {
    const start = 10 + i * 64;
    return getAddress('0x' + data.slice(start, start + 64).slice(-40));
}

function leftPadAddress(address) {
    return '0x' + '0'.repeat(24) + address.toLowerCase().replace(/^0x/, '').padStart(40, '0');
}

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

// A transport simulating a deployed Safe: fallback handler, module-enabled
// answer, version string, and the module list for predecessor lookups.
function safeMock({ fallback = V07_MODULE, moduleEnabled = true, version = '1.4.1', modules = [V07_MODULE] } = {}) {
    return mockTransport(({ method, params }) => {
        if (method === 'eth_getStorageAt') return leftPadAddress(fallback);
        if (method === 'eth_call') {
            const data = params[0].data;
            if (data.startsWith(VERSION_SELECTOR)) {
                return AbiCoder.defaultAbiCoder().encode(['string'], [version]);
            }
            if (data.startsWith(IS_MODULE_ENABLED_SELECTOR)) {
                return AbiCoder.defaultAbiCoder().encode(['bool'], [moduleEnabled]);
            }
            // getModulesPaginated(address,uint256)
            return AbiCoder.defaultAbiCoder().encode(['address[]', 'address'], [modules, SENTINEL]);
        }
        throw new Error(`unexpected method ${method}`);
    });
}

// createModuleMigrationMetaTransactions is protected; its shape and predecessor
// lookup are exercised through the public version-specific wrapper.
describe('SafeAccountV0_3_0.createMigrateToSafeMultiChainSigAccountV1MetaTransactions', () => {
    test('returns [disable, enable, setFallbackHandler] with correct selectors and targets', async () => {
        const account = new SafeAccountV0_3_0(ACCOUNT);
        const batch = await account.createMigrateToSafeMultiChainSigAccountV1MetaTransactions(
            'https://unused.invalid',
            { prevModuleAddress: SENTINEL, skipPreflight: true },
        );

        expect(batch).toHaveLength(3);
        for (const tx of batch) {
            expect(getAddress(tx.to)).toBe(getAddress(ACCOUNT));
            expect(tx.value).toBe(0n);
        }

        // 1. disableModule(prev, oldModule = v0.7)
        expect(batch[0].data.slice(0, 10)).toBe(DISABLE_MODULE);
        expect(addrArg(batch[0].data, 0)).toBe(getAddress(SENTINEL));
        expect(addrArg(batch[0].data, 1)).toBe(getAddress(V07_MODULE));
        // 2. enableModule(newModule = v0.9)
        expect(batch[1].data.slice(0, 10)).toBe(ENABLE_MODULE);
        expect(addrArg(batch[1].data, 0)).toBe(getAddress(V09_MODULE));
        // 3. setFallbackHandler(newModule = v0.9)
        expect(batch[2].data.slice(0, 10)).toBe(SET_FALLBACK_HANDLER);
        expect(addrArg(batch[2].data, 0)).toBe(getAddress(V09_MODULE));
    });

    test('looks up the predecessor on-chain when prevModuleAddress is omitted', async () => {
        const transport = safeMock();
        const account = new SafeAccountV0_3_0(ACCOUNT);
        const batch = await account.createMigrateToSafeMultiChainSigAccountV1MetaTransactions(
            transport,
            { skipPreflight: true },
        );

        expect(transport.calls.some((c) => c.method === 'eth_call')).toBe(true);
        expect(batch[0].data.slice(0, 10)).toBe(DISABLE_MODULE);
        expect(addrArg(batch[0].data, 0)).toBe(getAddress(SENTINEL)); // predecessor
        expect(addrArg(batch[0].data, 1)).toBe(getAddress(V07_MODULE)); // module disabled
    });

    test('honors explicit module overrides', async () => {
        const customOld = '0x00000000000000000000000000000000000000a7';
        const customNew = '0x00000000000000000000000000000000000000a9';
        const account = new SafeAccountV0_3_0(ACCOUNT);
        const batch = await account.createMigrateToSafeMultiChainSigAccountV1MetaTransactions(
            'https://unused.invalid',
            { safeV07ModuleAddress: customOld, safeV09ModuleAddress: customNew, prevModuleAddress: SENTINEL, skipPreflight: true },
        );
        expect(addrArg(batch[0].data, 1)).toBe(getAddress(customOld));
        expect(addrArg(batch[1].data, 0)).toBe(getAddress(customNew));
        expect(addrArg(batch[2].data, 0)).toBe(getAddress(customNew));
    });
});

describe('SafeAccountV0_2_0.createMigrateToSafeAccountV0_3_0MetaTransactions (prevModuleAddress regression)', () => {
    test('defaults to migrating the v0.6 module to the v0.7 module', async () => {
        const account = new SafeAccountV0_2_0(ACCOUNT);
        const batch = await account.createMigrateToSafeAccountV0_3_0MetaTransactions(
            safeMock({ fallback: V06_MODULE, modules: [V06_MODULE] }),
            { skipPreflight: true },
        );
        expect(addrArg(batch[0].data, 1)).toBe(getAddress(V06_MODULE));
        expect(addrArg(batch[1].data, 0)).toBe(getAddress(V07_MODULE));
        expect(addrArg(batch[2].data, 0)).toBe(getAddress(V07_MODULE));
    });

    test('explicit prevModuleAddress is used as the predecessor, NOT the module being disabled', async () => {
        // Regression: previously safeV06ModuleAddress was mis-wired into
        // prevModuleAddress, producing disableModule(prev=module, module).
        const predecessor = '0x00000000000000000000000000000000000000aa';
        const moduleToDisable = '0x00000000000000000000000000000000000000bb';
        const account = new SafeAccountV0_2_0(ACCOUNT);
        const batch = await account.createMigrateToSafeAccountV0_3_0MetaTransactions(
            'https://unused.invalid',
            { safeV06ModuleAddress: moduleToDisable, prevModuleAddress: predecessor, skipPreflight: true },
        );

        expect(batch[0].data.slice(0, 10)).toBe(DISABLE_MODULE);
        expect(addrArg(batch[0].data, 0)).toBe(getAddress(predecessor)); // prev
        expect(addrArg(batch[0].data, 1)).toBe(getAddress(moduleToDisable)); // module
        expect(addrArg(batch[0].data, 0)).not.toBe(addrArg(batch[0].data, 1));
    });
});

describe('migration preflight', () => {
    test('passes when the old module is the fallback handler, enabled, and version >= 1.4.1', async () => {
        const account = new SafeAccountV0_3_0(ACCOUNT);
        const batch = await account.createMigrateToSafeMultiChainSigAccountV1MetaTransactions(
            safeMock({ fallback: V07_MODULE, moduleEnabled: true, version: '1.4.1' }),
        );
        expect(batch).toHaveLength(3);
    });

    test('passes on a newer Safe version (1.5.0)', async () => {
        const account = new SafeAccountV0_3_0(ACCOUNT);
        const batch = await account.createMigrateToSafeMultiChainSigAccountV1MetaTransactions(
            safeMock({ version: '1.5.0' }),
        );
        expect(batch).toHaveLength(3);
    });

    test('throws when the fallback handler is not the old module', async () => {
        const account = new SafeAccountV0_3_0(ACCOUNT);
        await expect(
            account.createMigrateToSafeMultiChainSigAccountV1MetaTransactions(
                safeMock({ fallback: '0x00000000000000000000000000000000000000cc' }),
            ),
        ).rejects.toMatchObject({ code: 'BAD_DATA' });
    });

    test('throws when the old module is not enabled', async () => {
        const account = new SafeAccountV0_3_0(ACCOUNT);
        await expect(
            account.createMigrateToSafeMultiChainSigAccountV1MetaTransactions(
                safeMock({ fallback: V07_MODULE, moduleEnabled: false }),
            ),
        ).rejects.toMatchObject({ code: 'BAD_DATA' });
    });

    test('throws when the Safe version is below 1.4.1', async () => {
        const account = new SafeAccountV0_3_0(ACCOUNT);
        await expect(
            account.createMigrateToSafeMultiChainSigAccountV1MetaTransactions(
                safeMock({ version: '1.3.0' }),
            ),
        ).rejects.toMatchObject({ code: 'BAD_DATA' });
    });

    test('skipPreflight bypasses all checks (no storage read, builds anyway)', async () => {
        // A mock that would FAIL preflight (wrong fallback) still produces a batch
        // and never reads the fallback-handler slot.
        const transport = safeMock({ fallback: '0x00000000000000000000000000000000000000cc' });
        const account = new SafeAccountV0_3_0(ACCOUNT);
        const batch = await account.createMigrateToSafeMultiChainSigAccountV1MetaTransactions(
            transport,
            { prevModuleAddress: SENTINEL, skipPreflight: true },
        );
        expect(batch).toHaveLength(3);
        expect(transport.calls.some((c) => c.method === 'eth_getStorageAt')).toBe(false);
    });

    test('normalizes a raw error from the module-enabled check to BAD_DATA', async () => {
        // fallback handler passes, but the isModuleEnabled eth_call reverts.
        const transport = mockTransport(({ method, params }) => {
            if (method === 'eth_getStorageAt') return leftPadAddress(V07_MODULE);
            if (method === 'eth_call' && params[0].data.startsWith(IS_MODULE_ENABLED_SELECTOR)) {
                throw new Error('execution reverted');
            }
            return AbiCoder.defaultAbiCoder().encode(['address[]', 'address'], [[V07_MODULE], SENTINEL]);
        });
        const account = new SafeAccountV0_3_0(ACCOUNT);
        await expect(
            account.createMigrateToSafeMultiChainSigAccountV1MetaTransactions(transport),
        ).rejects.toMatchObject({ name: 'AbstractionKitError', code: 'BAD_DATA' });
    });

    test('normalizes a raw error from the VERSION() read to BAD_DATA', async () => {
        const transport = mockTransport(({ method, params }) => {
            if (method === 'eth_getStorageAt') return leftPadAddress(V07_MODULE);
            if (method === 'eth_call') {
                if (params[0].data.startsWith(VERSION_SELECTOR)) throw new Error('execution reverted');
                if (params[0].data.startsWith(IS_MODULE_ENABLED_SELECTOR)) {
                    return AbiCoder.defaultAbiCoder().encode(['bool'], [true]);
                }
            }
            return AbiCoder.defaultAbiCoder().encode(['address[]', 'address'], [[V07_MODULE], SENTINEL]);
        });
        const account = new SafeAccountV0_3_0(ACCOUNT);
        await expect(
            account.createMigrateToSafeMultiChainSigAccountV1MetaTransactions(transport),
        ).rejects.toMatchObject({ name: 'AbstractionKitError', code: 'BAD_DATA' });
    });

    test('treats an empty VERSION() string as a failed preflight', async () => {
        const account = new SafeAccountV0_3_0(ACCOUNT);
        await expect(
            account.createMigrateToSafeMultiChainSigAccountV1MetaTransactions(
                safeMock({ version: '' }),
            ),
        ).rejects.toMatchObject({ code: 'BAD_DATA' });
    });
});

describe('SafeAccount readers', () => {
    test('getFallbackHandler returns a checksummed address from the slot', async () => {
        const transport = mockTransport(({ method, params }) => {
            expect(method).toBe('eth_getStorageAt');
            expect(params[0]).toBe(ACCOUNT);
            expect(params[1]).toBe(SAFE_FALLBACK_HANDLER_STORAGE_SLOT);
            return leftPadAddress(V09_MODULE);
        });
        const account = new SafeAccountV0_3_0(ACCOUNT);
        expect(await account.getFallbackHandler(transport)).toBe(getAddress(V09_MODULE));
    });

    test('getSafeVersion decodes the VERSION() string', async () => {
        const transport = mockTransport(({ method, params }) => {
            expect(method).toBe('eth_call');
            expect(params[0].data.startsWith(VERSION_SELECTOR)).toBe(true);
            return AbiCoder.defaultAbiCoder().encode(['string'], ['1.4.1']);
        });
        const account = new SafeAccountV0_3_0(ACCOUNT);
        expect(await account.getSafeVersion(transport)).toBe('1.4.1');
    });
});
