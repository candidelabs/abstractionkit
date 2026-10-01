const {
  SafeAccountV0_2_0,
  SafeAccountV0_3_0,
  SafeMultiChainSigAccountV1,
  createCallData,
  getFunctionSelector,
} = require('../../dist/index.cjs');

const PAYMASTER = '0x' + 'aa'.repeat(20);
const TOKEN = '0x' + 'bb'.repeat(20);
const OTHER_TOKEN = '0x' + 'cc'.repeat(20);
const DAPP = '0x' + 'dd'.repeat(20);
const RECIPIENT = '0x' + 'ee'.repeat(20);

const approveSelector = getFunctionSelector('approve(address,uint256)');
const approveData = (spender, amount) =>
  createCallData(approveSelector, ['address', 'uint256'], [spender, amount]);

function accountCallData(Account, to, value, data) {
  return Account.createAccountCallData(to, value, data, 0);
}

function batchCallData(Account, transactions) {
  // Pack each transaction in the MultiSend layout:
  // operation(1) | to(20) | value(32) | dataLength(32) | data
  const packed = '0x' + transactions.map((tx) => {
    const data = tx.data.slice(2);
    return '00'
      + tx.to.slice(2).toLowerCase()
      + tx.value.toString(16).padStart(64, '0')
      + (data.length / 2).toString(16).padStart(64, '0')
      + data;
  }).join('');
  const multiSend = createCallData('0x8d80ff0a', ['bytes'], [packed]);
  return Account.createAccountCallData(Account.DEFAULT_MULTISEND_CONTRACT_ADDRESS, 0n, multiSend, 1);
}

function v6Op(callData, paymasterAndData = PAYMASTER + '11'.repeat(40)) {
  return {
    sender: '0x' + '1'.repeat(40), nonce: 0n, initCode: '0x', callData,
    callGasLimit: 0n, verificationGasLimit: 0n, preVerificationGas: 0n,
    maxFeePerGas: 0n, maxPriorityFeePerGas: 0n, paymasterAndData, signature: '0x',
  };
}

function v7Op(callData, paymaster = PAYMASTER) {
  return {
    sender: '0x' + '1'.repeat(40), nonce: 0n, callData,
    callGasLimit: 0n, verificationGasLimit: 0n, preVerificationGas: 0n,
    maxFeePerGas: 0n, maxPriorityFeePerGas: 0n, signature: '0x',
    factory: null, factoryData: null, paymaster,
    paymasterVerificationGasLimit: null, paymasterPostOpGasLimit: null, paymasterData: '0x',
  };
}

const lower = (approvals) =>
  approvals.map((a) => ({ token: a.token.toLowerCase(), spender: a.spender.toLowerCase(), amount: a.amount }));

