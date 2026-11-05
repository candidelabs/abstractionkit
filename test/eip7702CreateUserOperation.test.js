// Regression tests for createUserOperation on the EIP-7702 accounts, which had
// no offline test. Mock transports only.
//
// - Simple7702: `overrides.dummySignature` was put on the returned op but
//   never reached the bundler, which estimated with the class default.
// - Simple7702: the parallelPaymasterInitValues EntryPoint check was
//   case-sensitive and nothing checked the PAYMASTER_SIG_MAGIC suffix.
// - All three classes threw for bad input after RPC calls had started. The
//   caller caught that error; the abandoned request then rejected with nobody
//   listening, which Node reports as an unhandled rejection.

const ak = require('../dist/index.cjs');

const EOA = '0x' + '11'.repeat(20);
const TX = [{ to: '0x' + '22'.repeat(20), value: 0n, data: '0x' }];
const FEES = { maxFeePerGas: 1n, maxPriorityFeePerGas: 1n };
const GAS_RESULT = { callGasLimit: '0x10000', verificationGasLimit: '0x10000', preVerificationGas: '0x10000' };
const CUSTOM_DUMMY = '0x' + 'ab'.repeat(65);
const MAGIC = '22e325a297439656';

const CLASSES = [
    ['Simple7702Account', ak.Simple7702Account],
    ['Simple7702AccountV09', ak.Simple7702AccountV09],
    ['Calibur7702Account', ak.Calibur7702Account],
];

function mockBundler() {
    const captured = [];
    const bundler = new ak.Bundler({
        request: async ({ method, params }) => {
            captured.push({ method, params });
            return GAS_RESULT;
        },
    });
    const estimated = () => captured.find((c) => c.method === 'eth_estimateUserOperationGas').params[0];
    return { bundler, captured, estimated };
}

describe.each(CLASSES)('%s createUserOperation estimation', (_name, Account) => {
    test('the dummySignature override is what the bundler estimates with', async () => {
        const { bundler, estimated } = mockBundler();
        const op = await new Account(EOA).createUserOperation(TX, undefined, bundler, {
            nonce: 0n,
            ...FEES,
            dummySignature: CUSTOM_DUMMY,
        });
        expect(estimated().signature).toBe(CUSTOM_DUMMY);
        expect(op.signature).toBe(CUSTOM_DUMMY);
    });

    test('without the override both carry the same default placeholder', async () => {
        const { bundler, estimated } = mockBundler();
        const op = await new Account(EOA).createUserOperation(TX, undefined, bundler, { nonce: 0n, ...FEES });
        expect(estimated().signature).toBe(op.signature);
        expect(op.signature).not.toBe(CUSTOM_DUMMY);
    });
});

describe.each(CLASSES)('%s createUserOperation rejects bad input before any RPC call', (_name, Account) => {
    let unhandled;
    const onUnhandled = (reason) => unhandled.push(reason);
    beforeEach(() => {
        unhandled = [];
        process.on('unhandledRejection', onUnhandled);
    });
    afterEach(() => {
        process.off('unhandledRejection', onUnhandled);
    });
    // unhandled rejections are reported after the microtask queue drains
    const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

    test('a missing node for the authorization nonce leaves no rejection behind', async () => {
        const { bundler } = mockBundler();
        await expect(
            new Account(EOA).createUserOperation(TX, undefined, bundler, {
                nonce: 0n,
                eip7702Auth: { chainId: 1n },
            }),
        ).rejects.toThrow(/eoaDelegatorNonce/);
        await settle();
        expect(unhandled).toEqual([]);
    });

    test('a negative fee is rejected without touching a failing node', async () => {
        let requests = 0;
        const node = {
            request: async () => {
                requests++;
                throw new Error('node is down');
            },
        };
        for (const bad of [{ maxFeePerGas: -1n }, { maxPriorityFeePerGas: -1n }]) {
            await expect(new Account(EOA).createUserOperation(TX, node, undefined, bad)).rejects.toThrow(RangeError);
        }
        await settle();
        expect(requests).toBe(0);
        expect(unhandled).toEqual([]);
    });

    test('an authorization with an explicit nonce still needs no node', async () => {
        const { bundler } = mockBundler();
        const op = await new Account(EOA).createUserOperation(TX, undefined, bundler, {
            nonce: 0n,
            ...FEES,
            eip7702Auth: { chainId: 1n, nonce: 3n },
        });
        expect(BigInt(op.eip7702Auth.nonce)).toBe(3n);
    });
});

describe('Simple7702 parallelPaymasterInitValues', () => {
    const INIT_VALUES = {
        paymaster: '0x36A337b8b4cE5CF6ca1dDaeef73Da4928d714DF2',
        paymasterVerificationGasLimit: 45_000n,
        paymasterPostOpGasLimit: 45_000n,
        paymasterData: '0x' + '00'.repeat(32) + '0020' + MAGIC,
    };
    const create = (account, parallelPaymasterInitValues) =>
        account.createUserOperation(TX, undefined, mockBundler().bundler, {
            nonce: 0n,
            ...FEES,
            parallelPaymasterInitValues,
        });

    test.each([
        ['checksummed', ak.ENTRYPOINT_V9],
        ['lowercase', ak.ENTRYPOINT_V9.toLowerCase()],
    ])('a %s EntryPoint v0.9 address is accepted', async (_case, entrypointAddress) => {
        const account = new ak.Simple7702AccountV09(EOA, { entrypointAddress });
        const op = await create(account, INIT_VALUES);
        expect(op.paymaster).toBe(INIT_VALUES.paymaster);
        expect(op.paymasterData).toBe(INIT_VALUES.paymasterData);
    });

    test('an uppercase magic suffix is accepted', async () => {
        const upper = { ...INIT_VALUES, paymasterData: INIT_VALUES.paymasterData.toUpperCase().replace('0X', '0x') };
        const op = await create(new ak.Simple7702AccountV09(EOA), upper);
        expect(op.paymasterData).toBe(upper.paymasterData);
    });

    test('paymasterData without the magic suffix is rejected, like on the Safe classes', async () => {
        const bad = { ...INIT_VALUES, paymasterData: '0x' + 'ab'.repeat(42) };
        await expect(create(new ak.Simple7702AccountV09(EOA), bad)).rejects.toThrow(/PAYMASTER_SIG_MAGIC/);
    });

    test('the EntryPoint v0.8 class still refuses them', async () => {
        await expect(create(new ak.Simple7702Account(EOA), INIT_VALUES)).rejects.toThrow(/only works with ep v0\.9/);
    });
});
