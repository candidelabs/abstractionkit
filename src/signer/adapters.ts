import { getAddress, Wallet } from "ethers";
import type {
	Signer,
	TypedData,
	WebAuthnAssertion,
	WebauthnPublicKeyCoordinates,
} from "./types";

// Structural types for well-known signers. NO imports from viem / ethers
// at the type level (beyond the already-present ethers runtime dep used by
// fromPrivateKey); these shapes match their public APIs so users can pass
// an instance directly.

/**
 * Shape matching viem's `PrivateKeyAccount` / `LocalAccount`.
 *
 * @remarks Requires viem &gt;= 2.0 (the `sign({ hash })` method was added in
 * the 2.0 account refactor; viem 1.x errors structurally).
 * @internal Pass concrete viem instances to {@link fromViem}. For wrapper
 * typing, use `Parameters<typeof fromViem>[0]`.
 */
export interface ViemLocalAccountLike {
	address: `0x${string}`;
	sign: (args: { hash: `0x${string}` }) => Promise<`0x${string}`>;
	signTypedData: (args: {
		domain: TypedData["domain"];
		types: Record<string, Array<{ name: string; type: string }>>;
		primaryType: string;
		message: Record<string, unknown>;
	}) => Promise<`0x${string}`>;
}

/**
 * Minimal shape required by {@link fromViemWalletClient}: `account.address`
 * read structurally, `signTypedData` cast locally inside the adapter because
 * viem's const generics can't be reproduced without re-exporting viem's
 * types. Runtime call shape is stable across viem 2.x.
 *
 * @remarks Requires viem &gt;= 2.0.
 * @internal Pass concrete `WalletClient` instances to {@link fromViemWalletClient}.
 */
export interface ViemWalletClientLike {
	account?: { address: `0x${string}` } | undefined;
	signTypedData: unknown;
}

/**
 * Internal shape that viem's `signTypedData` conforms to at runtime.
 * Used only inside {@link fromViemWalletClient}.
 */
type ViemSignTypedDataCall = (args: {
	account: { address: `0x${string}` } | `0x${string}`;
	domain: TypedData["domain"];
	types: TypedData["types"];
	primaryType: string;
	message: Record<string, unknown>;
}) => Promise<`0x${string}`>;

/**
 * Shape matching ethers `Wallet` / `HDNodeWallet`. Parameter types
 * deliberately widen ethers' `TypedDataDomain` / `TypedDataField[]` so the
 * interface doesn't import from ethers while still accepting a Wallet
 * instance without casts.
 *
 * @remarks Requires ethers &gt;= 6.0 (ethers 5.x used private `_signTypedData`).
 * @internal Pass concrete `Wallet` / `HDNodeWallet` instances to {@link fromEthersWallet}.
 */
export interface EthersWalletLike {
	address: string;
	signingKey: {
		sign: (hash: string) => { serialized: string };
	};
	signTypedData: (
		domain: {
			name?: string;
			version?: string;
			chainId?: number | bigint;
			verifyingContract?: string;
			salt?: string;
		},
		types: Record<string, Array<{ name: string; type: string }>>,
		message: Record<string, unknown>,
	) => Promise<string>;
}

/**
 * Build a Signer from a raw private-key hex string. Supports both raw-hash
 * and typed-data signing, via the library's existing ethers dep (no extra
 * packages needed). If you already hold a viem Account or ethers Wallet,
 * use {@link fromViem} or {@link fromEthersWallet} instead.
 *
 * @example
 * import { fromPrivateKey } from "abstractionkit";
 * const signer = fromPrivateKey(process.env.PRIVATE_KEY!);
 * userOp.signature = await safe.signUserOperationWithSigners(userOp, [signer], chainId);
 */
export function fromPrivateKey(privateKey: string): Signer<unknown> {
	const wallet = new Wallet(privateKey);
	return {
		address: getAddress(wallet.address) as `0x${string}`,
		signHash: async (hash) => wallet.signingKey.sign(hash).serialized as `0x${string}`,
		signTypedData: async (td) =>
			(await wallet.signTypedData(td.domain, td.types, td.message)) as `0x${string}`,
	};
}

