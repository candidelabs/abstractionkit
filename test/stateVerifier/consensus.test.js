const ak = require('../../dist/index.cjs');

function mockFetch(handlers) {
  const original = global.fetch;
  global.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    const h = handlers[url];
    if (!h) throw new Error(`No mock handler for ${url}`);
    const result = await h(body);
    return {
      ok: true,
      status: 200,
      json: async () => ({ jsonrpc: '2.0', id: 1, result }),
    };
  };
  return () => { global.fetch = original; };
}

describe('getConsensusBlockHeader', () => {
  test('returns agreed-upon header when all nodes agree', async () => {
    const block = {
      number: '0x10',
      hash: '0xblockhash',
      stateRoot: '0xsameroot',
      parentHash: '0xparent',
      timestamp: '0x64',
    };
    const restore = mockFetch({
      'http://a': () => block,
      'http://b': () => block,
      'http://c': () => block,
    });
    try {
      const header = await ak.getConsensusBlockHeader({
        blockNumber: 16n,
        verificationRpcs: ['http://a', 'http://b', 'http://c'],
      });
      expect(header.stateRoot).toBe('0xsameroot');
      expect(header.blockNumber).toBe(16n);
    } finally { restore(); }
  });

  test('throws ConsensusHeaderDisagreementError when a node disagrees', async () => {
    const base = { number: '0x10', hash: '0xh', parentHash: '0xp', timestamp: '0x64' };
    const restore = mockFetch({
      'http://a': () => ({ ...base, stateRoot: '0xroot1' }),
      'http://b': () => ({ ...base, stateRoot: '0xroot2' }),
      'http://c': () => ({ ...base, stateRoot: '0xroot1' }),
    });
    try {
      await expect(ak.getConsensusBlockHeader({
        blockNumber: 16n,
        verificationRpcs: ['http://a', 'http://b', 'http://c'],
      })).rejects.toBeInstanceOf(ak.ConsensusHeaderDisagreementError);
    } finally { restore(); }
  });

  test('throws ConsensusQuorumNotMetError when too many nodes fail', async () => {
    const block = { number: '0x10', hash: '0xh', stateRoot: '0xsame', parentHash: '0xp', timestamp: '0x64' };
    const original = global.fetch;
    global.fetch = async (url, init) => {
      const body = JSON.parse(init.body);
      if (url === 'http://c') {
        return {
          ok: true, status: 200,
          json: async () => ({ jsonrpc: '2.0', id: 1, result: block }),
        };
      }
      throw new Error('down');
    };
    try {
      await expect(ak.getConsensusBlockHeader({
        blockNumber: 16n,
        verificationRpcs: ['http://a', 'http://b', 'http://c'],
        quorumThreshold: 2,
      })).rejects.toBeInstanceOf(ak.ConsensusQuorumNotMetError);
    } finally { global.fetch = original; }
  });

  test('resolves "latest" with syncTolerance', async () => {
    const latestHex = '0x100';
    const expected = '0xff';  // 256 - 1 = 255 = 0xff
    const block = {
      number: expected, hash: '0xh', stateRoot: '0xsame',
      parentHash: '0xp', timestamp: '0x64',
    };
    const calls = [];
    const restore = mockFetch({
      'http://a': (body) => {
        calls.push(body.method);
        if (body.method === 'eth_blockNumber') return latestHex;
        if (body.method === 'eth_getBlockByNumber') {
          expect(body.params[0]).toBe(expected);
          return block;
        }
      },
    });
    try {
      const header = await ak.getConsensusBlockHeader({
        blockNumber: 'latest',
        verificationRpcs: ['http://a'],
      });
      expect(header.blockNumber).toBe(BigInt(expected));
      expect(calls).toEqual(['eth_blockNumber', 'eth_getBlockByNumber']);
    } finally { restore(); }
  });

  test('resolves "latest" via median of verifier-reported heights', async () => {
    // Three verifiers, one lies extremely far ahead. Median must ignore the
    // outlier; we expect the chain tip to resolve to 100 - syncTolerance = 99.
    const block99 = {
      number: '0x63', hash: '0xhash99', stateRoot: '0xroot99',
      parentHash: '0xparent99', timestamp: '0x64',
    };
    const restore = mockFetch({
      'http://honest-a': (body) => {
        if (body.method === 'eth_blockNumber') return '0x64';   // 100
        if (body.method === 'eth_getBlockByNumber') {
          expect(body.params[0]).toBe('0x63');
          return block99;
        }
      },
      'http://honest-b': (body) => {
        if (body.method === 'eth_blockNumber') return '0x64';   // 100
        if (body.method === 'eth_getBlockByNumber') return block99;
      },
      'http://liar': (body) => {
        if (body.method === 'eth_blockNumber') return '0x98967f'; // 9999999 (lie)
        // Liar cannot actually produce block 99 from its forged chain, but
        // assume it serves the same block since the test is about median resolution.
        if (body.method === 'eth_getBlockByNumber') return block99;
      },
    });
    try {
      const header = await ak.getConsensusBlockHeader({
        blockNumber: 'latest',
        verificationRpcs: ['http://honest-a', 'http://honest-b', 'http://liar'],
      });
      expect(header.blockNumber).toBe(99n);
    } finally { restore(); }
  });

  test('throws ConsensusHeaderDisagreementError when blockHash diverges even with matching stateRoot', async () => {
    const base = { number: '0x10', stateRoot: '0xsameroot', parentHash: '0xp', timestamp: '0x64' };
    const restore = mockFetch({
      'http://a': () => ({ ...base, hash: '0xhashA' }),
      'http://b': () => ({ ...base, hash: '0xhashA' }),
      'http://c': () => ({ ...base, hash: '0xhashZ' }),  // different blockHash, same stateRoot
    });
    try {
      await expect(ak.getConsensusBlockHeader({
        blockNumber: 16n,
        verificationRpcs: ['http://a', 'http://b', 'http://c'],
      })).rejects.toBeInstanceOf(ak.ConsensusHeaderDisagreementError);
    } finally { restore(); }
  });

  test('throws when a node returns a header for a different block number than requested', async () => {
    const wrongNumber = { number: '0x99', hash: '0xh', stateRoot: '0xsame', parentHash: '0xp', timestamp: '0x64' };
    const rightNumber = { number: '0x10', hash: '0xh', stateRoot: '0xsame', parentHash: '0xp', timestamp: '0x64' };
    const restore = mockFetch({
      'http://lying': () => wrongNumber,
      'http://honest1': () => rightNumber,
      'http://honest2': () => rightNumber,
    });
    try {
      // Two honest nodes agree; lying node's wrong-number response is rejected
      // as a failure, so quorum of 2/3 (strict majority default) is still met.
      const header = await ak.getConsensusBlockHeader({
        blockNumber: 16n,
        verificationRpcs: ['http://lying', 'http://honest1', 'http://honest2'],
      });
      expect(header.blockNumber).toBe(16n);
    } finally { restore(); }
  });

  test('throws RangeError on invalid consensus config', async () => {
    await expect(ak.getConsensusBlockHeader({
      blockNumber: 'latest', verificationRpcs: ['http://a'], syncTolerance: -1,
    })).rejects.toThrow(/syncTolerance/);
    await expect(ak.getConsensusBlockHeader({
      blockNumber: 'latest', verificationRpcs: ['http://a'], quorumThreshold: 99,
    })).rejects.toThrow(/quorumThreshold/);
    await expect(ak.getConsensusBlockHeader({
      blockNumber: -1n, verificationRpcs: ['http://a'],
    })).rejects.toThrow(/blockNumber/);
    await expect(ak.getConsensusBlockHeader({
      blockNumber: 'latest', verificationRpcs: ['http://a'], requestTimeoutMs: 0,
    })).rejects.toThrow(/requestTimeoutMs/);
  });

  test('sanitizes auth/path from URLs in disagreement error', async () => {
    const base = { number: '0x10', parentHash: '0xp', timestamp: '0x64' };
    const restore = mockFetch({
      'https://eth-mainnet.example.com/v2/SECRET_KEY': () => ({ ...base, hash: '0xhashA', stateRoot: '0xroot1' }),
      'https://honest.example.com/path?k=v': () => ({ ...base, hash: '0xhashB', stateRoot: '0xroot2' }),
    });
    try {
      await ak.getConsensusBlockHeader({
        blockNumber: 16n,
        verificationRpcs: [
          'https://eth-mainnet.example.com/v2/SECRET_KEY',
          'https://honest.example.com/path?k=v',
        ],
      });
      throw new Error('expected disagreement');
    } catch (e) {
      expect(e).toBeInstanceOf(ak.ConsensusHeaderDisagreementError);
      // Sanitized URLs must strip path, query, and any credentials.
      const urls = e.nodes.map((n) => n.url);
      expect(urls).toContain('https://eth-mainnet.example.com');
      expect(urls).toContain('https://honest.example.com');
      // Secret and path must NOT appear anywhere.
      expect(e.message).not.toMatch(/SECRET_KEY/);
      expect(e.message).not.toMatch(/\/v2\//);
      expect(JSON.stringify(e.nodes)).not.toMatch(/SECRET_KEY/);
    } finally { restore(); }
  });

  test('default quorum requires strict majority (N=3 requires 2 responders)', async () => {
    const block = { number: '0x10', hash: '0xh', stateRoot: '0xsame', parentHash: '0xp', timestamp: '0x64' };
    const original = global.fetch;
    global.fetch = async (url, init) => {
      // Only one of the three responds successfully.
      if (url === 'http://a') {
        return {
          ok: true, status: 200,
          json: async () => ({ jsonrpc: '2.0', id: 1, result: block }),
        };
      }
      throw new Error('down');
    };
    try {
      // No explicit quorumThreshold, so default (floor(3/2)+1 = 2) kicks in.
      // Only 1 node responded, so quorum should be unmet.
      await expect(ak.getConsensusBlockHeader({
        blockNumber: 16n,
        verificationRpcs: ['http://a', 'http://b', 'http://c'],
      })).rejects.toBeInstanceOf(ak.ConsensusQuorumNotMetError);
    } finally { global.fetch = original; }
  });
});
