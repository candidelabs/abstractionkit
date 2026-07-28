// Offline tests for AllowanceModule setAllowance encoding and the guards
// around the on-chain semantics of resetTimeMin/resetBaseMin.

const ak = require('../../dist/index.cjs');
const { AbiCoder } = require('ethers');

const DELEGATE = '0x1a02592A3484c2077d2E5D24482497F85e1980C6';
const TOKEN = '0x084f4dB6bae8fBb7fb9709c0A25532E21C7A097E';
const SET_ALLOWANCE_SELECTOR = '0xbeaeb388';

function decodeSetAllowance(data) {
    expect(data.slice(0, 10)).toBe(SET_ALLOWANCE_SELECTOR);
    const [delegate, token, amount, resetTimeMin, resetBaseMin] =
        AbiCoder.defaultAbiCoder().decode(
            ['address', 'address', 'uint96', 'uint16', 'uint32'],
            '0x' + data.slice(10),
        );
    return { delegate, token, amount, resetTimeMin, resetBaseMin };
}

describe('AllowanceModule setAllowance encoding', () => {
    const module = new ak.AllowanceModule();

    test('one-time allowance encodes resetTimeMin=0 and resetBaseMin=0', () => {
        const tx = module.createOneTimeAllowanceMetaTransaction(DELEGATE, TOKEN, 100n);
        const { amount, resetTimeMin, resetBaseMin } = decodeSetAllowance(tx.data);
        expect(amount).toBe(100n);
        expect(resetTimeMin).toBe(0n);
        expect(resetBaseMin).toBe(0n);
    });

    test('recurring allowance converts the seconds timestamp to epoch-minutes', () => {
        const baselineSeconds = BigInt(Math.floor(Date.now() / 1000)) - 3600n;
        const tx = module.createRecurringAllowanceMetaTransaction(
            DELEGATE,
            TOKEN,
            100n,
            1440n,
            baselineSeconds,
        );
        const { resetTimeMin, resetBaseMin } = decodeSetAllowance(tx.data);
        expect(resetTimeMin).toBe(1440n);
        expect(resetBaseMin).toBe(baselineSeconds / 60n);
    });

    test('sub-minute precision is floored', () => {
        const tx = module.createRecurringAllowanceMetaTransaction(DELEGATE, TOKEN, 100n, 1440n, 119n);
        const { resetBaseMin } = decodeSetAllowance(tx.data);
        expect(resetBaseMin).toBe(1n);
    });

    test('recurring allowance accepts a near-future baseline (contract enforces the past bound at execution)', () => {
        const futureSeconds = BigInt(Math.floor(Date.now() / 1000)) + 3600n;
        const tx = module.createRecurringAllowanceMetaTransaction(DELEGATE, TOKEN, 100n, 1440n, futureSeconds);
        const { resetBaseMin } = decodeSetAllowance(tx.data);
        expect(resetBaseMin).toBe(futureSeconds / 60n);
    });

    test.each([
        ['negative', -1n],
        ['uint32 overflow after conversion', 2n ** 32n * 60n],
        ['millisecond timestamp', 1_770_000_000_000n],
    ])('recurring allowance rejects a timestamp whose minutes cannot be a uint32 (%s)', (_label, bad) => {
        expect(() =>
            module.createRecurringAllowanceMetaTransaction(DELEGATE, TOKEN, 100n, 1440n, bad),
        ).toThrow(RangeError);
    });

    test.each([
        ['negative', -1n],
        ['uint16 overflow', 2n ** 16n],
    ])('recurring allowance rejects a validity period outside the uint16 range (%s)', (_label, bad) => {
        expect(() =>
            module.createRecurringAllowanceMetaTransaction(DELEGATE, TOKEN, 100n, bad),
        ).toThrow(RangeError);
    });

    test.each([
        ['negative', -1n],
        ['above 255', 256n],
    ])('getDelegates rejects a maxNumberOfResults outside the uint8 range (%s)', async (_label, bad) => {
        await expect(
            module.getDelegates('http://localhost:1', DELEGATE, { maxNumberOfResults: bad }),
        ).rejects.toThrow(RangeError);
    });
});
