// Regression tests: an eth_call to an EOA that is not delegated returns "0x".
// isKeyRegistered / getKeySettings / getKey passed that to the ABI decoder and
// surfaced its out-of-bounds error, while getKeys already returned []. Offline.

const ak = require('../../dist/index.cjs');
const { AbiCoder } = require('ethers');

const EOA = '0x' + '11'.repeat(20);
const KEY_HASH = '0x' + 'ab'.repeat(32);
const coder = AbiCoder.defaultAbiCoder();
const nodeReturning = (result) => ({ request: async () => result });
const account = new ak.Calibur7702Account(EOA);

describe('Calibur key readers on an EOA that is not delegated', () => {
    const empty = nodeReturning('0x');

    test('isKeyRegistered is false, in line with getKeys returning []', async () => {
        expect(await account.isKeyRegistered(empty, KEY_HASH)).toBe(false);
        expect(await account.getKeys(empty, { blockNumber: 1n })).toEqual([]);
    });

    test.each([
        ['getKeySettings', () => account.getKeySettings(empty, KEY_HASH)],
        ['getKey', () => account.getKey(empty, KEY_HASH)],
    ])('%s throws a BAD_DATA error that names the method', async (method, read) => {
        const error = await read().then(
            () => null,
            (e) => e,
        );
        expect(error).toBeInstanceOf(ak.AbstractionKitError);
        expect(error.code).toBe('BAD_DATA');
        expect(error.message).toContain(method);
        expect(error.message).toContain('not delegated');
    });
});

describe('Calibur key readers on a delegated account still decode', () => {
    test('isKeyRegistered', async () => {
        expect(await account.isKeyRegistered(nodeReturning(coder.encode(['bool'], [true])), KEY_HASH)).toBe(true);
        expect(await account.isKeyRegistered(nodeReturning(coder.encode(['bool'], [false])), KEY_HASH)).toBe(false);
    });

    test('getKeySettings', async () => {
        const settings = await account.getKeySettings(nodeReturning(coder.encode(['uint256'], [1n << 200n])), KEY_HASH);
        expect(settings.isAdmin).toBe(true);
    });

    test('getKey', async () => {
        const publicKey = '0x' + '04'.repeat(64);
        const key = await account.getKey(nodeReturning(coder.encode(['(uint8,bytes)'], [[2, publicKey]])), KEY_HASH);
        expect(key).toEqual({ keyType: 2, publicKey });
    });
});
