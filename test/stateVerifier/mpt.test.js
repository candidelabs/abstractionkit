const ak = require('../../dist/index.cjs');

// The internal MPT walker is tested indirectly through verifyAccountProof
// with real fixture data. Variety of node shapes is covered because:
//   - eoa-with-history.json exercises deep branch paths (and leaf)
//   - safe-v141-singleton.json exercises contract leaves
//   - empty-account.json exercises absence-proof paths
// (Storage-proof paths are exercised by proofVerifier.test.js.)

describe('MPT verification via public verifiers', () => {
  test('branch + extension + leaf walks succeed on real fixtures', () => {
    for (const f of [
      require('./fixtures/eoa-with-history.json'),
      require('./fixtures/safe-v141-singleton.json'),
      require('./fixtures/empty-account.json'),
    ]) {
      expect(ak.verifyAccountProof({
        stateRoot: f.block.stateRoot,
        address: f.getProof.address,
        proof: f.getProof,
      })).toBe(true);
    }
  });

  test('walker detects hash tampering (flip a byte in a proof node)', () => {
    const f = require('./fixtures/eoa-with-history.json');
    const tampered = { ...f.getProof };
    tampered.accountProof = [...f.getProof.accountProof];
    // Corrupt the last hex digit of the first node.
    const last = tampered.accountProof[0].slice(-1);
    tampered.accountProof[0] =
      tampered.accountProof[0].slice(0, -1) + (last === '0' ? '1' : '0');
    expect(() => ak.verifyAccountProof({
      stateRoot: f.block.stateRoot,
      address: f.getProof.address,
      proof: tampered,
    })).toThrow(ak.AccountProofInvalidError);
  });
});
