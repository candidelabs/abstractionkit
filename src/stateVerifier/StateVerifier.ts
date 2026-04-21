import { keccak256 } from "ethers";
import { getConsensusBlockHeader as standaloneGetHeader } from "./consensus";
import { verifyAccountProof, verifyStorageProof, EMPTY_STORAGE_HASH, EMPTY_CODE_HASH } from "./proofVerifier";
import { jsonRpcCall } from "./rpc";
import { AccountProofInvalidError, CodeHashMismatchError } from "./errors";
import type { ConsensusBlockHeader, EthGetProofResult, VerifiedAccountState } from "./types";

const MAX_UINT256 = (1n << 256n) - 1n;

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
  if (asBig < 0n || asBig > MAX_UINT256) {
    throw new RangeError(
      `Invalid slot: ${slot} is outside the uint256 range [0, 2^256 - 1]`,
    );
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

  /**
   * Create a new StateVerifier instance.
   *
   * @param params.primaryRpc - JSON-RPC endpoint used for `eth_getProof` and
   *   `eth_getCode` calls. It also participates in the consensus vote.
   * @param params.verificationRpcs - One or more additional JSON-RPC endpoints
   *   used exclusively for the consensus state-root check. Must be non-empty.
   * @param params.quorumThreshold - Minimum number of consensus nodes that must
   *   agree on the state root. Defaults to majority of `[primaryRpc, ...verificationRpcs]`.
   * @param params.retries - How many times to retry a failed `eth_getProof` /
   *   `eth_getCode` request with exponential backoff. Defaults to 3.
   * @param params.syncTolerance - Blocks behind the chain tip to use when resolving
   *   `"latest"`, giving slower nodes time to sync. Defaults to 1.
   * @param params.requestTimeoutMs - Per-request timeout in milliseconds.
   *   Defaults to 10 000.
   */
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
    if (!Array.isArray(params.verificationRpcs) || params.verificationRpcs.length === 0) {
      throw new Error("StateVerifier requires at least one verification RPC");
    }
    this.primaryRpc = params.primaryRpc;
    this.verificationRpcs = params.verificationRpcs;
    this.consensusRpcs = Array.from(
      new Set([params.primaryRpc, ...params.verificationRpcs]),
    );

    const quorumDefault = Math.floor(this.consensusRpcs.length / 2) + 1;
    const quorum = params.quorumThreshold ?? quorumDefault;
    if (
      !Number.isInteger(quorum) ||
      quorum < 1 ||
      quorum > this.consensusRpcs.length
    ) {
      throw new RangeError(
        `quorumThreshold must be an integer in [1, ${this.consensusRpcs.length}], got ${quorum}`,
      );
    }
    this.quorumThreshold = quorum;

    const retries = params.retries ?? 3;
    if (!Number.isInteger(retries) || retries < 0) {
      throw new RangeError(`retries must be a non-negative integer, got ${retries}`);
    }
    this.retries = retries;

    const syncTolerance = params.syncTolerance ?? 1;
    if (!Number.isInteger(syncTolerance) || syncTolerance < 0) {
      throw new RangeError(
        `syncTolerance must be a non-negative integer, got ${syncTolerance}`,
      );
    }
    this.syncTolerance = syncTolerance;

    const requestTimeoutMs = params.requestTimeoutMs ?? 10_000;
    if (
      typeof requestTimeoutMs !== "number" ||
      !Number.isFinite(requestTimeoutMs) ||
      requestTimeoutMs <= 0
    ) {
      throw new RangeError(
        `requestTimeoutMs must be a positive finite number, got ${requestTimeoutMs}`,
      );
    }
    this.requestTimeoutMs = requestTimeoutMs;
  }

  /**
   * Fetch a consensus-verified block header using this instance's config.
   * Queries all nodes in `consensusRpcs` (primary + verifiers, deduped).
   *
   * @param params.blockNumber - Block to fetch. Defaults to `"latest"`.
   * @returns A block header whose `stateRoot` has been agreed upon by all
   *   responding consensus nodes.
   * @throws {ConsensusQuorumNotMetError} Fewer than `quorumThreshold` nodes responded.
   * @throws {ConsensusHeaderDisagreementError} Nodes returned different state roots.
   *
   * @example
   * const verifier = new StateVerifier({
   *   primaryRpc: "https://alchemy.../mainnet",
   *   verificationRpcs: ["https://ethereum-rpc.publicnode.com"],
   * });
   * const header = await verifier.getConsensusBlockHeader();
   * console.log(header.blockNumber, header.stateRoot);
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
   * storage slots. Uses `primaryRpc` for `eth_getProof`. State root comes from a
   * consensus query across `consensusRpcs` (primary + verifiers).
   *
   * @param params.address - 0x-prefixed 20-byte account address to verify.
   * @param params.slots - Storage slot keys to include in the proof. Each entry
   *   may be a 0x-prefixed hex string, a bigint, or a non-negative integer.
   * @param params.blockNumber - Block at which to verify state. Defaults to `"latest"`.
   * @param params.header - Pre-fetched consensus header to reuse (avoids an extra
   *   round trip when batching multiple accounts at the same block).
   * @returns A fully verified {@link VerifiedAccountState} proven against the
   *   consensus state root.
   * @throws {ConsensusQuorumNotMetError} Consensus could not be established.
   * @throws {ConsensusHeaderDisagreementError} Nodes disagree on the state root.
   * @throws {AccountProofInvalidError} The account MPT proof is invalid.
   * @throws {StorageProofInvalidError} A storage MPT proof is invalid.
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

    // Normalize/validate slots before any network call so malformed input
    // surfaces immediately instead of after a consensus round-trip.
    const normalizedSlots = slots.map(normalizeSlot);

    const header = params.header ?? (await this.getConsensusBlockHeader({
      blockNumber: params.blockNumber ?? "latest",
    }));

    const blockHex = "0x" + header.blockNumber.toString(16);

    const proof = await jsonRpcCall<EthGetProofResult>({
      url: this.primaryRpc,
      method: "eth_getProof",
      params: [address, normalizedSlots, blockHex],
      timeoutMs: this.requestTimeoutMs,
      retries: this.retries,
    });

    verifyAccountProof({ stateRoot: header.stateRoot, address, proof });

    // Guard against an RPC that returns proofs for different slots than we
    // requested. Without this check, a malicious primary could satisfy
    // verifyStorageProof cryptographically (the proofs are valid against the
    // storageHash) but have the returned slots be irrelevant to the caller,
    // leaving `getVerifiedStorageSlot` to resolve as `undefined`.
    const requestedSlotSet = new Set(normalizedSlots);
    const returnedSlotSet = new Set(
      proof.storageProof.map((sp) => normalizeSlot(sp.key)),
    );
    if (requestedSlotSet.size !== returnedSlotSet.size) {
      throw new Error(
        `eth_getProof returned ${returnedSlotSet.size} distinct storage slots for ${requestedSlotSet.size} requested (address=${address})`,
      );
    }
    for (const slot of requestedSlotSet) {
      if (!returnedSlotSet.has(slot)) {
        throw new Error(
          `eth_getProof did not return a proof for requested storage slot ${slot} (address=${address})`,
        );
      }
    }

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
   * @param params.address - 0x-prefixed 20-byte account address.
   * @param params.slot - Slot to read: 0x-prefixed hex string, bigint, or integer index.
   * @param params.blockNumber - Block at which to verify state. Defaults to `"latest"`.
   * @param params.header - Pre-fetched consensus header to reuse.
   * @returns The 0x-prefixed hex value at the slot (as returned by `eth_getProof`).
   * @throws {AccountProofInvalidError} The account proof is invalid.
   * @throws {StorageProofInvalidError} The storage proof is invalid.
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
   * Verify an account's native token balance at a block.
   * Thin wrapper over `getVerifiedAccountState`.
   *
   * @param params.address - 0x-prefixed 20-byte account address.
   * @param params.blockNumber - Block at which to verify state. Defaults to `"latest"`.
   * @param params.header - Pre-fetched consensus header to reuse.
   * @returns The proven balance in wei as a bigint.
   * @throws {AccountProofInvalidError} The account proof is invalid.
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
   * Fetches `eth_getCode` on the primary RPC, then checks that `keccak256(code)`
   * matches the `codeHash` from a verified account proof. EOAs and empty
   * accounts (code = `"0x"`) are handled by comparing against `EMPTY_CODE_HASH`.
   *
   * @param params.address - 0x-prefixed 20-byte account address.
   * @param params.blockNumber - Block at which to verify state. Defaults to `"latest"`.
   * @param params.header - Pre-fetched consensus header to reuse.
   * @returns An object containing the proven `blockNumber`, `code` (0x-prefixed
   *   bytecode hex), and `codeHash` (0x-prefixed keccak256 of the code).
   * @throws {AccountProofInvalidError} The account proof is invalid.
   * @throws {CodeHashMismatchError} The bytecode returned by `eth_getCode` does not
   *   hash to the `codeHash` in the account proof.
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

    // Return the hash we actually validated against the fetched bytes, not
    // state.codeHash: when the account is absent we accept actualCodeHash =
    // EMPTY_CODE_HASH against state.codeHash = zeroHash, so returning the
    // latter would leave `(code, codeHash)` inconsistent with keccak256(code).
    return {
      blockNumber: state.blockNumber,
      code,
      codeHash: actualCodeHash,
    };
  }

  /**
   * Verify multiple accounts in parallel at the same block. Shares one
   * consensus-verified block header across all verifications, saving N-1
   * round trips compared to sequential `getVerifiedAccountState` calls.
   *
   * Failure semantics: `Promise.all` - the first failure rejects the entire batch.
   *
   * @param requests - Array of account requests. Each entry specifies an `address`
   *   and an optional list of `slots` to include in the proof.
   * @param options.blockNumber - Block at which to verify all accounts. Defaults to `"latest"`.
   * @param options.header - Pre-fetched consensus header to share across all requests.
   * @returns An array of {@link VerifiedAccountState} in the same order as `requests`.
   * @throws {ConsensusQuorumNotMetError} Consensus could not be established.
   * @throws {AccountProofInvalidError} Any account proof is invalid.
   * @throws {StorageProofInvalidError} Any storage proof is invalid.
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
    if (options?.header && typeof options?.blockNumber === "bigint") {
      if (options.header.blockNumber !== options.blockNumber) {
        throw new Error(
          `header.blockNumber (${options.header.blockNumber}) does not match blockNumber (${options.blockNumber})`,
        );
      }
    }

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
