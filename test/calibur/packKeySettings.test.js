// Offline tests for Calibur key-settings packing: the on-chain layout is
// (isAdmin << 200) | (uint40 expiration << 160) | (uint160 hook), so an
// oversized expiration must be rejected rather than silently setting the
// isAdmin bit.

const ak = require('../../dist/index.cjs');

const Calibur = ak.Calibur7702Account;

describe('Calibur7702Account.packKeySettings', () => {
    test('packs a valid seconds timestamp without touching the isAdmin bit', () => {
        const expiration = 1786000000n; // seconds, fits in uint40
        const packed = Calibur.packKeySettings({ expiration, isAdmin: false });
        expect((packed >> 160n) & ((1n << 40n) - 1n)).toBe(expiration);
        expect((packed >> 200n) & 1n).toBe(0n);
    });

    test('rejects a milliseconds timestamp instead of leaking into isAdmin', () => {
        const ms = 1786000000000n; // >= 2^40: would set bit 200 (isAdmin)
        expect(() => Calibur.packKeySettings({ expiration: ms })).toThrow(RangeError);
    });

    test('rejects an out-of-range hook value', () => {
        expect(() => Calibur.packKeySettings({ hook: '0x' + 'ff'.repeat(21) })).toThrow(
            RangeError,
        );
    });
});
