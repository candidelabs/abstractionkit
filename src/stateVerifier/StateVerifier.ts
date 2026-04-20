import { getConsensusBlockHeader as standaloneGetHeader } from "./consensus";
import type { ConsensusBlockHeader } from "./types";

/**
 * Orchestrator for trust-minimized state verification.
 *
 * Takes a primary RPC (used for eth_getProof + eth_getCode AND for state-root
 * consensus) plus one or more verification RPCs (used only for state-root
 * consensus). The primary participates in the consensus vote alongside the
 * verifiers, which mirrors the Flutter `safe-verify` design and ensures a
 * malicious primary cannot silently serve a proof against a state root that
 * none of the secondaries agree with.
 *
 * @example
 * const verifier = new StateVerifier({
 *   primaryRpc: "https://alchemy.../mainnet",
 *   verificationRpcs: [
 *     "https://ethereum-rpc.publicnode.com",
 *     "https://rpc.ankr.com/eth",
 *   ],
 * });
 * const balance = await verifier.getVerifiedBalance({ address: "0x..." });
 */
export class StateVerifier {
  public readonly primaryRpc: string;
  public readonly verificationRpcs: string[];
  /** Deduped consensus set: [primaryRpc, ...verificationRpcs] with duplicates removed. */
  public readonly consensusRpcs: string[];
  public readonly quorumThreshold: number;
  public readonly retries: number;
  public readonly syncTolerance: number;
  public readonly requestTimeoutMs: number;

  constructor(params: {
    primaryRpc: string;
    verificationRpcs: string[];
    quorumThreshold?: number;
    retries?: number;
    syncTolerance?: number;
    requestTimeoutMs?: number;
  }) {
    if (!params.primaryRpc) {
      throw new Error("StateVerifier requires primaryRpc");
    }
    if (params.verificationRpcs.length === 0) {
      throw new Error("StateVerifier requires at least one verification RPC");
    }
    this.primaryRpc = params.primaryRpc;
    this.verificationRpcs = params.verificationRpcs;
    this.consensusRpcs = Array.from(
      new Set([params.primaryRpc, ...params.verificationRpcs]),
    );
    this.quorumThreshold =
      params.quorumThreshold ?? Math.max(Math.floor(this.consensusRpcs.length / 2), 1);
    this.retries = params.retries ?? 3;
    this.syncTolerance = params.syncTolerance ?? 1;
    this.requestTimeoutMs = params.requestTimeoutMs ?? 10_000;
  }

  /**
   * Fetch a consensus-verified block header using this instance's config.
   * Queries all nodes in `consensusRpcs` (primary + verifiers, deduped).
   */
  async getConsensusBlockHeader(params?: {
    blockNumber?: bigint | "latest";
  }): Promise<ConsensusBlockHeader> {
    return standaloneGetHeader({
      blockNumber: params?.blockNumber ?? "latest",
      verificationRpcs: this.consensusRpcs,
      quorumThreshold: this.quorumThreshold,
      syncTolerance: this.syncTolerance,
      requestTimeoutMs: this.requestTimeoutMs,
    });
  }
}
