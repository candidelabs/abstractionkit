/** Shape returned by eth_getProof, per EIP-1186. */
export type EthGetProofResult = {
  address: string;
  balance: string;
  codeHash: string;
  nonce: string;
  storageHash: string;
  accountProof: string[];
  storageProof: Array<{
    key: string;
    value: string;
    proof: string[];
  }>;
};

/** Agreed-upon block header from N verification nodes. */
export type ConsensusBlockHeader = {
  blockNumber: bigint;
  blockHash: string;
  stateRoot: string;
  parentHash: string;
  timestamp: bigint;
};

/** Fully verified account state at a block. */
export type VerifiedAccountState = {
  blockNumber: bigint;
  stateRoot: string;
  accountExists: boolean;
  balance: bigint;
  nonce: bigint;
  codeHash: string;
  storageHash: string;
  /** Keyed by normalized 32-byte hex slot; empty if no slots were requested. */
  storage: Record<string, string>;
};
