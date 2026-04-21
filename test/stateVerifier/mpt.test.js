const ak = require('../../dist/index.cjs');

// The internal MPT walker is tested indirectly through verifyAccountProof
// with real fixture data. Variety of node shapes is covered because:
//   - eoa-with-history.json exercises deep branch paths (and leaf)
//   - safe-v141-singleton.json exercises contract leaves
//   - empty-account.json exercises absence-proof paths
// (Storage-proof paths are exercised by proofVerifier.test.js.)

describe('MPT edge cases', () => {
  test('empty proof against the empty-trie root verifies as absent', () => {
    // keccak256(RLP("")) is the canonical empty-trie root.
    const EMPTY_TRIE_ROOT = '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421';
    // Craft a synthetic proof using the public verifyStorageProof entry point:
    // an EOA has an empty storage trie; an empty proof for any slot against
    // that root should verify as absent (value "0x").
    expect(ak.verifyStorageProof({
      storageHash: EMPTY_TRIE_ROOT,
      storageKey: '0x01',
      storageValue: '0x',
      storageProof: [],
    })).toBe(true);
  });

  test('empty proof against a non-empty root is rejected', () => {
    // Any storage hash that's not the empty-trie sentinel must NOT accept
    // an empty proof as valid.
    expect(() => ak.verifyStorageProof({
      storageHash: '0x' + 'ab'.repeat(32),
      storageKey: '0x01',
      storageValue: '0x',
      storageProof: [],
    })).toThrow(ak.StorageProofInvalidError);
  });
});

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
