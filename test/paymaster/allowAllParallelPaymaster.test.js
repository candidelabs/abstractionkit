// ExperimentalAllowAllParallelPaymaster had no test at all. The contract it
// targets is not deployed on the chains the integration harness forks
// (ethereum, optimism), so this stays offline: it pins the two payloads the
// class emits and the way SafeMultiChainSigAccountV1.createUserOperation
// consumes them through `parallelPaymasterInitValues`, including the two
// guards (magic suffix, EntryPoint v0.9 only).

const ak = require('../../dist/index.cjs');

const OWNER = '0x' + '42'.repeat(20);
const CUSTOM_ADDRESS = '0x' + '77'.repeat(20);
const PAYMASTER_SIG_MAGIC = '22e325a297439656';
// The fixed signature the AllowAll contract accepts, its 2-byte length (0x0020) and the magic.
const APPROVED_PAYMASTER_DATA =
    '0x7603fbcd3c6cebdb7193b716f62fe7e9d4afd859df4bf7fcdb2e9d486f57a1ca' + '0020' + PAYMASTER_SIG_MAGIC;

const GAS_RESULT = {
    callGasLimit: '0x10000',
    verificationGasLimit: '0x10000',
    preVerificationGas: '0x10000',
};

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

async function createOp(Account, overrides) {
    const { bundler, captured } = mockBundler();
    const account = Account.initializeNewAccount([OWNER]);
    const userOperation = await account.createUserOperation([{ to: OWNER, value: 0n, data: '0x' }], undefined, bundler, {
        nonce: 0n,
        maxFeePerGas: 1n,
        maxPriorityFeePerGas: 1n,
        ...overrides,
    });
    const estimated = captured.find((c) => c.method === 'eth_estimateUserOperationGas')?.params[0];
    return { userOperation, estimated };
}

describe('ExperimentalAllowAllParallelPaymaster payloads', () => {
    const paymaster = new ak.ExperimentalAllowAllParallelPaymaster();

    test('defaults to the canonical deployment and accepts an override', () => {
        expect(paymaster.address).toBe('0x36A337b8b4cE5CF6ca1dDaeef73Da4928d714DF2');
        expect(new ak.ExperimentalAllowAllParallelPaymaster(CUSTOM_ADDRESS).address).toBe(CUSTOM_ADDRESS);
    });

    test('init values carry the address, both gas limits and a dummy signature ending in the magic', async () => {
        const init = await paymaster.getPaymasterFieldsInitValues(1n);
        expect(init.paymaster).toBe(paymaster.address);
        expect(init.paymasterVerificationGasLimit).toBe(45_000n);
        expect(init.paymasterPostOpGasLimit).toBe(45_000n);
        expect(init.paymasterData.startsWith('0x')).toBe(true);
        expect(init.paymasterData.toLowerCase().endsWith(PAYMASTER_SIG_MAGIC)).toBe(true);
        // 32-byte dummy signature + 2-byte signature length (0x0020) + 8-byte magic
        expect((init.paymasterData.length - 2) / 2).toBe(32 + 2 + 8);
    });

    test('approved data is the fixed signature the contract accepts, same layout as the dummy', async () => {
        const init = await paymaster.getPaymasterFieldsInitValues(1n);
        const approved = await paymaster.getApprovedPaymasterData({});
        expect(approved.toLowerCase().endsWith(PAYMASTER_SIG_MAGIC)).toBe(true);
        expect(approved.length).toBe(init.paymasterData.length);
        expect(approved).not.toBe(init.paymasterData);
        // the 2-byte length word and the 8-byte magic are identical; only the signature differs
        expect(approved.slice(-20)).toBe(init.paymasterData.slice(-20));
        expect(approved).toBe(APPROVED_PAYMASTER_DATA);
    });
});

describe('parallelPaymasterInitValues on SafeMultiChainSigAccountV1 (EntryPoint v0.9)', () => {
    const paymaster = new ak.ExperimentalAllowAllParallelPaymaster();

    test('the estimation op and the returned op both carry the paymaster fields', async () => {
        const init = await paymaster.getPaymasterFieldsInitValues(1n);
        const { userOperation, estimated } = await createOp(ak.SafeMultiChainSigAccountV1, {
            parallelPaymasterInitValues: init,
        });

        expect(estimated.paymaster.toLowerCase()).toBe(paymaster.address.toLowerCase());
        expect(estimated.paymasterData.toLowerCase()).toBe(init.paymasterData.toLowerCase());
        expect(BigInt(estimated.paymasterVerificationGasLimit)).toBe(45_000n);
        expect(BigInt(estimated.paymasterPostOpGasLimit)).toBe(45_000n);

        expect(userOperation.paymaster).toBe(paymaster.address);
        expect(userOperation.paymasterData).toBe(init.paymasterData);
        expect(userOperation.paymasterVerificationGasLimit).toBe(45_000n);
        expect(userOperation.paymasterPostOpGasLimit).toBe(45_000n);
        expect(userOperation.factory).not.toBeNull();
    });

    test('the approved signature drops into paymasterData without changing its length', async () => {
        const init = await paymaster.getPaymasterFieldsInitValues(1n);
        const { userOperation } = await createOp(ak.SafeMultiChainSigAccountV1, { parallelPaymasterInitValues: init });
        const before = userOperation.paymasterData.length;
        userOperation.paymasterData = await paymaster.getApprovedPaymasterData(userOperation);
        expect(userOperation.paymasterData.length).toBe(before);
        expect(userOperation.paymasterData.toLowerCase().endsWith(PAYMASTER_SIG_MAGIC)).toBe(true);
    });

    test('an uppercase magic suffix is accepted', async () => {
        const init = await paymaster.getPaymasterFieldsInitValues(1n);
        const upper = { ...init, paymasterData: init.paymasterData.toUpperCase().replace('0X', '0x') };
        const { userOperation } = await createOp(ak.SafeMultiChainSigAccountV1, { parallelPaymasterInitValues: upper });
        expect(userOperation.paymasterData).toBe(upper.paymasterData);
    });

    test('paymasterData without the magic suffix is rejected before any RPC call', async () => {
        const init = await paymaster.getPaymasterFieldsInitValues(1n);
        const bad = { ...init, paymasterData: '0x' + 'ab'.repeat(42) };
        await expect(createOp(ak.SafeMultiChainSigAccountV1, { parallelPaymasterInitValues: bad })).rejects.toThrow(
            /PAYMASTER_SIG_MAGIC/,
        );
    });

    test('an EntryPoint v0.7 account refuses parallel paymaster init values', async () => {
        const init = await paymaster.getPaymasterFieldsInitValues(1n);
        await expect(createOp(ak.SafeAccountV0_3_0, { parallelPaymasterInitValues: init })).rejects.toThrow(
            /only works with ep v0\.9/,
        );
    });

    test('without init values the returned op has no paymaster', async () => {
        const { userOperation } = await createOp(ak.SafeMultiChainSigAccountV1, {});
        expect(userOperation.paymaster).toBeNull();
        expect(userOperation.paymasterData).toBeNull();
    });
});
