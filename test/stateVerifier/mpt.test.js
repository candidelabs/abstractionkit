const ak = require('../../dist/index.cjs');

describe('Nibbles', () => {
  test('fromBytes splits each byte into two nibbles', () => {
    const bytes = new Uint8Array([0xab, 0xcd, 0x01]);
    expect(ak.__testNibbles.fromBytes(bytes)).toEqual([0xa, 0xb, 0xc, 0xd, 0x0, 0x1]);
  });

  test('fromBytes on empty', () => {
    expect(ak.__testNibbles.fromBytes(new Uint8Array(0))).toEqual([]);
  });

  test('match returns true on exact prefix match', () => {
    expect(ak.__testNibbles.match([1, 2, 3, 4], 1, [2, 3])).toBe(true);
  });

  test('match returns false on mismatch', () => {
    expect(ak.__testNibbles.match([1, 2, 3, 4], 1, [2, 9])).toBe(false);
  });

  test('match returns false when path runs past key', () => {
    expect(ak.__testNibbles.match([1, 2], 1, [2, 3])).toBe(false);
  });
});

describe('PathEncoder', () => {
  test('decodes even-length extension (prefix 0x00)', () => {
    const encoded = new Uint8Array([0x00, 0x12, 0x34]);
    expect(ak.__testPathEncoder.decode(encoded)).toEqual([1, 2, 3, 4]);
  });

  test('decodes odd-length extension (prefix 0x1_)', () => {
    const encoded = new Uint8Array([0x1a, 0xbc]);
    expect(ak.__testPathEncoder.decode(encoded)).toEqual([0xa, 0xb, 0xc]);
  });

  test('decodes even-length leaf (prefix 0x20)', () => {
    const encoded = new Uint8Array([0x20, 0x12, 0x34]);
    expect(ak.__testPathEncoder.decode(encoded)).toEqual([1, 2, 3, 4]);
  });

  test('decodes odd-length leaf (prefix 0x3_)', () => {
    const encoded = new Uint8Array([0x3a, 0xbc]);
    expect(ak.__testPathEncoder.decode(encoded)).toEqual([0xa, 0xb, 0xc]);
  });

  test('isLeaf true for 0x2_ and 0x3_', () => {
    expect(ak.__testPathEncoder.isLeaf(new Uint8Array([0x20]))).toBe(true);
    expect(ak.__testPathEncoder.isLeaf(new Uint8Array([0x3a]))).toBe(true);
  });

  test('isLeaf false for 0x0_ and 0x1_', () => {
    expect(ak.__testPathEncoder.isLeaf(new Uint8Array([0x00]))).toBe(false);
    expect(ak.__testPathEncoder.isLeaf(new Uint8Array([0x1a]))).toBe(false);
  });
});

describe('parseMptNode', () => {
  test('parses a leaf node from a real fixture', () => {
    const fixture = require('./fixtures/eoa-with-history.json');
    const proof = fixture.getProof.accountProof;
    const lastRlpHex = proof[proof.length - 1];
    const lastRlp = Uint8Array.from(Buffer.from(lastRlpHex.slice(2), 'hex'));
    const node = ak.__testParseMptNode(lastRlp);
    expect(node.kind).toBe('leaf');
  });

  test('parses branch or extension at the root of a real proof', () => {
    const fixture = require('./fixtures/eoa-with-history.json');
    const proof = fixture.getProof.accountProof;
    const firstRlpHex = proof[0];
    const firstRlp = Uint8Array.from(Buffer.from(firstRlpHex.slice(2), 'hex'));
    const node = ak.__testParseMptNode(firstRlp);
    expect(['branch', 'extension']).toContain(node.kind);
    if (node.kind === 'branch') {
      expect(node.children).toHaveLength(16);
    }
  });

  test('throws on invalid node length', () => {
    const { encodeRlp } = require('ethers');
    const badRlpHex = encodeRlp(['0x01']);
    const badRlp = Uint8Array.from(Buffer.from(badRlpHex.slice(2), 'hex'));
    expect(() => ak.__testParseMptNode(badRlp)).toThrow(/Invalid MPT node length/);
  });
});

describe('verifyMptProof via fixtures (internal)', () => {
  const { encodeRlp } = require('ethers');

  function hexBytes(hex) {
    return Uint8Array.from(Buffer.from(hex.replace(/^0x/, ''), 'hex'));
  }

  function stripLeadingZeros(hex) {
    let h = hex.replace(/^0x/, '').replace(/^0+/, '');
    if (h.length === 0) return '0x';
    if (h.length % 2 !== 0) h = '0' + h;
    return '0x' + h;
  }

  test('verifies a valid account proof for an EOA with history', () => {
    const fixture = require('./fixtures/eoa-with-history.json');
    const p = fixture.getProof;
    const stateRoot = hexBytes(fixture.block.stateRoot);
    const address = hexBytes(p.address);
    // Account RLP = [nonce, balance, storageHash, codeHash]
    const accountRlp = encodeRlp([
      stripLeadingZeros(p.nonce),
      stripLeadingZeros(p.balance),
      p.storageHash,
      p.codeHash,
    ]);
    const ok = ak.__testVerifyMptProof({
      rootHash: stateRoot,
      key: address,
      proof: p.accountProof,
      expectedValue: hexBytes(accountRlp),
    });
    expect(ok).toBe(true);
  });

  test('rejects a tampered account proof (wrong balance)', () => {
    const fixture = require('./fixtures/eoa-with-history.json');
    const p = fixture.getProof;
    const stateRoot = hexBytes(fixture.block.stateRoot);
    const address = hexBytes(p.address);
    const accountRlp = encodeRlp([
      stripLeadingZeros(p.nonce),
      '0xffffffffffffffffffffffffffff',
      p.storageHash,
      p.codeHash,
    ]);
    const ok = ak.__testVerifyMptProof({
      rootHash: stateRoot,
      key: address,
      proof: p.accountProof,
      expectedValue: hexBytes(accountRlp),
    });
    expect(ok).toBe(false);
  });

  test('verifies absence for a never-used address', () => {
    const fixture = require('./fixtures/empty-account.json');
    const p = fixture.getProof;
    const stateRoot = hexBytes(fixture.block.stateRoot);
    const address = hexBytes(p.address);
    const ok = ak.__testVerifyMptProof({
      rootHash: stateRoot,
      key: address,
      proof: p.accountProof,
      expectedValue: undefined,
    });
    expect(ok).toBe(true);
  });
});
