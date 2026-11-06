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

// executeAllowanceTransfer(safe, token, to, amount, paymentToken, payment, delegate, signature)
describe('AllowanceModule transfer payment overrides', () => {
    const module = new ak.AllowanceModule();
    const SAFE = '0x' + '42'.repeat(20);
    const ZERO = '0x' + '00'.repeat(20);

    function decodeTransfer(overrides) {
        const tx = module.createAllowanceTransferMetaTransaction(SAFE, TOKEN, DELEGATE, 50n, DELEGATE, overrides);
        const [, , , amount, paymentToken, payment] = AbiCoder.defaultAbiCoder().decode(
            ['address', 'address', 'address', 'uint96', 'address', 'uint96', 'address', 'bytes'],
            '0x' + tx.data.slice(10),
        );
        return { amount, paymentToken, payment };
    }

    // The module pays in the native token when paymentToken is the zero
    // address. A paymentAmount without a paymentToken used to be dropped.
    test('paymentAmount on its own is a native-token payment', () => {
        expect(decodeTransfer({ paymentAmount: 123n })).toEqual({ amount: 50n, paymentToken: ZERO, payment: 123n });
    });

    test('paymentToken with paymentAmount is encoded as given', () => {
        expect(decodeTransfer({ paymentToken: TOKEN, paymentAmount: 7n })).toEqual({
            amount: 50n,
            paymentToken: TOKEN,
            payment: 7n,
        });
    });

    test('no payment overrides encode no payment', () => {
        expect(decodeTransfer()).toEqual({ amount: 50n, paymentToken: ZERO, payment: 0n });
    });

    test('paymentToken without paymentAmount and a negative paymentAmount are rejected', () => {
        expect(() => decodeTransfer({ paymentToken: TOKEN })).toThrow(/must specify paymentAmount/);
        expect(() => decodeTransfer({ paymentAmount: -1n })).toThrow(RangeError);
    });
});

describe('legacy AllowanceModule address', () => {
    // The contract at this address reports VERSION() "0.1.1"; the old constant
    // name said v0.1.0. The name is corrected, the value is not changed.
    test('the correctly named constant and the deprecated alias are the same address', () => {
        expect(ak.ALLOWANCE_MODULE_V0_1_1_ADDRESS).toBe('0xAA46724893dedD72658219405185Fb0Fc91e091C');
        expect(ak.ALLOWANCE_MODULE_V0_1_0_ADDRESS).toBe(ak.ALLOWANCE_MODULE_V0_1_1_ADDRESS);
        expect(new ak.AllowanceModule(ak.ALLOWANCE_MODULE_V0_1_1_ADDRESS).moduleAddress).toBe(
            ak.ALLOWANCE_MODULE_V0_1_1_ADDRESS,
        );
    });
});
