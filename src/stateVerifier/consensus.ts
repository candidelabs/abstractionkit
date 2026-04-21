import {
	type ConsensusDisagreementNode,
	ConsensusHeaderDisagreementError,
	ConsensusQuorumNotMetError,
} from "./errors";
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
 * Fetch a block header from N verification RPC nodes in parallel. Requires:
 *
 * 1. At least `quorumThreshold` nodes respond successfully.
 * 2. All responders agree on every field of the block header
 *    (stateRoot, hash, parentHash, timestamp).
 *
 * Returns the agreed-upon `ConsensusBlockHeader`. When `blockNumber` is
 * `"latest"`, the chain tip is resolved by querying `eth_blockNumber` on every
 * verifier in parallel and taking the median of the responses (resists both
 * stale-lying and future-lying malicious nodes under an honest-majority
 * assumption), then subtracting `syncTolerance` to give slower nodes time
 * to catch up before the header fan-out.
 *
 * @param params.blockNumber - Block to fetch. Pass `"latest"` to use the current
 *   chain tip (resolved via cross-node median minus `syncTolerance`).
 * @param params.verificationRpcs - One or more JSON-RPC endpoint URLs to query.
 *   All responders must agree on the full header for the call to succeed.
 * @param params.quorumThreshold - Minimum number of nodes that must respond
 *   successfully. Defaults to strict majority `floor(verificationRpcs.length / 2) + 1`.
 * @param params.syncTolerance - How many blocks behind the chain tip to use when
 *   resolving `"latest"`, giving slower nodes time to catch up. Defaults to 1.
 * @param params.requestTimeoutMs - Per-request timeout in milliseconds.
 *   Defaults to 10 000.
 * @returns The consensus-verified block header agreed upon by all responding nodes.
 * @throws {ConsensusQuorumNotMetError} Fewer than `quorumThreshold` nodes responded.
 * @throws {ConsensusHeaderDisagreementError} Responding nodes returned differing
 *   header fields for the same block number.
 *
 * @example
 * const header = await getConsensusBlockHeader({
 *   blockNumber: "latest",
 *   verificationRpcs: [
 *     "https://ethereum-rpc.publicnode.com",
 *     "https://rpc.ankr.com/eth",
 *   ],
 * });
 * console.log(header.stateRoot);
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
		quorumThreshold = Math.floor(verificationRpcs.length / 2) + 1,
		syncTolerance = 1,
		requestTimeoutMs = 10_000,
	} = params;

	if (!Array.isArray(verificationRpcs) || verificationRpcs.length === 0) {
		throw new ConsensusQuorumNotMetError(0, quorumThreshold, []);
	}
	if (
		!Number.isInteger(quorumThreshold) ||
		quorumThreshold < 1 ||
		quorumThreshold > verificationRpcs.length
	) {
		throw new RangeError(
			`quorumThreshold must be an integer in [1, ${verificationRpcs.length}], got ${quorumThreshold}`,
		);
	}
	if (!Number.isInteger(syncTolerance) || syncTolerance < 0) {
		throw new RangeError(`syncTolerance must be a non-negative integer, got ${syncTolerance}`);
	}
	if (
		typeof requestTimeoutMs !== "number" ||
		!Number.isFinite(requestTimeoutMs) ||
		requestTimeoutMs <= 0
	) {
		throw new RangeError(
			`requestTimeoutMs must be a positive finite number, got ${requestTimeoutMs}`,
		);
	}
	if (blockNumber !== "latest" && blockNumber < 0n) {
		throw new RangeError(`blockNumber must be non-negative, got ${blockNumber}`);
	}

	// Resolve "latest" across all verifiers (median minus syncTolerance).
	let resolvedBlockNumber: bigint;
	if (blockNumber === "latest") {
		const latestResults = await Promise.allSettled(
			verificationRpcs.map((url) =>
				jsonRpcCall<string | null>({
					url,
					method: "eth_blockNumber",
					params: [],
					timeoutMs: requestTimeoutMs,
				}).then((r) => ({ url, hex: r })),
			),
		);
		const latests: bigint[] = [];
		const latestFailures: Array<{ url: string; error: string }> = [];
		for (let i = 0; i < latestResults.length; i++) {
			const r = latestResults[i];
			if (r.status === "fulfilled" && r.value.hex != null) {
				latests.push(BigInt(r.value.hex));
			} else if (r.status === "fulfilled") {
				latestFailures.push({
					url: r.value.url,
					error: "null response from eth_blockNumber",
				});
			} else {
				latestFailures.push({
					url: verificationRpcs[i],
					error: String(r.reason),
				});
			}
		}
		if (latests.length < quorumThreshold) {
			throw new ConsensusQuorumNotMetError(latests.length, quorumThreshold, latestFailures);
		}
		// Lower median: robust to single-node lies in either direction under
		// honest-majority.
		latests.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
		const median = latests[Math.floor((latests.length - 1) / 2)];
		const subtracted = median - BigInt(syncTolerance);
		// Clamp to 0 so a large syncTolerance on an early-stage chain cannot
		// produce a negative block number (which would break hex formatting).
		resolvedBlockNumber = subtracted < 0n ? 0n : subtracted;
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
			// A node can legitimately return null for eth_getBlockByNumber when the
			// block does not exist on that chain (e.g., a verifier pointed at the
			// wrong network). Treat null as a failure so it surfaces as either a
			// quorum miss or, when other nodes did return data, a visible disagreement.
			if (r.value.header == null) {
				failures.push({
					url: r.value.url,
					error: `block ${blockHex} not found on node`,
				});
			} else if (BigInt(r.value.header.number) !== resolvedBlockNumber) {
				// A node returned a header for a different block number than the one
				// we asked for. Do not trust it as a response to our query; an honest
				// node should return the exact block we requested.
				failures.push({
					url: r.value.url,
					error: `block ${blockHex} number mismatch: node returned ${r.value.header.number}`,
				});
			} else {
				successes.push(r.value);
			}
		} else {
			failures.push({ url: verificationRpcs[i], error: String(r.reason) });
		}
	}

	if (successes.length < quorumThreshold) {
		throw new ConsensusQuorumNotMetError(successes.length, quorumThreshold, failures);
	}

	// Require unanimity on every header field, not just stateRoot. A malicious
	// node could otherwise report a correct stateRoot alongside a fabricated
	// blockHash / parentHash / timestamp, which callers may use downstream
	// (e.g., block-hash anchoring, reorg checks, timestamp-dependent logic).
	const ref = successes[0].header;
	const refN = {
		stateRoot: ref.stateRoot.toLowerCase(),
		hash: ref.hash.toLowerCase(),
		parentHash: ref.parentHash.toLowerCase(),
		timestamp: ref.timestamp,
	};
	const disagreeingFields = new Set<string>();
	for (const s of successes) {
		const h = s.header;
		if (h.stateRoot.toLowerCase() !== refN.stateRoot) disagreeingFields.add("stateRoot");
		if (h.hash.toLowerCase() !== refN.hash) disagreeingFields.add("blockHash");
		if (h.parentHash.toLowerCase() !== refN.parentHash) disagreeingFields.add("parentHash");
		if (h.timestamp !== refN.timestamp) disagreeingFields.add("timestamp");
	}
	if (disagreeingFields.size > 0) {
		const nodes: ConsensusDisagreementNode[] = successes.map((s) => ({
			url: s.url,
			stateRoot: s.header.stateRoot,
			blockHash: s.header.hash,
			parentHash: s.header.parentHash,
			timestamp: s.header.timestamp,
		}));
		throw new ConsensusHeaderDisagreementError([...disagreeingFields], nodes);
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
