// Regression tests for what Safe createUserOperation does with the factory
// fields, the nonce and overrides it has to reject. Offline.
//
// - `factory` / `factoryData` overrides (EntryPoint v0.7+) were accepted by the
//   type and ignored, unlike the v0.6 `initCode` override.
// - The factory override was applied after the callData was built, so a
//   passkey account whose deployment was overridden away still carried the
//   passkey setup calls (which revert on a deployed account), and one whose
//   deployment was overridden in did not.
// - A nonce with a non-zero key and sequence 0 was read as "already deployed"
//   and dropped the factory of a counterfactual account.
// - Bad overrides were rejected only after RPC calls had started, leaving a
//   request running that nobody awaited. The other input checks (negative
//   gas limits, a missing bundler, conflicting dummy signer overrides,
//   parallelPaymasterInitValues) ran after the node had answered, wasting
//   the requests.
// - SafeAccountV0_2_0 / V0_3_0 pointed at EntryPoint v0.9 accepted
//   parallelPaymasterInitValues, estimated with them and returned an op
//   without them.

const ak = require('../../dist/index.cjs');

const OWNER = '0x' + '42'.repeat(20);
const ACCOUNT = '0x' + '43'.repeat(20);
const FACTORY = '0x' + 'fa'.repeat(20);
const FACTORY_DATA = '0xdeadbeef';
const TX = [{ to: OWNER, value: 0n, data: '0x' }];
const FEES = { maxFeePerGas: 1n, maxPriorityFeePerGas: 1n };
const GAS = { callGasLimit: 1n, verificationGasLimit: 1n, preVerificationGas: 1n };
const GAS_RESULT = { callGasLimit: '0x10000', verificationGasLimit: '0x10000', preVerificationGas: '0x10000' };

const V7_PLUS = [
    ['SafeAccountV0_3_0', ak.SafeAccountV0_3_0],
    ['SafeMultiChainSigAccountV1', ak.SafeMultiChainSigAccountV1],
    ['SafeMultiChainSigAccountV2', ak.SafeMultiChainSigAccountV2],
];

function mockBundler() {
    const captured = [];
    const bundler = new ak.Bundler({
        request: async ({ method, params }) => {
            captured.push({ method, params });
            return GAS_RESULT;
        },
    });
    return { bundler, captured };
}

// A node that only knows whether the account has code.
function mockNode(code) {
    const calls = [];
    const node = {
        request: async ({ method, params }) => {
            calls.push(method);
            if (method === 'eth_getCode') return code;
            throw new Error(`unexpected ${method} ${JSON.stringify(params)}`);
        },
    };
    return { node, calls };
}

describe.each(V7_PLUS)('%s factory overrides', (_name, Account) => {
    test('factory and factoryData overrides reach the returned op', async () => {
        const op = await new Account(ACCOUNT).createUserOperation(TX, undefined, undefined, {
            nonce: 0n,
            ...FEES,
            ...GAS,
            factory: FACTORY,
            factoryData: FACTORY_DATA,
        });
        expect(op.factory).toBe(FACTORY);
        expect(op.factoryData).toBe(FACTORY_DATA);
    });

    test('the estimation op carries the same factory fields as the returned op', async () => {
        const { bundler, captured } = mockBundler();
        const op = await new Account(ACCOUNT).createUserOperation(TX, undefined, bundler, {
            nonce: 0n,
            ...FEES,
            factory: FACTORY,
            factoryData: FACTORY_DATA,
        });
        const estimated = captured.find((c) => c.method === 'eth_estimateUserOperationGas').params[0];
        expect(estimated.factory).toBe(FACTORY);
        expect(estimated.factoryData).toBe(FACTORY_DATA);
        expect(op.factory).toBe(FACTORY);
    });

    test('an override replaces the factory data of an initialized account', async () => {
        const account = Account.initializeNewAccount([OWNER]);
        const op = await account.createUserOperation(TX, undefined, undefined, {
            nonce: 0n,
            ...FEES,
            ...GAS,
            factoryData: FACTORY_DATA,
        });
        expect(op.factory).toBe(account.factoryAddress);
        expect(op.factoryData).toBe(FACTORY_DATA);
    });

    test('without overrides the derived factory fields are unchanged', async () => {
        const account = Account.initializeNewAccount([OWNER]);
        const first = await account.createUserOperation(TX, undefined, undefined, { nonce: 0n, ...FEES, ...GAS });
        expect(first.factory).toBe(account.factoryAddress);
        expect(first.factoryData).toBe(account.factoryData);
        const later = await account.createUserOperation(TX, undefined, undefined, { nonce: 3n, ...FEES, ...GAS });
        expect(later.factory).toBeNull();
        expect(later.factoryData).toBeNull();
    });
});

