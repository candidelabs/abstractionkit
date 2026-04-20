import { AbstractionKitError } from "../errors";

/** Base class for all state proof verification failures. */
export class StateProofVerificationError extends AbstractionKitError {
  public readonly context: Record<string, unknown>;

  constructor(message: string, ctx: Record<string, unknown> = {}) {
    super("UNKNOWN_ERROR", message, { context: ctx });
    this.name = "StateProofVerificationError";
    this.context = ctx;
  }
}

/** Two or more verification nodes returned different state roots. */
export class ConsensusStateRootDisagreementError extends StateProofVerificationError {
  public readonly nodes: Array<{ url: string; stateRoot: string }>;

  constructor(nodes: Array<{ url: string; stateRoot: string }>) {
    super(
      `Verification nodes disagree on state root: ${nodes.map((n) => `${n.url}=${n.stateRoot}`).join(", ")}`,
      { nodes },
    );
    this.name = "ConsensusStateRootDisagreementError";
    this.nodes = nodes;
  }
}

/** Fewer than `quorumThreshold` verification nodes responded. */
export class ConsensusQuorumNotMetError extends StateProofVerificationError {
  public readonly responded: number;
  public readonly required: number;
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
    this.name = "ConsensusQuorumNotMetError";
    this.responded = responded;
    this.required = required;
    this.failures = failures;
  }
}

/** MPT account proof did not verify against the state root. */
export class AccountProofInvalidError extends StateProofVerificationError {
  public readonly address: string;
  public readonly stateRoot: string;
  public readonly blockNumber: bigint;

  constructor(address: string, stateRoot: string, blockNumber: bigint, detail: string) {
    super(
      `Account proof invalid for ${address} at state root ${stateRoot}: ${detail}`,
      { address, stateRoot, blockNumber: blockNumber.toString() },
    );
    this.name = "AccountProofInvalidError";
    this.address = address;
    this.stateRoot = stateRoot;
    this.blockNumber = blockNumber;
  }
}

/** MPT storage proof did not verify against the storage hash. */
export class StorageProofInvalidError extends StateProofVerificationError {
  public readonly address?: string;
  public readonly slot: string;
  public readonly storageHash: string;

  constructor(slot: string, storageHash: string, detail: string, address?: string) {
    super(
      `Storage proof invalid for slot ${slot} at storage hash ${storageHash}: ${detail}`,
      { address, slot, storageHash },
    );
    this.name = "StorageProofInvalidError";
    this.address = address;
    this.slot = slot;
    this.storageHash = storageHash;
  }
}

/** eth_getCode response did not hash to the verified codeHash. */
export class CodeHashMismatchError extends StateProofVerificationError {
  public readonly address: string;
  public readonly expectedCodeHash: string;
  public readonly actualCodeHash: string;

  constructor(address: string, expectedCodeHash: string, actualCodeHash: string) {
    super(
      `Code at ${address} hashes to ${actualCodeHash}, expected ${expectedCodeHash}`,
      { address, expectedCodeHash, actualCodeHash },
    );
    this.name = "CodeHashMismatchError";
    this.address = address;
    this.expectedCodeHash = expectedCodeHash;
    this.actualCodeHash = actualCodeHash;
  }
}
