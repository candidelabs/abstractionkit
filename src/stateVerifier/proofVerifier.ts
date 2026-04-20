import { encodeRlp, keccak256 } from "ethers";
import { bytesEqual, hexToBytes, Nibbles, parseMptNode } from "./mpt";
import { AccountProofInvalidError } from "./errors";
import type { EthGetProofResult } from "./types";

/**
 * Walks an MPT proof from `rootHash`, following keccak256(key) as nibbles.
 *
 * Returns `true` if the proof is valid for the given key/expectedValue.
 * - If `expectedValue` is undefined or empty, proves absence of the key.
 * - If `expectedValue` is provided, the leaf must match bytewise.
 *
 * Throws on structural failures (hash mismatch, invalid RLP, invalid node shape).
 * The caller is expected to wrap thrown errors into domain-specific subclasses
 * (`AccountProofInvalidError` / `StorageProofInvalidError`).
 *
 * @internal
 */
export function verifyMptProof(params: {
  rootHash: Uint8Array;
  /** Un-hashed key. The walker hashes it with keccak256 before traversing. */
  key: Uint8Array;
  /** RLP-encoded node hex strings. */
  proof: string[];
  /** If undefined or empty, proves absence. */
  expectedValue?: Uint8Array;
}): boolean {
  const { rootHash, key, proof, expectedValue } = params;
  const keyHash = hexToBytes(keccak256(key));
  const keyNibbles = Nibbles.fromBytes(keyHash);

  let nibbleIndex = 0;
  let expectedHash = rootHash;

  for (let i = 0; i < proof.length; i++) {
    const nodeRlp = hexToBytes(proof[i]);

    // Verify this node hashes to what we expect. Nodes <32 bytes are inlined.
    const actualHash =
      nodeRlp.length >= 32 ? hexToBytes(keccak256(nodeRlp)) : nodeRlp;
    if (!bytesEqual(expectedHash, actualHash)) {
      throw new Error(
        `Hash mismatch at node ${i}: expected ${toHex(expectedHash)}, got ${toHex(actualHash)}`,
      );
    }

    const node = parseMptNode(nodeRlp);

    if (node.kind === "branch") {
      // All nibbles consumed -- value at index 16 is the answer.
      if (nibbleIndex >= keyNibbles.length) {
        return matchesExpected(node.value, expectedValue);
      }
      const nibble = keyNibbles[nibbleIndex];
      const child = node.children[nibble];
      if (!child || child === "0x") {
        // Path doesn't exist. Absence proof succeeds if expectedValue is empty.
        return !expectedValue || expectedValue.length === 0;
      }
      expectedHash = hexToBytes(child);
      nibbleIndex++;
      continue;
    }

    if (node.kind === "extension") {
      if (!Nibbles.match(keyNibbles, nibbleIndex, node.path)) {
        // Path diverges. Absence proof succeeds if expectedValue is empty.
        return !expectedValue || expectedValue.length === 0;
      }
      nibbleIndex += node.path.length;
      expectedHash = hexToBytes(node.next);
      continue;
    }

    // Leaf.
    if (!Nibbles.match(keyNibbles, nibbleIndex, node.path)) {
      return !expectedValue || expectedValue.length === 0;
    }
    if (nibbleIndex + node.path.length !== keyNibbles.length) {
      return false;
    }
    return matchesExpected(node.value, expectedValue);
  }

  return false;
}

function matchesExpected(valueHex: string, expectedValue: Uint8Array | undefined): boolean {
  const valueBytes = hexToBytes(valueHex);
  if (!expectedValue || expectedValue.length === 0) {
    return valueBytes.length === 0;
  }
  return bytesEqual(valueBytes, expectedValue);
}

function toHex(b: Uint8Array): string {
  return "0x" + Buffer.from(b).toString("hex");
}

/** Canonical empty storage trie root: keccak256(RLP("")) */
export const EMPTY_STORAGE_HASH =
  "0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421";

/** Canonical empty code hash: keccak256("") */
export const EMPTY_CODE_HASH =
  "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470";

const ZERO_HASH =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

function stripLeadingZeros(hex: string): string {
  let h = hex.replace(/^0x/, "").replace(/^0+/, "");
  if (h.length === 0) return "0x";
  if (h.length % 2 !== 0) h = "0" + h;
  return "0x" + h;
}

/** True if the four account fields represent an account absent from the trie. */
function isEmptyAccount(p: EthGetProofResult): boolean {
  const nonceZero = p.nonce === "0x0" || p.nonce === "0x";
  const balanceZero = p.balance === "0x0" || p.balance === "0x";
  const sh = p.storageHash.toLowerCase();
  const ch = p.codeHash.toLowerCase();
  const emptyStorage = sh === EMPTY_STORAGE_HASH || sh === ZERO_HASH;
  const emptyCode = ch === EMPTY_CODE_HASH || ch === ZERO_HASH;
  return nonceZero && balanceZero && emptyStorage && emptyCode;
}

/**
 * Verify an eth_getProof account proof against a state root.
 *
 * @param params.stateRoot 0x-prefixed 32-byte hex state root, typically from a
 *   consensus-verified block header.
 * @param params.address 0x-prefixed 20-byte hex address being verified.
 * @param params.proof The raw eth_getProof response (EIP-1186 shape).
 * @returns `true` if the proof is valid.
 * @throws AccountProofInvalidError on any structural or semantic failure.
 *
 * @example
 * const ok = verifyAccountProof({
 *   stateRoot: header.stateRoot,
 *   address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
 *   proof: await rpc("eth_getProof", [addr, [], blockHex]),
 * });
 */
export function verifyAccountProof(params: {
  stateRoot: string;
  address: string;
  proof: EthGetProofResult;
}): boolean {
  const { stateRoot, address, proof } = params;

  if (proof.address.toLowerCase() !== address.toLowerCase()) {
    throw new AccountProofInvalidError(
      address,
      stateRoot,
      0n,
      `proof.address ${proof.address} does not match requested address ${address}`,
    );
  }

  let expectedValue: Uint8Array | undefined;
  if (!isEmptyAccount(proof)) {
    // Account RLP = [nonce, balance, storageRoot, codeHash] per Yellow Paper.
    const rlpHex = encodeRlp([
      stripLeadingZeros(proof.nonce),
      stripLeadingZeros(proof.balance),
      proof.storageHash,
      proof.codeHash,
    ]);
    expectedValue = hexToBytes(rlpHex);
  }

  let result: boolean;
  try {
    result = verifyMptProof({
      rootHash: hexToBytes(stateRoot),
      key: hexToBytes(address),
      proof: proof.accountProof,
      expectedValue,
    });
  } catch (e) {
    throw new AccountProofInvalidError(
      address,
      stateRoot,
      0n,
      (e as Error).message,
    );
  }

  if (!result) {
    throw new AccountProofInvalidError(
      address,
      stateRoot,
      0n,
      "account proof does not match the provided state root",
    );
  }

  return true;
}