describe('deployment overrides decide whether a passkey account gets its setup calls', () => {
    const PASSKEY = { x: 1234567890n, y: 9876543210n };
    const callDataFor = async (account, overrides) =>
        (await account.createUserOperation(TX, undefined, undefined, { ...FEES, ...GAS, ...overrides })).callData;

    test.each(V7_PLUS)('%s: factory overridden away drops the setup calls', async (_name, Account) => {
        const account = Account.initializeNewAccount([PASSKEY]);
        const deployed = await callDataFor(account, { nonce: 5n });
        const op = await account.createUserOperation(TX, undefined, undefined, {
            nonce: 0n,
            ...FEES,
            ...GAS,
            factory: null,
        });
        expect(op.callData).toBe(deployed);
        expect(op.factory).toBeNull();
    });

    test.each(V7_PLUS)('%s: factory overridden in adds the setup calls', async (_name, Account) => {
        const account = Account.initializeNewAccount([PASSKEY]);
        const firstOperation = await callDataFor(account, { nonce: 0n });
        const op = await account.createUserOperation(TX, undefined, undefined, {
            nonce: 5n,
            ...FEES,
            ...GAS,
            factory: account.factoryAddress,
        });
        expect(op.callData).toBe(firstOperation);
        expect(op.factory).toBe(account.factoryAddress);
        expect(op.factoryData).toBe(account.factoryData);
    });

    test('SafeAccountV0_2_0: initCode "0x" drops the setup calls', async () => {
        const account = ak.SafeAccountV0_2_0.initializeNewAccount([PASSKEY]);
        const deployed = await callDataFor(account, { nonce: 5n });
        const op = await account.createUserOperation(TX, undefined, undefined, {
            nonce: 0n,
            ...FEES,
            ...GAS,
            initCode: '0x',
        });
        expect(op.callData).toBe(deployed);
        expect(op.initCode).toBe('0x');
    });

    test('SafeAccountV0_2_0: an initCode override adds the setup calls', async () => {
        const account = ak.SafeAccountV0_2_0.initializeNewAccount([PASSKEY]);
        const firstOperation = await callDataFor(account, { nonce: 0n });
        const initCode = account.factoryAddress + account.factoryData.slice(2);
        const op = await account.createUserOperation(TX, undefined, undefined, {
            nonce: 5n,
            ...FEES,
            ...GAS,
            initCode,
        });
        expect(op.callData).toBe(firstOperation);
        expect(op.initCode).toBe(initCode);
    });

    test.each(V7_PLUS)('%s: an override skips the deployment lookup', async (_name, Account) => {
        const account = Account.initializeNewAccount([OWNER]);
        const { node, calls } = mockNode('0x');
        await account.createUserOperation(TX, node, undefined, {
            nonce: 1n << 64n,
            ...FEES,
            ...GAS,
            factory: account.factoryAddress,
        });
        expect(calls).toEqual([]);
    });
});

