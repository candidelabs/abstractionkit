import { keccak256 } from "ethers";
import { getConsensusBlockHeader as standaloneGetHeader } from "./consensus";
import { verifyAccountProof, verifyStorageProof, EMPTY_STORAGE_HASH, EMPTY_CODE_HASH } from "./proofVerifier";
import { jsonRpcCall } from "./rpc";
import { AccountProofInvalidError, CodeHashMismatchError } from "./errors";
import type { ConsensusBlockHeader, EthGetProofResult, VerifiedAccountState } from "./types";

function normalizeSlot(slot: string | bigint | number): string {
  let asBig: bigint;
  if (typeof slot === "bigint") asBig = slot;
  else if (typeof slot === "number") {
    if (!Number.isInteger(slot) || slot < 0) {
      throw new Error(`Invalid slot number: ${slot}`);
    }
    asBig = BigInt(slot);
  } else {
    const hex = slot.startsWith("0x") ? slot.slice(2) : slot;
    asBig = BigInt("0x" + hex);
  }
  return "0x" + asBig.toString(16).padStart(64, "0");
}

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

  /**
   * Fetch and verify an account's state at a block, including any requested
   * storage slots. Uses `primaryRpc` for eth_getProof. State root comes from a
   * consensus query across `consensusRpcs` (primary + verifiers).
   *
   * @example
   * const state = await verifier.getVerifiedAccountState({
   *   address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
   *   slots: [0n, 1n],
   * });
   * console.log(state.balance, state.storage);
   */
  async getVerifiedAccountState(params: {
    address: string;
    slots?: (string | bigint | number)[];
    blockNumber?: bigint | "latest";
    header?: ConsensusBlockHeader;
  }): Promise<VerifiedAccountState> {
    const { address, slots = [] } = params;

    if (params.header && typeof params.blockNumber === "bigint") {
      if (params.header.blockNumber !== params.blockNumber) {
        throw new Error(
          `header.blockNumber (${params.header.blockNumber}) does not match blockNumber (${params.blockNumber})`,
        );
      }
    }

    const header = params.header ?? (await this.getConsensusBlockHeader({
      blockNumber: params.blockNumber ?? "latest",
    }));

    const normalizedSlots = slots.map(normalizeSlot);
    const blockHex = "0x" + header.blockNumber.toString(16);

    const proof = await jsonRpcCall<EthGetProofResult>({
      url: this.primaryRpc,
      method: "eth_getProof",
      params: [address, normalizedSlots, blockHex],
      timeoutMs: this.requestTimeoutMs,
      retries: this.retries,
    });

    verifyAccountProof({ stateRoot: header.stateRoot, address, proof });

    const storage: Record<string, string> = {};
    for (const sp of proof.storageProof) {
      verifyStorageProof({
        storageHash: proof.storageHash,
        storageKey: sp.key,
        storageValue: sp.value,
        storageProof: sp.proof,
        address,
      });
      storage[normalizeSlot(sp.key)] = sp.value;
    }

    const balance = BigInt(proof.balance === "0x" ? "0x0" : proof.balance);
    const nonce = BigInt(proof.nonce === "0x" ? "0x0" : proof.nonce);
    const zeroHash = "0x0000000000000000000000000000000000000000000000000000000000000000";
    const accountExists = !(
      balance === 0n &&
      nonce === 0n &&
      (proof.storageHash.toLowerCase() === EMPTY_STORAGE_HASH ||
        proof.storageHash.toLowerCase() === zeroHash) &&
      (proof.codeHash.toLowerCase() === EMPTY_CODE_HASH ||
        proof.codeHash.toLowerCase() === zeroHash)
    );

    return {
      blockNumber: header.blockNumber,
      stateRoot: header.stateRoot,
      accountExists,
      balance,
      nonce,
      codeHash: proof.codeHash,
      storageHash: proof.storageHash,
      storage,
    };
  }

  /**
   * Verify a single storage slot on an account at a block.
   * Thin wrapper over `getVerifiedAccountState` for single-slot lookups.
   *
   * @example
   * const ownerPtr = await verifier.getVerifiedStorageSlot({
   *   address: "0xSafeAddress",
   *   slot: 2n,
   * });
   */
  async getVerifiedStorageSlot(params: {
    address: string;
    slot: string | bigint | number;
    blockNumber?: bigint | "latest";
    header?: ConsensusBlockHeader;
  }): Promise<string> {
    const state = await this.getVerifiedAccountState({
      address: params.address,
      slots: [params.slot],
      blockNumber: params.blockNumber,
      header: params.header,
    });
    return state.storage[normalizeSlot(params.slot)];
  }

  /**
   * Verify an account's balance at a block.
   * Thin wrapper over `getVerifiedAccountState`.
   *
   * @example
   * const balance = await verifier.getVerifiedBalance({
   *   address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
   * });
   */
  async getVerifiedBalance(params: {
    address: string;
    blockNumber?: bigint | "latest";
    header?: ConsensusBlockHeader;
  }): Promise<bigint> {
    const state = await this.getVerifiedAccountState(params);
    return state.balance;
  }

  /**
   * Fetch and verify an account's deployed bytecode at a block.
   *
   * Fetches eth_getCode on the primary RPC, then checks that keccak256(code)
   * matches the codeHash from a verified account proof. EOAs and empty
   * accounts (code = "0x") are handled by comparing against EMPTY_CODE_HASH.
   *
   * @example
   * const { code } = await verifier.getVerifiedCode({ address: safeAddr });
   * if (!code.startsWith(EXPECTED_PREFIX)) throw new Error("unexpected bytecode");
   */
  async getVerifiedCode(params: {
    address: string;
    blockNumber?: bigint | "latest";
    header?: ConsensusBlockHeader;
  }): Promise<{ blockNumber: bigint; code: string; codeHash: string }> {
    const state = await this.getVerifiedAccountState(params);
    const blockHex = "0x" + state.blockNumber.toString(16);

    const code = await jsonRpcCall<string>({
      url: this.primaryRpc,
      method: "eth_getCode",
      params: [params.address, blockHex],
      timeoutMs: this.requestTimeoutMs,
      retries: this.retries,
    });

    const actualCodeHash =
      code === "0x" ? EMPTY_CODE_HASH : keccak256(code).toLowerCase();
    const expectedHash = state.codeHash.toLowerCase();
    const zeroHash = "0x0000000000000000000000000000000000000000000000000000000000000000";

    const matches =
      actualCodeHash === expectedHash ||
      (actualCodeHash === EMPTY_CODE_HASH && expectedHash === zeroHash);

    if (!matches) {
      throw new CodeHashMismatchError(params.address, state.codeHash, actualCodeHash);
    }

    return {
      blockNumber: state.blockNumber,
      code,
      codeHash: state.codeHash,
    };
  }

  /**
   * Verify multiple accounts in parallel at the same block. Shares one
   * consensus-verified block header across all verifications, saving N-1
   * round trips.
   *
   * Failure semantics: Promise.all. First failure rejects the batch.
   *
   * @example
   * const [alice, bob] = await verifier.getVerifiedAccountStates([
   *   { address: "0xAlice" },
   *   { address: "0xBob", slots: [0n] },
   * ]);
   */
  async getVerifiedAccountStates(
    requests: Array<{
      address: string;
      slots?: (string | bigint | number)[];
    }>,
    options?: {
      blockNumber?: bigint | "latest";
      header?: ConsensusBlockHeader;
    },
  ): Promise<VerifiedAccountState[]> {
    const header = options?.header ?? (await this.getConsensusBlockHeader({
      blockNumber: options?.blockNumber ?? "latest",
    }));
    return Promise.all(
      requests.map((r) =>
        this.getVerifiedAccountState({
          address: r.address,
          slots: r.slots,
          header,
        }),
      ),
    );
  }
}
