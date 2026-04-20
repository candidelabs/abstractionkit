import { ConsensusQuorumNotMetError, ConsensusStateRootDisagreementError } from "./errors";
import { jsonRpcCall } from "./rpc";
import type { ConsensusBlockHeader } from "./types";

type RawBlockHeader = {
  number: string;
  hash: string;
  stateRoot: string;
  parentHash: string;
  timestamp: string;
};

/**
 * Fetch a block header from N verification RPC nodes in parallel. Require:
 *
 * 1. At least `quorumThreshold` nodes respond successfully.
 * 2. All responders agree on the state root.
 *
 * Returns the agreed-upon `ConsensusBlockHeader`. Resolves `"latest"` against
 * the first verification RPC minus `syncTolerance` so slower nodes have time
 * to catch up before the parallel query.
 *
 * @throws ConsensusQuorumNotMetError, ConsensusStateRootDisagreementError
 *
 * @example
 * const header = await getConsensusBlockHeader({
 *   blockNumber: "latest",
 *   verificationRpcs: [url1, url2, url3],
 * });
 */
export async function getConsensusBlockHeader(params: {
  blockNumber: bigint | "latest";
  verificationRpcs: string[];
  quorumThreshold?: number;
  syncTolerance?: number;
  requestTimeoutMs?: number;
}): Promise<ConsensusBlockHeader> {
  const {
    blockNumber,
    verificationRpcs,
    quorumThreshold = Math.max(Math.floor(verificationRpcs.length / 2), 1),
    syncTolerance = 1,
    requestTimeoutMs = 10_000,
  } = params;

  if (verificationRpcs.length === 0) {
    throw new ConsensusQuorumNotMetError(0, quorumThreshold, []);
  }

  // Resolve "latest" against the first RPC, minus syncTolerance.
  let resolvedBlockNumber: bigint;
  if (blockNumber === "latest") {
    const latestHex = await jsonRpcCall<string>({
      url: verificationRpcs[0],
      method: "eth_blockNumber",
      params: [],
      timeoutMs: requestTimeoutMs,
    });
    resolvedBlockNumber = BigInt(latestHex) - BigInt(syncTolerance);
  } else {
    resolvedBlockNumber = blockNumber;
  }

  const blockHex = "0x" + resolvedBlockNumber.toString(16);

  const results = await Promise.allSettled(
    verificationRpcs.map((url) =>
      jsonRpcCall<RawBlockHeader>({
        url,
        method: "eth_getBlockByNumber",
        params: [blockHex, false],
        timeoutMs: requestTimeoutMs,
      }).then((r) => ({ url, header: r })),
    ),
  );

  const successes: Array<{ url: string; header: RawBlockHeader }> = [];
  const failures: Array<{ url: string; error: string }> = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled") {
      successes.push(r.value);
    } else {
      failures.push({ url: verificationRpcs[i], error: String(r.reason) });
    }
  }

  if (successes.length < quorumThreshold) {
    throw new ConsensusQuorumNotMetError(successes.length, quorumThreshold, failures);
  }

  const reference = successes[0].header.stateRoot.toLowerCase();
  for (const s of successes) {
    if (s.header.stateRoot.toLowerCase() !== reference) {
      throw new ConsensusStateRootDisagreementError(
        successes.map((s) => ({ url: s.url, stateRoot: s.header.stateRoot })),
      );
    }
  }

  const h = successes[0].header;
  return {
    blockNumber: BigInt(h.number),
    blockHash: h.hash,
    stateRoot: h.stateRoot,
    parentHash: h.parentHash,
    timestamp: BigInt(h.timestamp),
  };
}
