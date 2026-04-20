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
