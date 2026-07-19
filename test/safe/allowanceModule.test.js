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

    test('recurring allowance encodes the validity period and past baseline', () => {
        const baseline = BigInt(Math.floor(Date.now() / 60_000)) - 60n;
        const tx = module.createRecurringAllowanceMetaTransaction(
            DELEGATE,
            TOKEN,
            100n,
            1440n,
            baseline,
        );
        const { resetTimeMin, resetBaseMin } = decodeSetAllowance(tx.data);
        expect(resetTimeMin).toBe(1440n);
        expect(resetBaseMin).toBe(baseline);
    });

    test('recurring allowance rejects a future baseline (reverts on-chain)', () => {
        const future = BigInt(Math.floor(Date.now() / 60_000)) + 60n;
        expect(() =>
            module.createRecurringAllowanceMetaTransaction(DELEGATE, TOKEN, 100n, 1440n, future),
        ).toThrow(RangeError);
    });
});
