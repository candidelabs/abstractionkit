const ak = require('../../dist/index.cjs');

describe('StateVerifier constructor', () => {
  test('applies defaults', () => {
    const v = new ak.StateVerifier({
      primaryRpc: 'http://primary',
      verificationRpcs: ['http://a', 'http://b', 'http://c'],
    });
    expect(v.primaryRpc).toBe('http://primary');
    expect(v.consensusRpcs).toEqual(['http://primary', 'http://a', 'http://b', 'http://c']);
    expect(v.quorumThreshold).toBe(2);
    expect(v.retries).toBe(3);
    expect(v.syncTolerance).toBe(1);
    expect(v.requestTimeoutMs).toBe(10000);
  });

  test('accepts overrides', () => {
    const v = new ak.StateVerifier({
      primaryRpc: 'http://primary',
      verificationRpcs: ['http://v1', 'http://v2'],
      quorumThreshold: 2,
      retries: 5,
      syncTolerance: 3,
      requestTimeoutMs: 5000,
    });
    expect(v.primaryRpc).toBe('http://primary');
    expect(v.quorumThreshold).toBe(2);
    expect(v.retries).toBe(5);
    expect(v.syncTolerance).toBe(3);
    expect(v.requestTimeoutMs).toBe(5000);
  });

  test('dedupes primary from verificationRpcs in consensus set', () => {
    const v = new ak.StateVerifier({
      primaryRpc: 'http://a',
      verificationRpcs: ['http://a', 'http://b'],
    });
    expect(v.consensusRpcs).toEqual(['http://a', 'http://b']);
  });

  test('throws when primaryRpc is missing', () => {
    expect(() => new ak.StateVerifier({ primaryRpc: '', verificationRpcs: ['http://a'] })).toThrow();
  });

  test('throws when verificationRpcs is empty', () => {
    expect(() => new ak.StateVerifier({ primaryRpc: 'http://p', verificationRpcs: [] })).toThrow();
  });
});

function mockVerifierRpc({ blockFixture, proofFixture, codeFixture }) {
  const original = global.fetch;
  global.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    let result;
    switch (body.method) {
      case 'eth_blockNumber':
        result = blockFixture.block.number;
        break;
      case 'eth_getBlockByNumber':
        result = {
          number: blockFixture.block.number,
          hash: blockFixture.block.hash,
          stateRoot: blockFixture.block.stateRoot,
          parentHash: blockFixture.block.parentHash,
          timestamp: blockFixture.block.timestamp,
        };
        break;
      case 'eth_getProof':
        result = proofFixture;
        break;
      case 'eth_getCode':
        result = codeFixture;
        break;
      default:
        throw new Error(`Unhandled method: ${body.method}`);
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ jsonrpc: '2.0', id: 1, result }),
    };
  };
  return () => { global.fetch = original; };
}

describe('StateVerifier.getVerifiedAccountState', () => {
  test('verifies EOA balance and nonce', async () => {
    const f = require('./fixtures/eoa-with-history.json');
    const restore = mockVerifierRpc({ blockFixture: f, proofFixture: f.getProof });
    try {
      const v = new ak.StateVerifier({ primaryRpc: 'http://primary', verificationRpcs: ['http://a'] });
      const state = await v.getVerifiedAccountState({
        address: f.getProof.address,
        blockNumber: BigInt(f.block.number),
      });
      expect(state.accountExists).toBe(true);
      expect(state.balance).toBeGreaterThan(0n);
      expect(state.stateRoot).toBe(f.block.stateRoot);
    } finally { restore(); }
  });

  test('verifies contract storage slot', async () => {
    const f = require('./fixtures/safe-v141-singleton.json');
    const restore = mockVerifierRpc({ blockFixture: f, proofFixture: f.getProof });
    try {
      const v = new ak.StateVerifier({ primaryRpc: 'http://primary', verificationRpcs: ['http://a'] });
      const state = await v.getVerifiedAccountState({
        address: f.getProof.address,
        slots: [f.getProof.storageProof[0].key],
        blockNumber: BigInt(f.block.number),
      });
      const keyHex = f.getProof.storageProof[0].key.replace(/^0x/, '');
      const normalized = '0x' + keyHex.padStart(64, '0');
      expect(state.storage[normalized]).toBe(f.getProof.storageProof[0].value);
    } finally { restore(); }
  });

  test('handles absence (empty account)', async () => {
    const f = require('./fixtures/empty-account.json');
    const restore = mockVerifierRpc({ blockFixture: f, proofFixture: f.getProof });
    try {
      const v = new ak.StateVerifier({ primaryRpc: 'http://primary', verificationRpcs: ['http://a'] });
      const state = await v.getVerifiedAccountState({
        address: f.getProof.address,
        blockNumber: BigInt(f.block.number),
      });
      expect(state.accountExists).toBe(false);
    } finally { restore(); }
  });

  test('accepts slots as bigint, number, or hex string', async () => {
    const f = require('./fixtures/safe-v141-singleton.json');
    const restore = mockVerifierRpc({ blockFixture: f, proofFixture: f.getProof });
    try {
      const v = new ak.StateVerifier({ primaryRpc: 'http://primary', verificationRpcs: ['http://a'] });
      // All three normalize to the same slot 0x00..00.
      await v.getVerifiedAccountState({
        address: f.getProof.address,
        slots: [0n, 0, '0x0'],
        blockNumber: BigInt(f.block.number),
      });
    } finally { restore(); }
  });
});