/**
 * Adapt a viem Local Account (e.g. `privateKeyToAccount(pk)`) to a Signer.
 * Supports both raw-hash and typed-data signing.
 *
 * @remarks Requires viem &gt;= 2.0.
 */
export function fromViem(account: ViemLocalAccountLike): Signer<unknown> {
	return {
		address: account.address,
		signHash: (hash) => account.sign({ hash }),
		signTypedData: (td) =>
			account.signTypedData({
				domain: td.domain,
				types: td.types,
				primaryType: td.primaryType,
				message: td.message,
			}),
	};
}

/**
 * Adapt a viem `WalletClient` to a Signer. Only typed-data signing is
 * exposed, because `WalletClient` drives browser/JSON-RPC wallets which
 * can't sign raw hashes. Requires the client to have been constructed with
 * an `account`; for local accounts, prefer `fromViem` so you also get
 * raw-hash fallback.
 *
 * @remarks Requires viem &gt;= 2.0.
 */
export function fromViemWalletClient(client: ViemWalletClientLike): Signer<unknown> {
	if (!client.account) {
		throw new Error(
			"fromViemWalletClient: client has no `account` configured. " +
				"Construct with `createWalletClient({ account, transport, chain })`.",
		);
	}
	// Capture the full account object: passing just the address would force
	// viem to route to `eth_signTypedData_v4` (fails on HTTP transports),
	// whereas the object may carry local signing methods.
	const account = client.account;
	const signTypedData = client.signTypedData as ViemSignTypedDataCall;
	return {
		address: account.address,
		signTypedData: (td) =>
			signTypedData({
				account,
				domain: td.domain,
				types: td.types,
				primaryType: td.primaryType,
				message: td.message,
			}),
	};
}

/**
 * Adapt an ethers `Wallet` / `HDNodeWallet` to a Signer. Supports both
 * raw-hash and typed-data signing.
 *
 * @remarks Requires ethers &gt;= 6.0.
 */
export function fromEthersWallet(wallet: EthersWalletLike): Signer<unknown> {
	// ethers types `address` as plain `string`; at runtime it's always
	// checksummed 0x-prefixed hex.
	return {
		address: wallet.address as `0x${string}`,
		signHash: async (hash) => wallet.signingKey.sign(hash).serialized as `0x${string}`,
		signTypedData: async (td) =>
			(await wallet.signTypedData(td.domain, td.types, td.message)) as `0x${string}`,
	};
}

// ────────────────────────────────────────────────────────────────────────────
// WebAuthn adapter
// ────────────────────────────────────────────────────────────────────────────

/**
 * Structural shape matching the browser `AuthenticatorAssertionResponse`,
 * `ox/WebAuthnP256` sign output, `@simplewebauthn/browser`, and raw
 * `navigator.credentials.get()` results. Consumers can pass any of these
 * without an adapter-specific wrapper.
 *
 * The three fields are normalized individually: `authenticatorData` may be
 * an `ArrayBuffer` (browser) or `Uint8Array` (libraries); `clientDataJSON`
 * may be a UTF-8 string (already-decoded, as `ox` returns) or a buffer (raw
 * browser API); `signature` may be pre-decoded `{ r, s }` bigints (as `ox`
 * returns) or a DER-encoded buffer (raw browser API).
 */
export interface AuthenticatorAssertionResponseLike {
	authenticatorData: ArrayBuffer | Uint8Array;
	clientDataJSON: ArrayBuffer | Uint8Array | string;
	signature: ArrayBuffer | Uint8Array | { r: bigint; s: bigint };
}

/**
 * Turn a structural {@link AuthenticatorAssertionResponseLike} into a
 * normalized {@link WebAuthnAssertion}. The inverse of `ox` / raw-browser
 * plumbing. Works for consumers building custom WebAuthn flows (server-side
 * ceremony, transcript replay) who don't want the full {@link fromWebAuthn}
 * signer.
 *
 * @example
 * ```ts
 * import { webauthnSignatureFromAssertion } from "abstractionkit";
 * const assertion = webauthnSignatureFromAssertion(response);
 * // assertion: { authenticatorData: Uint8Array, clientDataJSON: string, signature: { r, s } }
 * ```
 */
