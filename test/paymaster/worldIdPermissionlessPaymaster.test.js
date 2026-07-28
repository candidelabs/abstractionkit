// Offline tests for WorldIdPermissionlessPaymaster.createPaymasterUserOperation:
// gas limits must be zeroed for a clean re-estimation, with caller-supplied
// values honored as minimums afterward, and the caller's op left unmutated.

const ak = require('../../dist/index.cjs');

const PAYMASTER = '0x' + 'aa'.repeat(20);
const SENDER = '0x' + '42'.repeat(20);
const PROOF = '0x' + '11'.repeat(256);

function makeV7UserOperation(overrides = {}) {
    return {
        sender: SENDER,
        nonce: 0n,
        factory: null,
        factoryData: null,
        callData: '0x',
        callGasLimit: 50n,
        verificationGasLimit: 1_000_000n,
        preVerificationGas: 1n,
        maxFeePerGas: 1n,
        maxPriorityFeePerGas: 1n,
        paymaster: null,
        paymasterVerificationGasLimit: null,
        paymasterPostOpGasLimit: null,
        paymasterData: null,
        signature: '0x',
        ...overrides,
    };
}

describe('WorldIdPermissionlessPaymaster gas estimation', () => {
    let captured;
    let bundler;

    beforeEach(() => {
        captured = [];
        bundler = new ak.Bundler({
            request: async ({ method, params }) => {
                captured.push({ method, params });
                return {
                    callGasLimit: '0x10000',
                    verificationGasLimit: '0x10000',
                    preVerificationGas: '0x10000',
                };
            },
        });
    });

    test('zeroes only preVerificationGas for estimation, passing supplied vgl/cgl through', async () => {
        const paymaster = new ak.WorldIdPermissionlessPaymaster(PAYMASTER);
        await paymaster.createPaymasterUserOperation(
            makeV7UserOperation(),
            bundler,
            1n,
            2n,
            PROOF,
        );
        expect(captured).toHaveLength(1);
        const sentOp = captured[0].params[0];
        // pvg must be re-estimated (paymaster calldata grows it); vgl/cgl are
        // paymaster-independent prior estimates and are passed through so
        // bundlers that skip estimating supplied fields answer faster
        // (the op is hex-serialized before hitting the wire)
        expect(BigInt(sentOp.preVerificationGas)).toBe(0n);
        expect(BigInt(sentOp.verificationGasLimit)).toBe(1_000_000n);
        expect(BigInt(sentOp.callGasLimit)).toBe(50n);
    });

    test('keeps caller-supplied limits as minimums over the estimation', async () => {
        const paymaster = new ak.WorldIdPermissionlessPaymaster(PAYMASTER);
        const original = makeV7UserOperation();
        const sponsored = await paymaster.createPaymasterUserOperation(
            original,
            bundler,
            1n,
            2n,
            PROOF,
        );
        // estimated 0x10000 (65536) beats the supplied pvg/cgl; the supplied
        // verificationGasLimit (1,000,000) beats the estimate and is kept
        expect(sponsored.preVerificationGas).toBe(0x10000n);
        expect(sponsored.callGasLimit).toBe(0x10000n);
        expect(sponsored.verificationGasLimit).toBe(1_000_000n);
        expect(sponsored.paymaster).toBe(PAYMASTER);
        // the caller's op is untouched
        expect(original.preVerificationGas).toBe(1n);
        expect(original.verificationGasLimit).toBe(1_000_000n);
        expect(original.callGasLimit).toBe(50n);
        expect(original.paymaster).toBeNull();
    });
});
