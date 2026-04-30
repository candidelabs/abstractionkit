const ak = require('../../dist/index.cjs');

describe('verifyAccountProof', () => {
  test('verifies an EOA-with-history proof', () => {
    const f = require('./fixtures/eoa-with-history.json');
    expect(ak.verifyAccountProof({
      stateRoot: f.block.stateRoot,
      address: f.getProof.address,
      proof: f.getProof,
    })).toBe(true);
  });

  test('verifies a contract (Safe singleton) proof', () => {
    const f = require('./fixtures/safe-v141-singleton.json');
    expect(ak.verifyAccountProof({
      stateRoot: f.block.stateRoot,
      address: f.getProof.address,
      proof: f.getProof,
    })).toBe(true);
  });

  test('verifies an empty-account (absence) proof', () => {
    const f = require('./fixtures/empty-account.json');
    expect(ak.verifyAccountProof({
      stateRoot: f.block.stateRoot,
      address: f.getProof.address,
      proof: f.getProof,
    })).toBe(true);
  });

  test('throws AccountProofInvalidError on tampered balance', () => {
    const f = require('./fixtures/eoa-with-history.json');
    const tampered = { ...f.getProof, balance: '0xffffffffffffff' };
    expect(() => ak.verifyAccountProof({
      stateRoot: f.block.stateRoot,
      address: f.getProof.address,
      proof: tampered,
    })).toThrow(ak.AccountProofInvalidError);
  });

  test('throws AccountProofInvalidError on address mismatch', () => {
    const f = require('./fixtures/eoa-with-history.json');
    expect(() => ak.verifyAccountProof({
      stateRoot: f.block.stateRoot,
      address: '0x0000000000000000000000000000000000000000',
      proof: f.getProof,
    })).toThrow(ak.AccountProofInvalidError);
  });
});

describe('verifyStorageProof', () => {
  test('verifies a populated Safe singleton storage slot', () => {
    const f = require('./fixtures/safe-v141-singleton.json');
    const sp = f.getProof.storageProof[0];
    expect(ak.verifyStorageProof({
      storageHash: f.getProof.storageHash,
      storageKey: sp.key,
      storageValue: sp.value,
      storageProof: sp.proof,
    })).toBe(true);
  });

  test('verifies a USDC balance slot', () => {
    const f = require('./fixtures/erc20-balance-slot.json');
    const sp = f.getProof.storageProof[0];
    expect(ak.verifyStorageProof({
      storageHash: f.getProof.storageHash,
      storageKey: sp.key,
      storageValue: sp.value,
      storageProof: sp.proof,
    })).toBe(true);
  });

  test('throws StorageProofInvalidError on tampered value', () => {
    const f = require('./fixtures/erc20-balance-slot.json');
    const sp = f.getProof.storageProof[0];
    expect(() => ak.verifyStorageProof({
      storageHash: f.getProof.storageHash,
      storageKey: sp.key,
      storageValue: '0xffffffffffffffff',
      storageProof: sp.proof,
    })).toThrow(ak.StorageProofInvalidError);
  });
});