export function webauthnSignatureFromAssertion(
	response: AuthenticatorAssertionResponseLike,
): WebAuthnAssertion {
	return {
		authenticatorData: toUint8Array(response.authenticatorData),
		clientDataJSON: toUtf8String(response.clientDataJSON),
		signature: toRSPair(response.signature),
	};
}

/**
 * Optional custom sign function for {@link fromWebAuthn}. Defaults to
 * `navigator.credentials.get(...)` on the browser. Supply this for Node
 * (server-side ceremony), tests, or any environment without
 * `navigator.credentials`.
 *
 * The challenge passed in is the raw 32-byte UserOperation hash, already
 * decoded to bytes — pass it directly to the WebAuthn API as
 * `publicKey.challenge`.
 */
export type WebAuthnSignFn = (
	challenge: Uint8Array,
) => Promise<AuthenticatorAssertionResponseLike>;

/**
 * Adapter options for {@link fromWebAuthn}.
 */
export interface FromWebAuthnOptions {
	/**
	 * Base64url-encoded credential id (as returned by
	 * `navigator.credentials.create().id`). Used to narrow
	 * `allowCredentials` on the assertion ceremony.
	 */
	credentialId: string;
	/**
	 * P-256 public-key coordinates extracted from the credential. Safe and
	 * Calibur derive the on-chain signer identity deterministically from
	 * these values. Accepts `bigint` or string coords: hex (`"0x..."`) or
	 * decimal strings are coerced via `BigInt()`. This handles the common
	 * case where `{ x, y }` has been JSON-round-tripped through
	 * localStorage / backend / network boundary and ended up as strings.
	 */
	pubkey: {
		x: bigint | string;
		y: bigint | string;
	};
	/**
	 * Override the default browser ceremony. Supply for Node /
	 * server-side / test harnesses. If omitted, uses
	 * `navigator.credentials.get({ publicKey: { challenge, allowCredentials,
	 * userVerification: "required" } })`.
	 */
	signFn?: WebAuthnSignFn;
}

/**
 * Build an {@link Signer} backed by a WebAuthn passkey. Accepts any signer
 * that matches the `AuthenticatorAssertionResponse` shape — raw
 * `navigator.credentials`, `ox/WebAuthnP256`, `@simplewebauthn/browser`, or
 * `viem/webauthn` all work.
 *
 * The returned signer reports `ACCEPTED_SIGNING_SCHEMES` as `["webauthn"]`
 * via its `signWebauthn` method. Passing it to an account that only
 * accepts `["hash"]` (Simple7702) fails offline with an actionable error
 * instead of a silent bundler rejection.
 *
 * @example Safe (browser, defaults):
 * ```ts
 * import { fromWebAuthn } from "abstractionkit";
 * const signer = fromWebAuthn({
 *   credentialId: passkey.id,
 *   pubkey: passkey.pubkeyCoordinates,
 * });
 * userOp.signature = await safe.signUserOperationWithSigners(
 *   userOp, [signer], chainId,
 * );
 * ```
 *
 * @example Server-side / Node (inject `signFn`):
 * ```ts
 * const signer = fromWebAuthn({
 *   credentialId,
 *   pubkey,
 *   signFn: async (challenge) => await myServerCeremony(challenge),
 * });
 * ```
 */
export function fromWebAuthn(opts: FromWebAuthnOptions): Signer<unknown> {
	if (!opts || typeof opts.credentialId !== "string" || opts.credentialId.length === 0) {
		throw new Error("fromWebAuthn: `credentialId` (base64url string) is required");
	}
	const pubkey = toBigintPubkey(opts?.pubkey);

	const signFn: WebAuthnSignFn = opts.signFn ?? defaultBrowserSignFn(opts.credentialId);

	return {
		pubkey,
		signWebauthn: async (challenge) => {
			const challengeBytes = hexToBytes(challenge);
			const response = await signFn(challengeBytes);
			return webauthnSignatureFromAssertion(response);
		},
	};
}

/**
 * Coerce a `{ x, y }` pair with any mix of `bigint` / `0x…` hex / decimal
 * string values to a canonical `WebauthnPublicKeyCoordinates`. Used
 * internally by {@link fromWebAuthn}; also exported for consumers
 * reading the coords out of storage paths where they may have ended up
 * as strings.
 *
 * @throws if either coordinate is missing, the wrong type, or an
 * unparseable string.
 */
