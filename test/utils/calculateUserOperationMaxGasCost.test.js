const { calculateUserOperationMaxGasCost } = require('../../dist/index.cjs');

describe('calculateUserOperationMaxGasCost (v0.6)', () => {
  // Minimal v0.6 UserOperation. The presence of `initCode` selects the v0.6 branch.
  const baseV6 = {
    sender: '0x0000000000000000000000000000000000000001',
    nonce: 0n,
    initCode: '0x',
    callData: '0x',
    callGasLimit: 100_000n,
    verificationGasLimit: 500_000n,
    preVerificationGas: 60_000n,
    maxFeePerGas: 10_000_000n,
    maxPriorityFeePerGas: 1_000_000n,
    paymasterAndData: '0x',
    signature: '0x',
  };

  it('includes verificationGasLimit for a self-funded operation (EntryPoint v0.6 mul = 1)', () => {
    // requiredGas = callGasLimit + verificationGasLimit * 1 + preVerificationGas
    //             = 100_000 + 500_000 + 60_000 = 660_000
    // maxCost     = 660_000 * 10_000_000 = 6_600_000_000_000
    expect(calculateUserOperationMaxGasCost(baseV6)).toBe(6_600_000_000_000n);
  });

  it('applies the 3x verification multiplier when a paymaster is set (EntryPoint v0.6 mul = 3)', () => {
    const withPaymaster = { ...baseV6, paymasterAndData: '0x' + '11'.repeat(20) };
    // requiredGas = 100_000 + 500_000 * 3 + 60_000 = 1_660_000
    // maxCost     = 1_660_000 * 10_000_000 = 16_600_000_000_000
    expect(calculateUserOperationMaxGasCost(withPaymaster)).toBe(16_600_000_000_000n);
  });
});
