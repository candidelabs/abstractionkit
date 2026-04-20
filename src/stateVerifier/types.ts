/**
 * Shape returned by `eth_getProof`, per EIP-1186.
 *
 * Produced by nodes for any address and a list of storage slots. Used as input
 * to {@link verifyAccountProof} and {@link verifyStorageProof}.
 */
export type EthGetProofResult = {
  /** 0x-prefixed 20-byte address the proof was generated for. */
  address: string;
  /** 0x-prefixed hex account balance in wei. */
  balance: string;
  /** 0x-prefixed keccak256 hash of the deployed bytecode ("0xc5d2...a470" for EOAs). */
  codeHash: string;
  /** 0x-prefixed hex transaction count. */
  nonce: string;
  /** 0x-prefixed 32-byte root of the account's storage trie. */
  storageHash: string;
  /** RLP-encoded MPT nodes from the state root down to this account's leaf. */
  accountProof: string[];
  /** One entry per requested storage slot. */
  storageProof: Array<{
    /** 0x-prefixed 32-byte slot key. */
    key: string;
    /** 0x-prefixed hex value at this slot (minimal encoding; "0x0" if empty). */
    value: string;
    /** RLP-encoded MPT nodes from the storage root down to this slot's leaf. */
    proof: string[];
  }>;
};

/**
 * Block header fields agreed upon by N verification RPC nodes.
 *
 * Returned by {@link getConsensusBlockHeader} and
 * {@link StateVerifier.getConsensusBlockHeader} after quorum is established.
 */
export type ConsensusBlockHeader = {
  /** Block height as a bigint. */
  blockNumber: bigint;
  /** 0x-prefixed 32-byte keccak256 block hash. */
  blockHash: string;
  /** 0x-prefixed 32-byte Merkle Patricia Trie root of the world state. */
  stateRoot: string;
  /** 0x-prefixed 32-byte hash of the parent block. */
  parentHash: string;
  /** Unix epoch seconds as a bigint. */
  timestamp: bigint;
};

/**
 * Cryptographically verified snapshot of an account's on-chain state.
 *
 * Returned by {@link StateVerifier.getVerifiedAccountState}. All fields are
 * proven against a consensus-verified state root via MPT proofs.
 */
export type VerifiedAccountState = {
  /** Block at which the state was proven. */
  blockNumber: bigint;
  /** 0x-prefixed 32-byte state root used for all proofs in this result. */
  stateRoot: string;
  /** False for accounts that do not exist in the trie (zero nonce, balance, code, storage). */
  accountExists: boolean;
  /** Native token balance in wei. */
  balance: bigint;
  /** Confirmed transaction count for this address. */
  nonce: bigint;
  /** 0x-prefixed keccak256 hash of the deployed bytecode. */
  codeHash: string;
  /** 0x-prefixed 32-byte root of the account's storage trie. */
  storageHash: string;
  /** Keyed by normalized 32-byte hex slot; empty if no slots were requested. */
  storage: Record<string, string>;
};
