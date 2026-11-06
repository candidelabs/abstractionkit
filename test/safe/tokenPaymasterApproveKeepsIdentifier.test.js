// Regression tests: createUserOperation appends the 32-byte on-chain
// identifier after the ABI-encoded callData. The token paymaster flow rewrites
// that callData through prependTokenPaymasterApproveToCallData, which decoded
// the arguments, re-encoded them and returned callData without the identifier,
// so every token-paymaster operation of an identifier-configured Safe lost its
// attribution. Offline.

const ak = require('../../dist/index.cjs');
const { Interface } = require('ethers');

const OWNER = '0x' + '42'.repeat(20);
const ACCOUNT = '0x' + '43'.repeat(20);
const TOKEN = '0x' + 'aa'.repeat(20);
const PAYMASTER = '0x' + 'bb'.repeat(20);
const OVERRIDES = {
    nonce: 5n,
    maxFeePerGas: 1n,
    maxPriorityFeePerGas: 1n,
    callGasLimit: 1n,
    verificationGasLimit: 1n,
    preVerificationGas: 1n,
};
const erc20 = new Interface(['function approve(address spender, uint256 amount)']);
const APPROVE = erc20.encodeFunctionData('approve', [PAYMASTER, 7n]).slice(2);

const CLASSES = [
    ['SafeAccountV0_2_0', ak.SafeAccountV0_2_0],
    ['SafeAccountV0_3_0', ak.SafeAccountV0_3_0],
    ['SafeMultiChainSigAccountV1', ak.SafeMultiChainSigAccountV1],
];
const SHAPES = [
    ['a single transaction', [{ to: OWNER, value: 1n, data: '0x' }]],
    [
        'a batch',
        [
            { to: OWNER, value: 1n, data: '0x' },
            { to: TOKEN, value: 0n, data: '0x1234' },
        ],
    ],
];

describe.each(CLASSES)('%s prependTokenPaymasterApproveToCallData', (_name, Account) => {
    test.each(SHAPES)('keeps the on-chain identifier of %s', async (_shape, transactions) => {
        const account = new Account(ACCOUNT, { onChainIdentifierParams: { project: 'proj' } });
        const op = await account.createUserOperation(transactions, undefined, undefined, OVERRIDES);
        expect(op.callData.endsWith(account.onChainIdentifier)).toBe(true);

        const withApprove = account.prependTokenPaymasterApproveToCallData(op.callData, TOKEN, PAYMASTER, 7n);
        expect(withApprove.endsWith(account.onChainIdentifier)).toBe(true);
        // appended once, not twice
        expect(withApprove.split(account.onChainIdentifier)).toHaveLength(2);
        // and the approve really is in the rewritten call
        expect(withApprove).toContain(APPROVE);
        const [decoded] = Account.decodeAccountCallData(withApprove);
        expect(decoded.to.toLowerCase()).toBe(Account.DEFAULT_MULTISEND_CONTRACT_ADDRESS.toLowerCase());
    });

    test.each(SHAPES)('adds nothing after the call when %s has no identifier', async (_shape, transactions) => {
        const account = new Account(ACCOUNT);
        const op = await account.createUserOperation(transactions, undefined, undefined, OVERRIDES);
        const withApprove = account.prependTokenPaymasterApproveToCallData(op.callData, TOKEN, PAYMASTER, 7n);
        const [decoded, selector] = Account.decodeAccountCallData(withApprove);
        const canonical = Account.createAccountCallData(decoded.to, decoded.value, decoded.data, decoded.operation, {
            safeModuleExecutorFunctionSelector: selector,
        });
        expect(withApprove).toBe(canonical);
    });

    test('the static keeps any trailing bytes', async () => {
        const op = await new Account(ACCOUNT).createUserOperation(SHAPES[0][1], undefined, undefined, OVERRIDES);
        const trailing = 'c0ffee'.repeat(4);
        const withApprove = Account.prependTokenPaymasterApproveToCallDataStatic(
            op.callData + trailing,
            TOKEN,
            PAYMASTER,
            7n,
        );
        expect(withApprove.endsWith(trailing)).toBe(true);
    });
});
