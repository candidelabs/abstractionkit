const { calculateUserOperationErc20TokenCost, calculateUserOperationMaxGasCost } = require('../dist/index.cjs');

function v7UserOp(overrides = {}) {
  return {
    sender: '0x' + '1'.repeat(40),
    nonce: 0n,
    callData: '0x',
    callGasLimit: 100_000n,
    verificationGasLimit: 200_000n,
    preVerificationGas: 50_000n,
    maxFeePerGas: 1_000_000_000n,
    maxPriorityFeePerGas: 100_000_000n,
    signature: '0x',
    factory: null,
    factoryData: null,
    paymaster: '0x' + 'aa'.repeat(20),
    paymasterVerificationGasLimit: 30_000n,
    paymasterPostOpGasLimit: 40_000n,
    paymasterData: '0x',
    ...overrides,
  };
}

function v6UserOp(overrides = {}) {
  return {
    sender: '0x' + '1'.repeat(40),
    nonce: 0n,
    initCode: '0x',
    callData: '0x',
    callGasLimit: 100_000n,
    verificationGasLimit: 200_000n,
    preVerificationGas: 50_000n,
    maxFeePerGas: 1_000_000_000n,
    maxPriorityFeePerGas: 100_000_000n,
    paymasterAndData: '0x' + 'aa'.repeat(20),
    signature: '0x',
    ...overrides,
  };
}

describe('calculateUserOperationErc20TokenCost', () => {
  test('v0.7: exchangeRate * maxGasCost / 1e18', () => {
    const op = v7UserOp();
    const maxGasCost = calculateUserOperationMaxGasCost(op); // 420_000 gas * 1 gwei
    expect(maxGasCost).toBe(420_000n * 1_000_000_000n);
    // USDC at $3000/ETH: 3000 * 1e6 smallest-units per ETH.
    expect(calculateUserOperationErc20TokenCost(op, 3_000_000_000n))
      .toBe((3_000_000_000n * maxGasCost) / 10n ** 18n);
  });

  test('v0.6: uses the paymaster verification multiplier', () => {
    const op = v6UserOp();
    // (100k + 200k * 3 + 50k) * 1 gwei = 7.5e14 wei; at rate 1e18 that is 7.5e14 units.
    expect(calculateUserOperationErc20TokenCost(op, 10n ** 18n)).toBe(750_000n * 1_000_000_000n);
  });

  test('floors to 1 token smallest-unit when the cost rounds to zero', () => {
    const op = v7UserOp({ maxFeePerGas: 1n });
    expect((1n * calculateUserOperationMaxGasCost(op)) / 10n ** 18n).toBe(0n);
    expect(calculateUserOperationErc20TokenCost(op, 1n)).toBe(1n);
  });
});