describe.each(V7_PLUS)('%s nonce with a non-zero key', (_name, Account) => {
    const KEYED_NONCE = 1n << 64n; // key 1, sequence 0

    test('sequence 0 keeps the factory when the node reports no code', async () => {
        const account = Account.initializeNewAccount([OWNER]);
        const { node, calls } = mockNode('0x');
        const op = await account.createUserOperation(TX, node, undefined, { nonce: KEYED_NONCE, ...FEES, ...GAS });
        expect(calls).toEqual(['eth_getCode']);
        expect(op.factory).toBe(account.factoryAddress);
        expect(op.factoryData).toBe(account.factoryData);
    });

    test('sequence 0 drops the factory when the account already has code', async () => {
        const account = Account.initializeNewAccount([OWNER]);
        const { node } = mockNode('0x6080');
        const op = await account.createUserOperation(TX, node, undefined, { nonce: KEYED_NONCE, ...FEES, ...GAS });
        expect(op.factory).toBeNull();
        expect(op.factoryData).toBeNull();
    });

    test('a non-zero sequence drops the factory without asking the node', async () => {
        const account = Account.initializeNewAccount([OWNER]);
        const { node, calls } = mockNode('0x');
        const op = await account.createUserOperation(TX, node, undefined, {
            nonce: KEYED_NONCE | 1n,
            ...FEES,
            ...GAS,
        });
        expect(calls).toEqual([]);
        expect(op.factory).toBeNull();
    });

    test('without a node a non-zero nonce still means deployed', async () => {
        const account = Account.initializeNewAccount([OWNER]);
        const op = await account.createUserOperation(TX, undefined, undefined, {
            nonce: KEYED_NONCE,
            ...FEES,
            ...GAS,
        });
        expect(op.factory).toBeNull();
    });

    test('an attached account never asks the node', async () => {
        const { node, calls } = mockNode('0x');
        await new Account(ACCOUNT).createUserOperation(TX, node, undefined, { nonce: KEYED_NONCE, ...FEES, ...GAS });
        expect(calls).toEqual([]);
    });
});

describe('overrides are validated before any RPC call starts', () => {
    const ALL = [['SafeAccountV0_2_0', ak.SafeAccountV0_2_0], ...V7_PLUS];

    test.each(ALL)('%s rejects a negative fee without touching the node', async (_name, Account) => {
        let requests = 0;
        const node = {
            request: async () => {
                requests++;
                throw new Error('node is down');
            },
        };
        for (const bad of [{ maxFeePerGas: -1n }, { maxPriorityFeePerGas: -1n }]) {
            await expect(new Account(ACCOUNT).createUserOperation(TX, node, undefined, bad)).rejects.toThrow(
                RangeError,
            );
        }
        expect(requests).toBe(0);
    });

    const PAIR = { signer: OWNER, signature: '0x' + '00'.repeat(65) };
    test.each(ALL.flatMap(([name, Account]) => [
        [name, 'a negative preVerificationGas', Account, { preVerificationGas: -1n }, RangeError],
        [name, 'a negative verificationGasLimit', Account, { verificationGasLimit: -1n }, RangeError],
        [name, 'a negative callGasLimit', Account, { callGasLimit: -1n }, RangeError],
        [name, 'a missing bundler', Account, {}, /bundlerRpc can't be null/],
        [name, 'an empty dummySignerSignaturePairs', Account, { dummySignerSignaturePairs: [] }, RangeError],
        [
            name,
            'both dummy signer overrides',
            Account,
            { dummySignerSignaturePairs: [PAIR], expectedSigners: [OWNER] },
            /Can't use both/,
        ],
    ]))('%s rejects %s without touching the node', async (_name, _case, Account, overrides, error) => {
        let requests = 0;
        const node = {
            request: async () => {
                requests++;
                return '0x1';
            },
        };
        await expect(new Account(ACCOUNT).createUserOperation(TX, node, undefined, overrides)).rejects.toThrow(error);
        expect(requests).toBe(0);
    });
});

describe('parallelPaymasterInitValues on the classes that cannot return paymaster fields', () => {
    const INIT_VALUES = {
        paymaster: '0x36A337b8b4cE5CF6ca1dDaeef73Da4928d714DF2',
        paymasterVerificationGasLimit: 45_000n,
        paymasterPostOpGasLimit: 45_000n,
        paymasterData: '0x' + '00'.repeat(32) + '0020' + '22e325a297439656',
    };

    test.each([
        ['SafeAccountV0_2_0', ak.SafeAccountV0_2_0],
        ['SafeAccountV0_3_0', ak.SafeAccountV0_3_0],
    ])('%s rejects them even when pointed at EntryPoint v0.9', async (_name, Account) => {
        const { bundler, captured } = mockBundler();
        const account = Account.initializeNewAccount([OWNER], { entrypointAddress: ak.ENTRYPOINT_V9 });
        await expect(
            account.createUserOperation(TX, undefined, bundler, {
                nonce: 0n,
                ...FEES,
                parallelPaymasterInitValues: INIT_VALUES,
            }),
        ).rejects.toThrow(/only works with ep v0\.9/);
        expect(captured).toEqual([]);
    });
});