export function toBigintPubkey(pubkey: {
	x: bigint | string | number;
	y: bigint | string | number;
}): WebauthnPublicKeyCoordinates {
	if (!pubkey || pubkey.x == null || pubkey.y == null) {
		throw new Error("fromWebAuthn: `pubkey` must be `{ x, y }` with both coords set");
	}
	return { x: coerceBigint(pubkey.x, "x"), y: coerceBigint(pubkey.y, "y") };
}

function coerceBigint(v: bigint | string | number, field: string): bigint {
	if (typeof v === "bigint") return v;
	if (typeof v === "string") {
		try {
			return BigInt(v);
		} catch {
			throw new Error(
				`fromWebAuthn: pubkey.${field} ("${v}") is not a valid bigint string. ` +
					`Accepted: bigint, decimal string, or 0x-prefixed hex string.`,
			);
		}
	}
	if (typeof v === "number") {
		if (!Number.isSafeInteger(v)) {
			throw new Error(
				`fromWebAuthn: pubkey.${field} is a Number but not a safe integer. ` +
					`Pass as bigint or hex string to avoid precision loss.`,
			);
		}
		return BigInt(v);
	}
	throw new Error(`fromWebAuthn: pubkey.${field} must be bigint, string, or number (got ${typeof v})`);
}

// ────────────────────────────────────────────────────────────────────────────
// Bigint-safe pubkey JSON round-trip helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Serialize a WebAuthn pubkey to a JSON string with hex-encoded
 * coordinates. Inverse of {@link pubkeyCoordinatesFromJson}.
 *
 * `JSON.stringify` can't serialize `bigint` without a custom replacer,
 * and every consumer persisting `{ x, y }` ends up writing the same
 * replacer. This helper ships the canonical version so the round-trip
 * is consistent across call sites.
 *
 * @example
 * ```ts
 * localStorage.setItem("passkey", pubkeyCoordinatesToJson({ x: 0x7a..., y: 0x2e... }));
 * // Stored as: {"x":"0x7a...","y":"0x2e..."}
 * ```
 */
export function pubkeyCoordinatesToJson(pubkey: WebauthnPublicKeyCoordinates): string {
	return JSON.stringify({
		x: "0x" + pubkey.x.toString(16),
		y: "0x" + pubkey.y.toString(16),
	});
}

/**
 * Parse a JSON string produced by {@link pubkeyCoordinatesToJson} (or
 * any JSON object with `x` / `y` fields as bigint-compatible strings)
 * back into a `WebauthnPublicKeyCoordinates` with `bigint` coords.
 *
 * Lenient about input shape — accepts hex (`"0x..."`) or decimal
 * strings, as well as a pre-parsed object if you already ran
 * `JSON.parse` yourself.
 *
 * @example
 * ```ts
 * const raw = localStorage.getItem("passkey");
 * if (raw) {
 *   const pubkey = pubkeyCoordinatesFromJson(raw);
 *   // pubkey: { x: bigint, y: bigint }
 * }
 * ```
 */
export function pubkeyCoordinatesFromJson(
	input: string | { x: bigint | string | number; y: bigint | string | number },
): WebauthnPublicKeyCoordinates {
	const parsed = typeof input === "string" ? JSON.parse(input) : input;
	return toBigintPubkey(parsed);
}

// ────────────────────────────────────────────────────────────────────────────
// WebAuthn internals (browser default + normalization helpers)
// ────────────────────────────────────────────────────────────────────────────

function defaultBrowserSignFn(credentialId: string): WebAuthnSignFn {
	return async (challenge) => {
		if (typeof navigator === "undefined" || !navigator.credentials?.get) {
			throw new Error(
				"fromWebAuthn: `navigator.credentials.get` is not available in this environment. " +
					"Pass an explicit `signFn` for Node / server-side / test usage.",
			);
		}
		const credIdBytes = base64UrlToBytes(credentialId);
		// `navigator.credentials.get` requires `BufferSource`, which is
		// `ArrayBufferView | ArrayBuffer`. Uint8Array is an ArrayBufferView,
		// so no copy is needed in the browser.
		const credential = (await navigator.credentials.get({
			publicKey: {
				challenge,
				allowCredentials: [{ id: credIdBytes, type: "public-key" }],
				userVerification: "required",
			},
		})) as (PublicKeyCredential & { response: AuthenticatorAssertionResponse }) | null;
		if (!credential) {
			throw new Error("fromWebAuthn: navigator.credentials.get returned null");
		}
		return credential.response;
	};
}

