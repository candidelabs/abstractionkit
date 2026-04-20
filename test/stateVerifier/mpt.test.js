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
