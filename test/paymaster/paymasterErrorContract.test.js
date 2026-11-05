// Regression tests for the errors the paymaster clients throw. Offline: the
// paymaster and the bundler are mock transports.
//
// Erc7677Paymaster.createPaymasterUserOperation returned its two flows
// without `await`, so its catch never saw their rejections: a provider RPC
// error, a null response or a bad override escaped as a raw TransportRpcError,
// TypeError or RangeError instead of the documented PAYMASTER_ERROR.
//
// CandidePaymaster had two contracts for the same failure: the token flow
// wrapped everything as PAYMASTER_ERROR and the sponsor flow, whose doc
// promises PAYMASTER_ERROR, wrapped nothing. Re-wrapping at every layer also
// buried the "token not supported" context three causes deep, and a
// pm_getPaymasterData response without gas limits (all ERC-7677 requires is
// the paymaster and its data) failed on BigInt(undefined).

const ak = require('../../dist/index.cjs');

const PAYMASTER = '0x8b1f6cb5d062aa2ce8d581942bbb960420d875ba';
const TOKEN = '0x' + 'dd'.repeat(20);
const ESTIMATE = { callGasLimit: '0x10000', verificationGasLimit: '0x20000', preVerificationGas: '0x3000' };
const STUB = {
    paymaster: PAYMASTER,
    paymasterData: '0xaa',
    paymasterVerificationGasLimit: '0x8000',
    paymasterPostOpGasLimit: '0xa000',
};
const SUPPORTED = () => ({
    tokens: [{ name: 'T', symbol: 'T', decimals: 6, address: TOKEN, exchangeRate: '0xb2d05e00' }],
    paymasterMetadata: { address: PAYMASTER, dummyPaymasterAndData: { ...STUB, paymasterData: '0xab' } },
});

const userOp = () => ({
    sender: '0x' + '1'.repeat(40),
    nonce: 0n,
    callData: '0x',
    callGasLimit: 0n,
    verificationGasLimit: 0n,
    preVerificationGas: 0n,
    maxFeePerGas: 1_000_000_000n,
    maxPriorityFeePerGas: 1n,
    signature: '0x',
    factory: null,
    factoryData: null,
    paymaster: null,
    paymasterVerificationGasLimit: null,
    paymasterPostOpGasLimit: null,
    paymasterData: null,
});
const account = {
    entrypointAddress: ak.ENTRYPOINT_V7,
    prependTokenPaymasterApproveToCallData: (callData, _token, _paymaster, amount) => `approve(${amount})::${callData}`,
};

function transport(handlers) {
    return {
        request: async ({ method, params }) => {
            if (!(method in handlers)) throw new ak.TransportRpcError(-32601, `no mock for ${method}`);
            return handlers[method](params);
        },
    };
}
const rpcError = (message) => () => {
    throw new ak.TransportRpcError(-32000, message);
};
const failingBundler = {
    request: async () => {
        throw new ak.TransportRpcError(-32500, 'AA23 reverted');
    },
};
const caught = (promise) =>
    promise.then(
        () => {
            throw new Error('expected a rejection');
        },
        (error) => error,
    );

