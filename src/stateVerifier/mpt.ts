import { getBytes } from "ethers";

/** Half-byte (0..15) operations for Merkle Patricia Trie paths. */
export const Nibbles = {
  /** Convert raw bytes to an array of nibbles (each byte yields high then low). */
  fromBytes(bytes: Uint8Array): number[] {
    const out: number[] = new Array(bytes.length * 2);
    for (let i = 0; i < bytes.length; i++) {
      out[i * 2] = bytes[i] >> 4;
      out[i * 2 + 1] = bytes[i] & 0x0f;
    }
    return out;
  },

  /** True if `path` matches `key` starting at `keyOffset`. */
  match(key: number[], keyOffset: number, path: number[]): boolean {
    if (keyOffset + path.length > key.length) return false;
    for (let i = 0; i < path.length; i++) {
      if (key[keyOffset + i] !== path[i]) return false;
    }
    return true;
  },
};

/** Compact hex-prefix encoding / decoding of MPT node paths. */
export const PathEncoder = {
  /** Decode a compact-encoded path back to a nibble array. */
  decode(encodedPath: Uint8Array): number[] {
    const nibbles = Nibbles.fromBytes(encodedPath);
    const prefix = nibbles[0];
    // Even length: 0x0_ (extension) or 0x2_ (leaf).
    if (prefix === 0 || prefix === 2) return nibbles.slice(2);
    // Odd length: 0x1_ (extension) or 0x3_ (leaf).
    return nibbles.slice(1);
  },

  /** True if the encoded path represents a leaf node (vs an extension). */
  isLeaf(encodedPath: Uint8Array): boolean {
    return (encodedPath[0] & 0x20) !== 0;
  },
};

/** Convert an 0x-prefixed hex string to raw bytes. Empty "" or "0x" yields Uint8Array(0). */
export function hexToBytes(hex: string): Uint8Array {
  if (hex === "" || hex === "0x") return new Uint8Array(0);
  return getBytes(hex);
}

/** Strict equality on two byte arrays. */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
