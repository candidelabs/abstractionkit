const ak = require('../../dist/index.cjs');

describe('StateVerifier errors', () => {
  test('all specific errors extend StateProofVerificationError', () => {
    const generic = new ak.StateProofVerificationError('boom');
    expect(generic).toBeInstanceOf(ak.StateProofVerificationError);

    const disagreement = new ak.ConsensusStateRootDisagreementError([
      { url: 'a', stateRoot: '0x1' },
      { url: 'b', stateRoot: '0x2' },
    ]);
    expect(disagreement).toBeInstanceOf(ak.StateProofVerificationError);
    expect(disagreement.nodes).toHaveLength(2);

    const quorum = new ak.ConsensusQuorumNotMetError(1, 2, []);
    expect(quorum.responded).toBe(1);
    expect(quorum.required).toBe(2);

    const account = new ak.AccountProofInvalidError('0xabc', '0xroot', 42n, 'bad');
    expect(account.blockNumber).toBe(42n);

    const storage = new ak.StorageProofInvalidError('0xslot', '0xhash', 'bad');
    expect(storage.slot).toBe('0xslot');

    const code = new ak.CodeHashMismatchError('0xaddr', '0xexp', '0xact');
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
