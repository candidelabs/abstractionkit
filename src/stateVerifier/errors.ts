import { AbstractionKitError, Jsonable } from "../errors";

/**
 * Base class for all state proof verification failures.
 *
 * Extends {@link AbstractionKitError} so callers can do a single
 * `catch (e) { if (e instanceof StateProofVerificationError) ... }` to
 * handle any verification failure from this module.
 */
export class StateProofVerificationError extends AbstractionKitError {
  constructor(message: string, context?: Jsonable) {
    super("UNKNOWN_ERROR", message, { context });
  }
}

/** Per-node block header data captured when verifiers disagree. */
export type ConsensusDisagreementNode = {
  url: string;
  stateRoot: string;
  blockHash: string;
  parentHash: string;
  /** Block timestamp as returned by the node (hex or decimal string). */
  timestamp: string;
};

/**
 * Thrown when two or more verification nodes return different block header
 * fields for the same block number. This indicates either a split network, a
 * compromised node, or a misconfigured RPC URL.
 *
 * Inspect `fields` to see which header field(s) disagreed, and `nodes` to
 * identify which endpoint(s) returned what.
 */
export class ConsensusHeaderDisagreementError extends StateProofVerificationError {
  /**
   * Names of the header fields on which the nodes disagreed. Valid values:
   * `"stateRoot"`, `"blockHash"`, `"parentHash"`, `"timestamp"`.
   */
  public readonly fields: string[];
  /** Each responding node and the full header fields it returned. */
  public readonly nodes: ConsensusDisagreementNode[];

  constructor(fields: string[], nodes: ConsensusDisagreementNode[]) {
    super(
      `Verification nodes disagree on block header field(s) [${fields.join(", ")}]: ${nodes
        .map((n) => `${n.url}={stateRoot:${n.stateRoot},blockHash:${n.blockHash}}`)
        .join(", ")}`,
      { fields, nodes },
    );
    this.fields = fields;
    this.nodes = nodes;
  }
}

/**
 * Thrown when fewer than `quorumThreshold` verification nodes respond
 * successfully for a given block number query.
 *
 * Check `failures` for per-node error messages to diagnose connectivity issues.
 */
export class ConsensusQuorumNotMetError extends StateProofVerificationError {
  /** Number of nodes that responded in time without errors. */
  public readonly responded: number;
  /** Minimum number of successful responses that was required. */
  public readonly required: number;
  /** Per-node error messages for all nodes that failed. */
  public readonly failures: Array<{ url: string; error: string }>;

  constructor(
    responded: number,
    required: number,
    failures: Array<{ url: string; error: string }>,
  ) {
    super(
      `Consensus quorum not met: ${responded}/${required} nodes responded`,
      { responded, required, failures },
    );
    this.responded = responded;
    this.required = required;
    this.failures = failures;
  }
}

/**
 * Thrown when an MPT account proof fails to verify against the consensus
 * state root. Possible causes: tampered proof data, wrong block number, or
 * a bug in the proof generation on the node.
 */
export class AccountProofInvalidError extends StateProofVerificationError {
  /** The address whose proof was being verified. */
  public readonly address: string;
  /** The state root the proof was checked against. */
  public readonly stateRoot: string;
  /** The block number at which verification was attempted. */
  public readonly blockNumber: bigint;

  constructor(address: string, stateRoot: string, blockNumber: bigint, detail: string) {
    super(
      `Account proof invalid for ${address} at state root ${stateRoot}: ${detail}`,
      { address, stateRoot, blockNumber: blockNumber.toString() },
    );
    this.address = address;
    this.stateRoot = stateRoot;
    this.blockNumber = blockNumber;
  }
}

/**
 * Thrown when an MPT storage proof fails to verify against the account's
 * storage hash. Possible causes: tampered proof data, incorrect slot key, or
 * a mismatch between the proof and the account's `storageHash` field.
 */
export class StorageProofInvalidError extends StateProofVerificationError {
  /** The account address, if provided at call site. */
  public readonly address?: string;
  /** 0x-prefixed slot key that failed verification. */
  public readonly slot: string;
  /** The storage hash the proof was checked against. */
  public readonly storageHash: string;

  constructor(slot: string, storageHash: string, detail: string, address?: string) {
    super(
      `Storage proof invalid for slot ${slot} at storage hash ${storageHash}: ${detail}`,
      { address, slot, storageHash },
    );
    this.address = address;
    this.slot = slot;
    this.storageHash = storageHash;
  }
}

/**
 * Thrown when the bytecode returned by `eth_getCode` does not hash to the
 * `codeHash` field proven by the account MPT proof. This indicates a node is
 * serving inconsistent state: the account proof and the code response disagree.
 */
export class CodeHashMismatchError extends StateProofVerificationError {
  /** The address whose code was fetched. */
  public readonly address: string;
  /** The codeHash from the verified account proof. */
  public readonly expectedCodeHash: string;
  /** keccak256 of the bytecode returned by eth_getCode. */
  public readonly actualCodeHash: string;

  constructor(address: string, expectedCodeHash: string, actualCodeHash: string) {
    super(
      `Code at ${address} hashes to ${actualCodeHash}, expected ${expectedCodeHash}`,
      { address, expectedCodeHash, actualCodeHash },
    );
    this.address = address;
    this.expectedCodeHash = expectedCodeHash;
    this.actualCodeHash = actualCodeHash;
  }
}