function toUint8Array(input: ArrayBuffer | Uint8Array): Uint8Array {
	return input instanceof Uint8Array ? input : new Uint8Array(input);
}

function toUtf8String(input: ArrayBuffer | Uint8Array | string): string {
	if (typeof input === "string") return input;
	const bytes = toUint8Array(input);
	// TextDecoder is available in all modern browsers and Node 11+.
	return new TextDecoder("utf-8").decode(bytes);
}

function toRSPair(
	input: ArrayBuffer | Uint8Array | { r: bigint; s: bigint },
): { r: bigint; s: bigint } {
	if (
		input !== null &&
		typeof input === "object" &&
		"r" in input &&
		"s" in input &&
		typeof (input as { r: bigint }).r === "bigint" &&
		typeof (input as { s: bigint }).s === "bigint"
	) {
		return { r: (input as { r: bigint }).r, s: (input as { s: bigint }).s };
	}
	const bytes = toUint8Array(input as ArrayBuffer | Uint8Array);
	return parseDerP256Signature(bytes);
}

/**
 * Parse a DER-encoded ECDSA P-256 signature into its (r, s) bigint pair,
 * with low-S normalization (per BIP-62 / WebAuthn spec expectations). The
 * curve order n is fixed for P-256.
 *
 * DER layout: 0x30 | total-len | 0x02 | r-len | r-bytes | 0x02 | s-len | s-bytes
 */
function parseDerP256Signature(der: Uint8Array): { r: bigint; s: bigint } {
	if (der.length < 8 || der[0] !== 0x30) {
		throw new Error("fromWebAuthn: malformed DER signature");
	}
	let offset = 2;
	if (der[1] === 0x81) offset = 3; // long-form length byte we can skip
	if (der[offset] !== 0x02) throw new Error("fromWebAuthn: malformed DER signature (r tag)");
	const rLen = der[offset + 1];
	const rBytes = der.subarray(offset + 2, offset + 2 + rLen);
	offset += 2 + rLen;
	if (der[offset] !== 0x02) throw new Error("fromWebAuthn: malformed DER signature (s tag)");
	const sLen = der[offset + 1];
	const sBytes = der.subarray(offset + 2, offset + 2 + sLen);

	const r = bytesToBigInt(rBytes);
	let s = bytesToBigInt(sBytes);

	// Low-S normalize: some authenticators return the high-S form; the Safe
	// WebAuthn verifier and most P-256 checkers accept only the low-S form.
	const P256_N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
	const P256_N_HALF = P256_N >> 1n;
	if (s > P256_N_HALF) s = P256_N - s;

	return { r, s };
}

function bytesToBigInt(bytes: Uint8Array): bigint {
	let hex = "0x";
	for (const b of bytes) hex += b.toString(16).padStart(2, "0");
	return hex === "0x" ? 0n : BigInt(hex);
}

function hexToBytes(hex: `0x${string}`): Uint8Array {
	const body = hex.slice(2);
	if (body.length % 2 !== 0) throw new Error("fromWebAuthn: invalid hex challenge length");
	const out = new Uint8Array(body.length / 2);
	for (let i = 0; i < out.length; i++) {
		out[i] = Number.parseInt(body.slice(i * 2, i * 2 + 2), 16);
	}
	return out;
}

function base64UrlToBytes(s: string): Uint8Array {
	// Restore standard base64 alphabet and pad.
	const padded = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(s.length + ((4 - (s.length % 4)) % 4), "=");
	// Buffer (Node) and atob (browser) both handle this; prefer atob for
	// zero-dep feel, fall back to Buffer when running in Node.
	const bin =
		typeof atob === "function"
			? atob(padded)
			: typeof Buffer !== "undefined"
				? Buffer.from(padded, "base64").toString("binary")
				: (() => {
						throw new Error("fromWebAuthn: no base64 decoder available");
					})();
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}
