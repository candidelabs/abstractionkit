const ak = require('../../dist/index.cjs');

describe('StateVerifier errors', () => {
  test('all specific errors extend StateProofVerificationError', () => {
    const generic = new ak.StateProofVerificationError('boom');
    expect(generic).toBeInstanceOf(ak.StateProofVerificationError);

    const disagreement = new ak.ConsensusHeaderDisagreementError(
      ['stateRoot'],
      [
        { url: 'a', stateRoot: '0x1', blockHash: '0xa', parentHash: '0xp', timestamp: '0x64' },
        { url: 'b', stateRoot: '0x2', blockHash: '0xb', parentHash: '0xp', timestamp: '0x64' },
      ],
    );
    expect(disagreement).toBeInstanceOf(ak.StateProofVerificationError);
    expect(disagreement.nodes).toHaveLength(2);
    expect(disagreement.fields).toEqual(['stateRoot']);

    const quorum = new ak.ConsensusQuorumNotMetError(1, 2, []);
    expect(quorum).toBeInstanceOf(ak.StateProofVerificationError);
    expect(quorum.responded).toBe(1);
    expect(quorum.required).toBe(2);

    const account = new ak.AccountProofInvalidError('0xabc', '0xroot', 42n, 'bad');
    expect(account).toBeInstanceOf(ak.StateProofVerificationError);
    expect(account.blockNumber).toBe(42n);

    const storage = new ak.StorageProofInvalidError('0xslot', '0xhash', 'bad');
    expect(storage).toBeInstanceOf(ak.StateProofVerificationError);
    expect(storage.slot).toBe('0xslot');

    const code = new ak.CodeHashMismatchError('0xaddr', '0xexp', '0xact');
    expect(code).toBeInstanceOf(ak.StateProofVerificationError);
    expect(code.expectedCodeHash).toBe('0xexp');
  });

  test('context carries structured data', () => {
    const err = new ak.ConsensusQuorumNotMetError(1, 3, [
      { url: 'u1', error: 'timeout' },
    ]);
    expect(err.context.responded).toBe(1);
    expect(err.context.required).toBe(3);
    expect(err.context.failures).toHaveLength(1);
  });
});
