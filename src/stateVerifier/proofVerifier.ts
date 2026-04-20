import { keccak256 } from "ethers";
import { bytesEqual, hexToBytes, Nibbles, parseMptNode } from "./mpt";

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