describe('Erc7677Paymaster.createPaymasterUserOperation always throws AbstractionKitError', () => {
    const create = (rpc, options, context = {}, overrides = {}) =>
        caught(
            new ak.Erc7677Paymaster(rpc, { chainId: 1n, ...options }).createPaymasterUserOperation(
                account,
                userOp(),
                rpc,
                context,
                overrides,
            ),
        );

    test.each([
        ['candide, sponsored', 'candide', {}, 'pm_supportedERC20Tokens'],
        ['candide, token', 'candide', { token: TOKEN }, 'pm_supportedERC20Tokens'],
        ['pimlico, token', 'pimlico', { token: TOKEN }, 'pimlico_getTokenQuotes'],
    ])('a provider RPC error (%s)', async (_name, provider, context, method) => {
        const rpc = transport({ [method]: rpcError('invalid api key') });
        const error = await create(rpc, { provider }, context);
        expect(error).toBeInstanceOf(ak.AbstractionKitError);
        expect(error.code).toBe('PAYMASTER_ERROR');
        expect(error.cause).toMatchObject({ code: -32000, message: 'invalid api key' });
    });

    test.each([
        ['a null stub', { pm_getPaymasterStubData: () => null, eth_estimateUserOperationGas: () => ESTIMATE }],
        [
            'a null final response',
            {
                pm_getPaymasterStubData: () => STUB,
                eth_estimateUserOperationGas: () => ESTIMATE,
                pm_getPaymasterData: () => null,
            },
        ],
    ])('%s', async (_name, handlers) => {
        const error = await create(transport(handlers), { provider: null });
        expect(error).toBeInstanceOf(ak.AbstractionKitError);
        expect(error.code).toBe('PAYMASTER_ERROR');
        expect(error.cause).toBeInstanceOf(TypeError);
    });

    test('a negative gas override', async () => {
        const rpc = transport({ pm_getPaymasterStubData: () => STUB, eth_estimateUserOperationGas: () => ESTIMATE });
        const error = await create(rpc, { provider: null }, {}, { callGasLimit: -1n });
        expect(error).toBeInstanceOf(ak.AbstractionKitError);
        expect(error.code).toBe('PAYMASTER_ERROR');
        expect(error.cause).toBeInstanceOf(RangeError);
    });

    test('a PAYMASTER_ERROR from a flow is passed through unchanged', async () => {
        const rpc = transport({ pm_getPaymasterStubData: rpcError('rate limited') });
        const error = await create(rpc, { provider: null });
        expect(error.code).toBe('PAYMASTER_ERROR');
        expect(error.message).toBe('pm_getPaymasterStubData failed');
    });

    test('a bundler failure is reported as PAYMASTER_ERROR and keeps the AA code', async () => {
        const rpc = transport({ pm_getPaymasterStubData: () => STUB });
        const error = await caught(
            new ak.Erc7677Paymaster(rpc, { chainId: 1n, provider: null }).createPaymasterUserOperation(
                account,
                userOp(),
                failingBundler,
            ),
        );
        expect(error).toBeInstanceOf(ak.AbstractionKitError);
        expect(error.code).toBe('PAYMASTER_ERROR');
        expect(error.message).toBe('createPaymasterUserOperation failed');
        expect(error.aaCode).toBe('AA23');
        expect(error.errno).toBe(-32500);
        expect(error.cause.code).toBe('BUNDLER_ERROR');
    });
});