describe('SafeAccount.decodeTokenPaymasterApprovalsStatic', () => {
  test('v0.6: finds the approval prepended to a single call', () => {
    const original = accountCallData(SafeAccountV0_2_0, RECIPIENT, 1n, '0x');
    const callData = SafeAccountV0_2_0.prependTokenPaymasterApproveToCallDataStatic(
      original, TOKEN, PAYMASTER, 12345n,
    );
    expect(lower(SafeAccountV0_2_0.decodeTokenPaymasterApprovalsStatic(v6Op(callData))))
      .toEqual([{ token: TOKEN, spender: PAYMASTER, amount: 12345n }]);
  });

  test('v0.7: finds the approval prepended to an existing MultiSend batch', () => {
    const original = batchCallData(SafeAccountV0_3_0, [
      { to: OTHER_TOKEN, value: 0n, data: approveData(DAPP, 1n) },
      { to: RECIPIENT, value: 0n, data: '0x' },
    ]);
    const callData = SafeAccountV0_3_0.prependTokenPaymasterApproveToCallDataStatic(
      original, TOKEN, PAYMASTER, 777n,
    );
    // The dapp's approve to another spender is not reported.
    expect(lower(SafeAccountV0_3_0.decodeTokenPaymasterApprovalsStatic(v7Op(callData))))
      .toEqual([{ token: TOKEN, spender: PAYMASTER, amount: 777n }]);
  });

  test('v0.9 multichain Safe: inherited, paymaster read from the paymaster field', () => {
    const original = accountCallData(SafeMultiChainSigAccountV1, RECIPIENT, 0n, '0x');
    const callData = SafeMultiChainSigAccountV1.prependTokenPaymasterApproveToCallDataStatic(
      original, TOKEN, PAYMASTER, 4242n,
    );
    const op = {
      ...v7Op(callData),
      eip7702Auth: null,
      // v0.9 parallel-signing layout: paymaster signature slot + magic suffix.
      paymasterData: '0x' + '11'.repeat(20) + '0000' + '22e325a297439656',
    };
    expect(lower(SafeMultiChainSigAccountV1.decodeTokenPaymasterApprovalsStatic(op)))
      .toEqual([{ token: TOKEN, spender: PAYMASTER, amount: 4242n }]);
  });

  test('allowance-reset tokens: reports approve(0) then the real amount, in execution order', () => {
    const original = accountCallData(SafeAccountV0_2_0, RECIPIENT, 0n, '0x');
    let callData = SafeAccountV0_2_0.prependTokenPaymasterApproveToCallDataStatic(original, TOKEN, PAYMASTER, 500n);
    callData = SafeAccountV0_2_0.prependTokenPaymasterApproveToCallDataStatic(callData, TOKEN, PAYMASTER, 0n);
    expect(SafeAccountV0_2_0.decodeTokenPaymasterApprovalsStatic(v6Op(callData)).map((a) => a.amount))
      .toEqual([0n, 500n]);
  });

  test('reports a later, larger approval to the paymaster further down the batch', () => {
    const original = batchCallData(SafeAccountV0_2_0, [
      { to: RECIPIENT, value: 0n, data: '0x' },
      { to: TOKEN, value: 0n, data: approveData(PAYMASTER, 2n ** 256n - 1n) },
    ]);
    const callData = SafeAccountV0_2_0.prependTokenPaymasterApproveToCallDataStatic(original, TOKEN, PAYMASTER, 10n);
    expect(SafeAccountV0_2_0.decodeTokenPaymasterApprovalsStatic(v6Op(callData)).map((a) => a.amount))
      .toEqual([10n, 2n ** 256n - 1n]);
  });

  test('a single non-MultiSend approve call to the paymaster is reported', () => {
    const callData = accountCallData(SafeAccountV0_3_0, TOKEN, 0n, approveData(PAYMASTER, 9n));
    expect(lower(SafeAccountV0_3_0.decodeTokenPaymasterApprovalsStatic(v7Op(callData))))
      .toEqual([{ token: TOKEN, spender: PAYMASTER, amount: 9n }]);
  });

  test('sponsored operation without a paymaster: returns [] even with a dapp approve', () => {
    const callData = accountCallData(SafeAccountV0_2_0, TOKEN, 0n, approveData(DAPP, 5n));
    expect(SafeAccountV0_2_0.decodeTokenPaymasterApprovalsStatic(v6Op(callData, '0x'))).toEqual([]);
    expect(SafeAccountV0_3_0.decodeTokenPaymasterApprovalsStatic(v7Op(callData, null))).toEqual([]);
  });

  test('paymaster set but no approval to it: returns []', () => {
    const callData = accountCallData(SafeAccountV0_2_0, TOKEN, 0n, approveData(DAPP, 5n));
    expect(SafeAccountV0_2_0.decodeTokenPaymasterApprovalsStatic(v6Op(callData))).toEqual([]);
  });

  test('throws when the batch is delegatecalled to a contract other than MultiSend', () => {
    // Same MultiSend-shaped payload, but the Safe would delegatecall an
    // arbitrary contract, which can run anything instead of these approvals.
    const EVIL = '0x' + '66'.repeat(20);
    const legit = batchCallData(SafeAccountV0_2_0, [
      { to: TOKEN, value: 0n, data: approveData(PAYMASTER, 1n) },
    ]);
    const [inner] = SafeAccountV0_2_0.decodeAccountCallData(legit);
    const callData = SafeAccountV0_2_0.createAccountCallData(EVIL, 0n, inner.data, 1);
    expect(() => SafeAccountV0_2_0.decodeTokenPaymasterApprovalsStatic(v6Op(callData)))
      .toThrow(expect.objectContaining({ code: 'BAD_DATA' }));
  });

  test('accepts official Safe MultiSend and MultiSendCallOnly deployments', () => {
    for (const target of [
      '0x9641d764fc13c8B624c04430C7356C1C7C8102e2', // MultiSendCallOnly v1.4.1
      '0x40A2aCCbd92BCA938b02010E17A5b8929b49130D', // MultiSendCallOnly v1.3.0
      '0xA238CBeb142c10Ef7Ad8442C6D1f9E89e07e7761', // MultiSend v1.3.0
      '0x218543288004CD07832472D464648173c77D7eB7', // MultiSend v1.5.0
      '0xA83c336B20401Af773B6219BA5027174338D1836', // MultiSendCallOnly v1.5.0
    ]) {
      const legit = batchCallData(SafeAccountV0_2_0, [{ to: TOKEN, value: 0n, data: approveData(PAYMASTER, 5n) }]);
      const [inner] = SafeAccountV0_2_0.decodeAccountCallData(legit);
      const callData = SafeAccountV0_2_0.createAccountCallData(target, 0n, inner.data, 1);
      expect(SafeAccountV0_2_0.decodeTokenPaymasterApprovalsStatic(v6Op(callData)).map((a) => a.amount)).toEqual([5n]);
    }
  });

  test('accepts a custom MultiSend deployment via overrides', () => {
    const CUSTOM = '0x' + '77'.repeat(20);
    const legit = batchCallData(SafeAccountV0_2_0, [
      { to: TOKEN, value: 0n, data: approveData(PAYMASTER, 3n) },
    ]);
    const [inner] = SafeAccountV0_2_0.decodeAccountCallData(legit);
    const callData = SafeAccountV0_2_0.createAccountCallData(CUSTOM, 0n, inner.data, 1);
    expect(() => SafeAccountV0_2_0.decodeTokenPaymasterApprovalsStatic(v6Op(callData))).toThrow();
    expect(SafeAccountV0_2_0.decodeTokenPaymasterApprovalsStatic(v6Op(callData), { multisendContractAddress: CUSTOM })
      .map((a) => a.amount)).toEqual([3n]);
  });

  test('throws on a single delegatecall that is not a MultiSend batch', () => {
    const callData = SafeAccountV0_2_0.createAccountCallData('0x' + '66'.repeat(20), 0n, approveData(PAYMASTER, 1n), 1);
    expect(() => SafeAccountV0_2_0.decodeTokenPaymasterApprovalsStatic(v6Op(callData)))
      .toThrow(expect.objectContaining({ code: 'BAD_DATA' }));
  });

  test('throws BAD_DATA on callData that is not a Safe executor call', () => {
    expect(() => SafeAccountV0_2_0.decodeTokenPaymasterApprovalsStatic(v6Op('0xdeadbeef')))
      .toThrow(expect.objectContaining({ code: 'BAD_DATA' }));
  });

  test('throws BAD_DATA on a truncated MultiSend payload', () => {
    const multiSend = createCallData('0x8d80ff0a', ['bytes'], ['0x00' + 'bb'.repeat(20)]);
    const callData = SafeAccountV0_2_0.createAccountCallData(
      SafeAccountV0_2_0.DEFAULT_MULTISEND_CONTRACT_ADDRESS, 0n, multiSend, 1,
    );
    expect(() => SafeAccountV0_2_0.decodeTokenPaymasterApprovalsStatic(v6Op(callData)))
      .toThrow(expect.objectContaining({ code: 'BAD_DATA' }));
  });
});

describe('SafeAccount#decodeTokenPaymasterApprovals (account hook)', () => {
  test('instance method matches the static, including overrides', () => {
    const owner = '0x' + '12'.repeat(20);
    const account = SafeAccountV0_2_0.initializeNewAccount([owner]);
    const original = accountCallData(SafeAccountV0_2_0, RECIPIENT, 0n, '0x');
    const callData = SafeAccountV0_2_0.prependTokenPaymasterApproveToCallDataStatic(original, TOKEN, PAYMASTER, 99n);
    const op = v6Op(callData);
    expect(account.decodeTokenPaymasterApprovals(op)).toEqual(SafeAccountV0_2_0.decodeTokenPaymasterApprovalsStatic(op));
    expect(account.decodeTokenPaymasterApprovals(op).map((a) => a.amount)).toEqual([99n]);
  });

  test('inherited by every Safe account class', () => {
    for (const Cls of [SafeAccountV0_2_0, SafeAccountV0_3_0, SafeMultiChainSigAccountV1]) {
      expect(typeof Cls.prototype.decodeTokenPaymasterApprovals).toBe('function');
    }
  });
});
