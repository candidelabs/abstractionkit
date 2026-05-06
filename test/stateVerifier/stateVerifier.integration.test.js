const ak = require('../../dist/index.cjs');
require('dotenv').config();

const shouldRun = process.env.RUN_STATE_VERIFIER_INTEGRATION === '1';
const describeOrSkip = shouldRun ? describe : describe.skip;

describeOrSkip('StateVerifier integration (real RPC)', () => {
  let primaryRpc;
  let verificationRpcs;
  let verifier;

  if (shouldRun) {
    primaryRpc = process.env.JSON_RPC_NODE_PROVIDER;
    verificationRpcs = [
      process.env.VERIFICATION_RPC_1,
      process.env.VERIFICATION_RPC_2,
      process.env.VERIFICATION_RPC_3,
    ].filter(Boolean);

    if (!primaryRpc || verificationRpcs.length < 2) {
      throw new Error(
        'Set JSON_RPC_NODE_PROVIDER and VERIFICATION_RPC_1..3 to run integration tests',
      );
    }

    verifier = new ak.StateVerifier({ primaryRpc, verificationRpcs });
  }

  test('verifies Vitalik balance at latest', async () => {
    const bal = await verifier.getVerifiedBalance({
      address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    });
    expect(bal).toBeGreaterThan(0n);
  }, 60_000);

  test('verifies USDC balance slot', async () => {
    const { keccak256, AbiCoder } = require('ethers');
    const slot = keccak256(
      AbiCoder.defaultAbiCoder().encode(
        ['address', 'uint256'],
        ['0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', 9n],
      ),
    );
    const val = await verifier.getVerifiedStorageSlot({
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      slot,
    });
    expect(val).toMatch(/^0x[0-9a-f]*$/);
  }, 60_000);

  test('verifies Safe 1.4.1 singleton code', async () => {
    const { code, codeHash } = await verifier.getVerifiedCode({
      address: '0x41675C099F32341bf84BFc5382aF534df5C7461a',
    });
    expect(code).not.toBe('0x');
    expect(codeHash).toMatch(/^0x[0-9a-f]{64}$/);
  }, 60_000);

  test('batch verifies multiple accounts at one block', async () => {
    const states = await verifier.getVerifiedAccountStates([
      { address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' },
      { address: '0x41675C099F32341bf84BFc5382aF534df5C7461a' },
      { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
    ]);
    expect(states).toHaveLength(3);
    const blockNums = states.map((s) => s.blockNumber);
    expect(new Set(blockNums).size).toBe(1);
  }, 90_000);
});