describe('CandidePaymaster error contract', () => {
    const paymasterRpc = (extra = {}) =>
        transport({
            pm_chainId: () => '0x1',
            pm_supportedERC20Tokens: SUPPORTED,
            eth_estimateUserOperationGas: () => ESTIMATE,
            pm_getPaymasterData: () => ({ ...STUB, paymasterData: '0xff' }),
            ...extra,
        });
    const FLOWS = [
        [
            'createSponsorPaymasterUserOperation',
            (pm, bundler, overrides) =>
                pm.createSponsorPaymasterUserOperation(account, userOp(), bundler, undefined, undefined, overrides),
        ],
        [
            'createTokenPaymasterUserOperation',
            (pm, bundler, overrides) =>
                pm.createTokenPaymasterUserOperation(account, userOp(), TOKEN, bundler, undefined, overrides),
        ],
    ];

    test.each(FLOWS)('%s reports a bundler failure as PAYMASTER_ERROR and keeps the AA code', async (name, run) => {
        const error = await caught(run(new ak.CandidePaymaster(paymasterRpc()), failingBundler));
        expect(error).toBeInstanceOf(ak.AbstractionKitError);
        expect(error.code).toBe('PAYMASTER_ERROR');
        expect(error.message).toBe(`${name} failed`);
        expect(error.aaCode).toBe('AA23');
        expect(error.errno).toBe(-32500);
        expect(error.cause.code).toBe('BUNDLER_ERROR');
        expect(error.cause.cause.code).toBe('SIMULATE_VALIDATION');
    });

    test.each(FLOWS)('%s reports a bad override as PAYMASTER_ERROR', async (_name, run) => {
        const rpc = paymasterRpc();
        const error = await caught(run(new ak.CandidePaymaster(rpc), rpc, { callGasLimit: -1n }));
        expect(error).toBeInstanceOf(ak.AbstractionKitError);
        expect(error.code).toBe('PAYMASTER_ERROR');
        expect(error.cause).toBeInstanceOf(RangeError);
    });

    test.each(FLOWS)('%s reports a null pm_getPaymasterData result', async (_name, run) => {
        const rpc = paymasterRpc({ pm_getPaymasterData: () => null });
        const error = await caught(run(new ak.CandidePaymaster(rpc), rpc));
        expect(error.code).toBe('PAYMASTER_ERROR');
        expect(error.message).toBe('pm_getPaymasterData failed');
        expect(error.cause.message).toMatch(/returned no result/);
    });

    test('a sponsorship response without a paymaster is rejected', async () => {
        const rpc = paymasterRpc({ pm_getPaymasterData: () => ({ paymasterData: '0xff' }) });
        const error = await caught(FLOWS[0][1](new ak.CandidePaymaster(rpc), rpc));
        expect(error.code).toBe('PAYMASTER_ERROR');
        expect(error.message).toMatch(/returned no paymaster/);
    });

    test('an unsupported token is reported at the top level, with the supported tokens', async () => {
        const rpc = paymasterRpc();
        const unsupported = '0x' + 'ee'.repeat(20);
        const pm = new ak.CandidePaymaster(rpc);
        const error = await caught(pm.createTokenPaymasterUserOperation(account, userOp(), unsupported, rpc));
        expect(error.code).toBe('PAYMASTER_ERROR');
        expect(error.message).toContain('is not supported by the paymaster');
        expect(error.context.supportedTokens).toEqual([TOKEN]);
        // the same error from the public rate reader
        const direct = await caught(pm.fetchTokenPaymasterExchangeRate(unsupported, ak.ENTRYPOINT_V7));
        expect(direct.context.supportedTokens).toEqual([TOKEN]);
    });
});

describe('CandidePaymaster applies the pm_getPaymasterData result', () => {
    const run = (finalResult) => {
        const rpc = transport({
            pm_chainId: () => '0x1',
            pm_supportedERC20Tokens: SUPPORTED,
            eth_estimateUserOperationGas: () => ESTIMATE,
            pm_getPaymasterData: () => finalResult,
        });
        return new ak.CandidePaymaster(rpc).createSponsorPaymasterUserOperation(account, userOp(), rpc);
    };

    test('a response without gas limits keeps the limits the operation was estimated with', async () => {
        const { userOperation } = await run({ paymaster: PAYMASTER, paymasterData: '0xff' });
        expect(userOperation.paymaster).toBe(PAYMASTER);
        expect(userOperation.paymasterData).toBe('0xff');
        expect(userOperation.paymasterVerificationGasLimit).toBe(0x8000n);
        expect(userOperation.paymasterPostOpGasLimit).toBe(0xa000n);
    });

    test('gas limits in the response replace the estimated ones, zero included', async () => {
        const { userOperation } = await run({
            paymaster: PAYMASTER,
            paymasterData: '0xff',
            paymasterVerificationGasLimit: '0x9000',
            paymasterPostOpGasLimit: '0x0',
        });
        expect(userOperation.paymasterVerificationGasLimit).toBe(0x9000n);
        expect(userOperation.paymasterPostOpGasLimit).toBe(0n);
    });

    test('sponsor metadata is still returned', async () => {
        const { sponsorMetadata } = await run({
            paymaster: PAYMASTER,
            paymasterData: '0xff',
            sponsor: { name: 'Acme', icon: 'https://acme.test/icon.png' },
        });
        expect(sponsorMetadata).toEqual({
            name: 'Acme',
            description: '',
            url: '',
            icons: ['https://acme.test/icon.png'],
        });
    });
});
