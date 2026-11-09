// Regression tests: an eth_call to an address without code returns "0x". The
// Safe readers passed that to the ABI decoder and surfaced its internal
// out-of-bounds error (getFallbackHandler: "invalid address 0x0x"). They now
// name the method and the likely cause, like getModules always did. Offline.

const ak = require('../../dist/index.cjs');
const { AbiCoder } = require('ethers');

const ACCOUNT = '0x' + '42'.repeat(20);
const MODULE = '0x' + '43'.repeat(20);
const coder = AbiCoder.defaultAbiCoder();
const nodeReturning = (result) => ({ request: async () => result });

const CLASSES = [
    ['SafeAccountV0_2_0', ak.SafeAccountV0_2_0],
    ['SafeAccountV0_3_0', ak.SafeAccountV0_3_0],
    ['SafeMultiChainSigAccountV1', ak.SafeMultiChainSigAccountV1],
];

describe.each(CLASSES)('%s readers on an account without code', (_name, Account) => {
    const account = new Account(ACCOUNT);
    const empty = nodeReturning('0x');

    test.each([
        ['getOwners', () => account.getOwners(empty)],
        ['getThreshold', () => account.getThreshold(empty)],
        ['isModuleEnabled', () => account.isModuleEnabled(empty, MODULE)],
        ['getSafeVersion', () => account.getSafeVersion(empty)],
    ])('%s throws a BAD_DATA error that names the method', async (method, read) => {
        const error = await read().then(
            () => null,
            (e) => e,
        );
        expect(error).toBeInstanceOf(ak.AbstractionKitError);
        expect(error.code).toBe('BAD_DATA');
        expect(error.message).toContain(method);
        expect(error.message).toContain('not deployed');
    });

    test('the owner helpers that read the owners fail the same way', async () => {
        await expect(account.createRemoveOwnerMetaTransaction(empty, MODULE, 1)).rejects.toThrow(/getOwners/);
    });

    test('getFallbackHandler reads an empty slot as the zero address', async () => {
        const zero = '0x' + '00'.repeat(20);
        expect(await account.getFallbackHandler(nodeReturning('0x'))).toBe(zero);
        expect(await account.getFallbackHandler(nodeReturning('0x0'))).toBe(zero);
        expect(await account.getFallbackHandler(nodeReturning('0x' + '0'.repeat(64)))).toBe(zero);
    });
});

describe.each(CLASSES)('%s readers on a deployed account still decode', (_name, Account) => {
    const account = new Account(ACCOUNT);

    test('getOwners, getThreshold, isModuleEnabled, getSafeVersion, getFallbackHandler', async () => {
        expect(await account.getOwners(nodeReturning(coder.encode(['address[]'], [[MODULE]])))).toEqual([MODULE]);
        expect(await account.getThreshold(nodeReturning(coder.encode(['uint256'], [2])))).toBe(2);
        expect(await account.isModuleEnabled(nodeReturning(coder.encode(['bool'], [true])), MODULE)).toBe(true);
        expect(await account.isModuleEnabled(nodeReturning(coder.encode(['bool'], [false])), MODULE)).toBe(false);
        expect(await account.getSafeVersion(nodeReturning(coder.encode(['string'], ['1.4.1'])))).toBe('1.4.1');
        expect(await account.getFallbackHandler(nodeReturning('0x' + '0'.repeat(24) + MODULE.slice(2)))).toBe(MODULE);
    });
});
