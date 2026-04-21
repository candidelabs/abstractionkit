import { decodeRlp, getBytes } from "ethers";

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

export type MptNode =
	| {
			kind: "branch";
			/** 16 children (indices 0-15), each a 32-byte hash reference or empty string "0x". */
			children: string[];
			/** The value stored at this branch, if any. Empty "0x" means no value. */
			value: string;
			rlpEncoded: Uint8Array;
	  }
	| {
			kind: "extension";
			path: number[];
			/** Next node reference (32-byte hash or inline-encoded node for small nodes). */
			next: string;
			rlpEncoded: Uint8Array;
	  }
	| {
			kind: "leaf";
			path: number[];
			/** Leaf value as hex string. */
			value: string;
			rlpEncoded: Uint8Array;
	  };

/** Parse an RLP-encoded MPT node into a structured representation. */
export function parseMptNode(rlp: Uint8Array): MptNode {
	const decoded = decodeRlp(rlp);
	if (!Array.isArray(decoded)) {
		throw new Error(`Expected MPT node to be an RLP list, got ${typeof decoded}`);
	}

	if (decoded.length === 17) {
		const children = decoded.slice(0, 16) as string[];
		const value = decoded[16] as string;
		return { kind: "branch", children, value, rlpEncoded: rlp };
	}

	if (decoded.length === 2) {
		const encodedPathHex = decoded[0] as string;
		const encodedPath = hexToBytes(encodedPathHex);
		const leaf = PathEncoder.isLeaf(encodedPath);
		const path = PathEncoder.decode(encodedPath);
		const second = decoded[1] as string;
		return leaf
			? { kind: "leaf", path, value: second, rlpEncoded: rlp }
			: { kind: "extension", path, next: second, rlpEncoded: rlp };
	}

	throw new Error(`Invalid MPT node length: ${decoded.length}`);
}
