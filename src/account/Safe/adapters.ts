import { getBytes, hexlify } from "ethers";
import type { Signer } from "src/signer/types";
import { SafeAccount } from "./SafeAccount";
import type { WebauthnPublicKey, WebauthnSignatureData } from "./types";

/**
 * Caller-supplied callback that runs the WebAuthn assertion ceremony for a
 * given challenge and returns the structured fields needed to encode a
 * Safe contract signature. The SDK passes the SafeOp digest as the
 * `challenge` so the authenticator signs over the same bytes Safe will
 * verify on-chain.
 *
 * Implementations typically wrap `navigator.credentials.get(...)` in
 * browsers, or an equivalent HSM/native bridge in other environments. The
 * SDK doesn't import `navigator` itself, so the adapter stays
 * environment-agnostic.
 */
export type WebauthnAssertionFetcher = (
	challenge: Uint8Array,
) => Promise<WebauthnSignatureData>;

/** Parameters for {@link fromSafeWebauthn}. */
export interface FromSafeWebauthnParams {
	/** WebAuthn public key (P-256 x/y coordinates) backing this signer. */
	publicKey: WebauthnPublicKey;
	/**
	 * Whether the UserOperation is the account's first one. When `true`, the
	 * signer's address is the WebAuthn shared signer (because the per-owner
	 * verifier proxy isn't deployed yet); when `false`, it's the
	 * deterministic verifier proxy address derived from `publicKey`.
	 * Typically computed by the caller as `userOperation.nonce === 0n`.
	 */
	isInit: boolean;
	/** Async callback that runs the WebAuthn ceremony for the SafeOp digest. */
	getAssertion: WebauthnAssertionFetcher;
	/**
	 * Account class whose `DEFAULT_WEB_AUTHN_*` statics source the adapter's
	 * defaults. Required: address derivation depends on Safe Passkey module
	 * version (v0.2.0 ships FCL P256, v0.2.1 ships Daimo P256 + RIP-7951
	 * precompile) and the wrong choice produces a signer address that isn't
	 * an on-chain owner, surfacing as a generic "Invalid UserOp signature"
	 * (`GS026` on-chain) with no offline diagnostic. Pass the same class you
	 * passed to `initializeNewAccount` — `SafeAccountV0_2_0` /
	 * `SafeAccountV0_3_0` for v0.2.0, or `SafeMultiChainSigAccountV1` for
	 * v0.2.1.
	 *
	 * Typed against just the static surface the adapter reads (not
	 * `typeof SafeAccount`) because Safe subclass constructors take fewer
	 * positional args than the base class — `typeof SafeAccountV0_3_0` is
	 * not assignable to `typeof SafeAccount`.
	 */
	accountClass: Pick<
		typeof SafeAccount,
		| "DEFAULT_WEB_AUTHN_SHARED_SIGNER"
		| "DEFAULT_WEB_AUTHN_SIGNER_FACTORY"
		| "DEFAULT_WEB_AUTHN_SIGNER_SINGLETON"
		| "DEFAULT_WEB_AUTHN_SIGNER_PROXY_CREATION_CODE"
		| "DEFAULT_WEB_AUTHN_PRECOMPILE"
		| "DEFAULT_WEB_AUTHN_CONTRACT_VERIFIER"
	>;
	/** Override the WebAuthn shared signer address used when `isInit`. Must match the value passed to `initializeNewAccount`. */
	webAuthnSharedSigner?: string;
	/** Override the WebAuthn signer factory used to derive the verifier proxy. Must match the value passed to `initializeNewAccount`. */
	webAuthnSignerFactory?: string;
	/** Override the WebAuthn signer singleton used to derive the verifier proxy. Must match the value passed to `initializeNewAccount`. */
	webAuthnSignerSingleton?: string;
	/** Override the WebAuthn signer proxy creation code used in the address derivation. Must match the value passed to `initializeNewAccount`. */
	webAuthnSignerProxyCreationCode?: string;
	/** Override the EIP-7212 precompile verifier used in the address derivation. Must match the value passed to `initializeNewAccount`. */
	eip7212WebAuthnPrecompileVerifier?: string;
	/** Override the EIP-7212 contract verifier used in the address derivation. Must match the value passed to `initializeNewAccount`. */
	eip7212WebAuthnContractVerifier?: string;
}

/**
 * Adapt a WebAuthn credential to a Signer for `signUserOperationWithSigners`
 * on Safe accounts. Safe-specific (uses Safe's WebAuthn shared signer /
 * verifier proxy / signature encoding) — for non-Safe accounts, use the
 * account's own WebAuthn adapter.
 *
 * Hides the address routing (shared signer for the init UserOp, per-owner
 * verifier proxy after that), the `type: "contract"` tag, and the
 * Safe-specific signature encoding. The caller supplies a
 * {@link FromSafeWebauthnParams.getAssertion} callback that runs the
 * actual WebAuthn ceremony — this is where you call
 * `navigator.credentials.get(...)` (browser) or an equivalent native
 * bridge, since the SDK doesn't import `navigator` itself.
 *
 * Only `signHash` is exposed: WebAuthn signs a flat challenge, so a typed-data
 * preview would never reach the authenticator anyway.
 *
 * **Override consistency.** Pass the same `accountClass` you passed to
 * `initializeNewAccount` so the adapter sources the right Safe Passkey
 * module defaults — v0.2.0 / FCL P256 for `SafeAccount` / `SafeAccountV0_2_0`
 * / `SafeAccountV0_3_0`, v0.2.1 / Daimo P256 + RIP-7951 for
 * `SafeMultiChainSigAccountV1`. Every individual WebAuthn override
 * (`webAuthnSharedSigner`, `webAuthnSignerFactory`, `webAuthnSignerSingleton`,
 * `webAuthnSignerProxyCreationCode`, `eip7212WebAuthnPrecompileVerifier`,
 * `eip7212WebAuthnContractVerifier`) must likewise match what was passed to
 * `InitCodeOverrides` at init time — only set them when you've also
 * overridden them at init. The on-chain owner set is locked to whatever was
 * used at init: `webAuthnSharedSigner` for `isInit=true`, the deterministic
 * verifier proxy derived from the other five for `isInit=false`. A mismatch
 * produces a signature pointing at an address that isn't an owner; on-chain
 * `checkSignatures` reverts with `GS026` and the bundler surfaces it as a
 * generic "Invalid UserOp signature" with no offline diagnostic.
 *
 * @example
 * import { fromSafeWebauthn, SafeAccountV0_3_0 } from "abstractionkit";
 *
 * // Pass `expectedSigners: [{ x, y }]` so createUserOperation picks the
 * // WebAuthn dummy signature for gas estimation. Without it, the
 * // bundler sizes verification gas against the EOA dummy and the
 * // real signed UserOp gets rejected (or under-budgeted on-chain) at submit.
 * let userOperation = await safe.createUserOperation(
 *   transactions, nodeUrl, bundlerUrl,
 *   { expectedSigners: [{ x, y }] },
 * );
 *
 * const signer = fromSafeWebauthn({
 *   publicKey: { x, y },
 *   isInit: userOperation.nonce === 0n,
 *   accountClass: SafeAccountV0_3_0, // SafeMultiChainSigAccountV1 for multi-chain
 *   getAssertion: async (challenge) => {
 *     const assertion = await navigator.credentials.get({
 *       publicKey: { challenge, rpId, allowCredentials, userVerification },
 *     });
 *     return {
 *       authenticatorData: assertion.response.authenticatorData,
 *       clientDataFields: extractClientDataFields(assertion.response),
 *       rs: extractSignature(assertion.response),
 *     };
 *   },
 * });
 * userOperation.signature = await safe.signUserOperationWithSigners(
 *   userOperation, [signer], chainId,
 * );
 */
export function fromSafeWebauthn(params: FromSafeWebauthnParams): Signer<unknown> {
	const {
		publicKey,
		isInit,
		getAssertion,
		accountClass,
		webAuthnSharedSigner,
		webAuthnSignerFactory,
		webAuthnSignerSingleton,
		webAuthnSignerProxyCreationCode,
		eip7212WebAuthnPrecompileVerifier,
		eip7212WebAuthnContractVerifier,
	} = params;

	// Guard against non-bigint coords: TS only enforces shape structurally,
	// so a pubkey round-tripped through JSON.parse (without a reviver) lands
	// here as strings. solidityPacked("uint256", ...) downstream silently
	// coerces decimal strings, mishandles unprefixed hex, and throws deep
	// inside ethers on malformed input — all manifesting as a wrong verifier
	// address with no offline diagnostic. Fail loudly at the boundary instead.
	if (typeof publicKey?.x !== "bigint" || typeof publicKey?.y !== "bigint") {
		throw new TypeError(
			"fromSafeWebauthn: publicKey.x and publicKey.y must be bigint. " +
				"If they round-tripped through JSON.parse, hydrate them back " +
				"to bigint first (e.g. BigInt(value) for decimal strings, or " +
				"use a JSON reviver).",
		);
	}

	// Source defaults from `accountClass` so subclasses with different Safe
	// Passkey module versions (e.g. SafeMultiChainSigAccountV1's v0.2.1 set)
	// are picked up automatically. `createWebAuthnSignerVerifierAddress`
	// itself falls back to the parent's v0.2.0 defaults for any field left
	// undefined, so we must resolve them here before forwarding.
	const address = isInit
		? (webAuthnSharedSigner ?? accountClass.DEFAULT_WEB_AUTHN_SHARED_SIGNER)
		: SafeAccount.createWebAuthnSignerVerifierAddress(publicKey.x, publicKey.y, {
				webAuthnSignerFactory:
					webAuthnSignerFactory ?? accountClass.DEFAULT_WEB_AUTHN_SIGNER_FACTORY,
				webAuthnSignerSingleton:
					webAuthnSignerSingleton ?? accountClass.DEFAULT_WEB_AUTHN_SIGNER_SINGLETON,
				webAuthnSignerProxyCreationCode:
					webAuthnSignerProxyCreationCode ??
					accountClass.DEFAULT_WEB_AUTHN_SIGNER_PROXY_CREATION_CODE,
				eip7212WebAuthnPrecompileVerifier:
					eip7212WebAuthnPrecompileVerifier ?? accountClass.DEFAULT_WEB_AUTHN_PRECOMPILE,
				eip7212WebAuthnContractVerifier:
					eip7212WebAuthnContractVerifier ?? accountClass.DEFAULT_WEB_AUTHN_CONTRACT_VERIFIER,
			});

	return {
		address: address as `0x${string}`,
		type: "contract",
		signHash: async (hash) => {
			const assertion = await getAssertion(getBytes(hash));
			return SafeAccount.createWebAuthnSignature(assertion) as `0x${string}`;
		},
	};
}

// ────────────────────────────────────────────────────────────────────────────
// WebAuthn pubkey JSON round-trip
// ────────────────────────────────────────────────────────────────────────────

/**
 * Coerce a `{ x, y }` pair where each coord may be `bigint`, hex string
 * (`"0x..."`), decimal string, or a safe-integer number into a canonical
 * {@link WebauthnPublicKey} with bigint coords. Used internally by
 * {@link pubkeyCoordinatesFromJson} — for non-JSON inputs (URL params,
 * RPC responses), pass the pre-parsed object straight to that helper.
 *
 * @throws if either coordinate is missing, the wrong type, or an
 * unparseable string.
 */
function toBigintPubkey(pubkey: {
	x: bigint | string | number;
	y: bigint | string | number;
}): WebauthnPublicKey {
	if (!pubkey || pubkey.x == null || pubkey.y == null) {
		throw new Error("toBigintPubkey: pubkey must be `{ x, y }` with both coords set");
	}
	return { x: coerceBigint(pubkey.x, "x"), y: coerceBigint(pubkey.y, "y") };
}

function coerceBigint(v: bigint | string | number, field: string): bigint {
	let coerced: bigint;
	if (typeof v === "bigint") {
		coerced = v;
	} else if (typeof v === "string") {
		try {
			coerced = BigInt(v);
		} catch {
			throw new Error(
				`toBigintPubkey: pubkey.${field} ("${v}") is not a valid bigint string. ` +
					"Accepted: non-negative bigint, decimal string, or 0x-prefixed hex string.",
			);
		}
	} else if (typeof v === "number") {
		if (!Number.isSafeInteger(v)) {
			throw new Error(
				`toBigintPubkey: pubkey.${field} is a Number but not a safe integer. ` +
					"Pass as bigint or hex string to avoid precision loss.",
			);
		}
		coerced = BigInt(v);
	} else {
		throw new Error(
			`toBigintPubkey: pubkey.${field} must be bigint, string, or number (got ${typeof v})`,
		);
	}
	// P-256 field elements are non-negative by definition. Reject negatives
	// at the coercion boundary so they can't reach `pubkeyCoordinatesToJson`,
	// which would emit an invalid `"0x-..."` string and break round-trip.
	if (coerced < 0n) {
		throw new Error(
			`toBigintPubkey: pubkey.${field} must be non-negative (got ${coerced.toString()}). ` +
				"P-256 coordinates are non-negative field elements; negative values aren't valid " +
				"and would break canonical JSON round-trip serialization.",
		);
	}
	return coerced;
}

/**
 * Serialize a WebAuthn pubkey to a JSON string with hex-encoded
 * coordinates. Inverse of {@link pubkeyCoordinatesFromJson}.
 *
 * Any JSON-string persistence — localStorage, backend indexes, query
 * strings, IPC payloads — eventually needs a custom replacer for
 * `bigint` (which `JSON.stringify` can't serialize on its own). This
 * helper ships the canonical version so the round-trip is consistent
 * across call sites.
 *
 * @example
 * ```ts
 * localStorage.setItem("passkey", pubkeyCoordinatesToJson({ x: 0x7a..., y: 0x2e... }));
 * // Stored as: {"x":"0x7a...","y":"0x2e..."}
 * ```
 */
export function pubkeyCoordinatesToJson(pubkey: WebauthnPublicKey): string {
	return JSON.stringify({
		x: `0x${pubkey.x.toString(16)}`,
		y: `0x${pubkey.y.toString(16)}`,
	});
}

/**
 * Parse a JSON string produced by {@link pubkeyCoordinatesToJson} (or
 * any JSON object with `x` / `y` fields as bigint-compatible values)
 * back into a {@link WebauthnPublicKey} with bigint coords.
 *
 * Lenient about input shape: accepts a JSON string, a pre-parsed object
 * (skip `JSON.parse` if you already ran it), and either hex (`"0x..."`)
 * or decimal-string coords. Same one-line cost regardless of where the
 * string came from — localStorage, backend response, query parameter.
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
): WebauthnPublicKey {
	const parsed = typeof input === "string" ? JSON.parse(input) : input;
	return toBigintPubkey(parsed);
}

// ────────────────────────────────────────────────────────────────────────────
// WebAuthn assertion normalizer
// ────────────────────────────────────────────────────────────────────────────

/**
 * Structural shape matching the browser `AuthenticatorAssertionResponse`,
 * `ox/WebAuthnP256` sign output, and `@simplewebauthn/browser`. Consumers
 * can pass any of these without an adapter-specific wrapper.
 *
 * Each field is normalized individually:
 * - `authenticatorData`: `ArrayBuffer` (raw browser API), `Uint8Array`
 *   (most libraries), or `0x`-prefixed hex string (`ox`).
 * - `clientDataJSON`: UTF-8 string (`ox` returns it pre-decoded), or
 *   buffer (raw browser API).
 * - `signature`: pre-decoded `{ r, s }` bigints (`ox` returns this), or a
 *   DER-encoded buffer (raw browser API).
 */
interface AuthenticatorAssertionLike {
	authenticatorData: ArrayBuffer | Uint8Array | string;
	clientDataJSON: ArrayBuffer | Uint8Array | string;
	signature: ArrayBuffer | Uint8Array | { r: bigint; s: bigint };
}

/**
 * Turn a structural {@link AuthenticatorAssertionLike} into
 * {@link WebauthnSignatureData}, ready to feed straight into
 * `SafeAccount.createWebAuthnSignature` or the `getAssertion` callback
 * of `fromSafeWebauthn`.
 *
 * Replaces the ~13-line manual pipeline every Safe-passkeys consumer
 * has been writing — `JSON.parse` of `clientDataJSON`, destructure +
 * re-serialize the non-`type` / non-`challenge` fields, hex-encode,
 * normalize `authenticatorData`, parse DER signature → `(r, s)` —
 * with a single call.
 *
 * @example Browser:
 * ```ts
 * const assertion = await navigator.credentials.get({...});
 * return webauthnSignatureFromAssertion(assertion.response);
 * ```
 *
 * @example `ox/WebAuthnP256`:
 * ```ts
 * const { metadata, signature } = await sign({ challenge, credentialId });
 * return webauthnSignatureFromAssertion({
 *   authenticatorData: metadata.authenticatorData, // hex string from ox
 *   clientDataJSON: metadata.clientDataJSON,       // string from ox
 *   signature,                                      // { r, s } from ox
 * });
 * ```
 */
export function webauthnSignatureFromAssertion(
	response: AuthenticatorAssertionLike,
): WebauthnSignatureData {
	const authenticatorData = toArrayBuffer(response.authenticatorData);
	const clientDataJSON = toUtf8String(response.clientDataJSON);
	const rs = toRSPair(response.signature);
	return {
		authenticatorData,
		clientDataFields: extractClientDataFieldsHex(clientDataJSON),
		rs: [rs.r, rs.s],
	};
}

// ────────────────────────────────────────────────────────────────────────────
// Internal: input normalization
// ────────────────────────────────────────────────────────────────────────────

function toArrayBuffer(input: ArrayBuffer | Uint8Array | string): ArrayBuffer {
	// ethers' `getBytes` validates hex format and returns a fresh
	// Uint8Array; it doesn't accept ArrayBuffer though, so we handle
	// that one case manually. Same byte-for-byte output as the previous
	// hand-rolled `hexToBytes` plus regex validation.
	if (input instanceof ArrayBuffer) return input;
	const bytes = getBytes(input);
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function toUtf8String(input: ArrayBuffer | Uint8Array | string): string {
	if (typeof input === "string") return input;
	const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
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
		typeof (input as { r: unknown }).r === "bigint" &&
		typeof (input as { s: unknown }).s === "bigint"
	) {
		return { r: (input as { r: bigint }).r, s: (input as { s: bigint }).s };
	}
	const bytes = input instanceof Uint8Array ? input : new Uint8Array(input as ArrayBuffer);
	return parseDerP256Signature(bytes);
}

/**
 * Re-serialize every clientDataJSON field except `type` and `challenge`.
 * Robust to authenticators adding or reordering keys (e.g. Safari's
 * `crossOrigin`, future WebAuthn L3 fields) — parses JSON instead of
 * using a regex, validates the shape is a plain object, and emits hex
 * via `TextEncoder` (browser-safe; `Buffer` isn't defined in Vite /
 * Rollup / esbuild bundles without a polyfill).
 */
function extractClientDataFieldsHex(clientDataJSON: string): string {
	let parsed: unknown;
	try {
		parsed = JSON.parse(clientDataJSON);
	} catch (err) {
		throw new Error(
			`webauthnSignatureFromAssertion: clientDataJSON is not valid JSON (${(err as Error).message})`,
		);
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new Error(
			"webauthnSignatureFromAssertion: clientDataJSON must parse to a plain object " +
				`(got ${parsed === null ? "null" : Array.isArray(parsed) ? "array" : typeof parsed})`,
		);
	}
	const { type: _type, challenge: _challenge, ...rest } = parsed as Record<string, unknown>;
	const fields = Object.entries(rest)
		.map(([key, value]) => `"${key}":${JSON.stringify(value)}`)
		.join(",");
	// `hexlify` mirrors what the prior hand-rolled hex loop produced —
	// each byte gets exactly 2 lowercase hex chars, no separators, `0x`
	// prefix. Confirmed identical for all input sizes via the test suite.
	return hexlify(new TextEncoder().encode(fields));
}

/**
 * Parse a DER-encoded ECDSA P-256 signature into `(r, s)` bigints with
 * low-S normalization. Defends against truncated / malformed DER: every
 * length and tag is bounds-checked against the buffer before slicing,
 * because `Uint8Array.subarray` silently clamps OOB indices and would
 * otherwise produce attacker-controlled-length r/s.
 *
 * DER layout:
 *   0x30 | total-len | 0x02 | r-len | r-bytes | 0x02 | s-len | s-bytes
 */
function parseDerP256Signature(der: Uint8Array): { r: bigint; s: bigint } {
	const malformed = () =>
		new Error("webauthnSignatureFromAssertion: malformed DER signature");
	if (der.length < 8 || der[0] !== 0x30) throw malformed();

	// Validate the outer SEQUENCE length up front so trailing garbage and
	// length under/overstatement can't survive to the bigint conversion.
	const headerLen = der[1] === 0x81 ? 3 : 2;
	const outerLen = der[1] === 0x81 ? der[2] : der[1];
	if (der.length !== headerLen + outerLen) throw malformed();
	let offset = headerLen;

	// r tag + length + body must fit
	if (offset + 2 > der.length) throw malformed();
	if (der[offset] !== 0x02) throw malformed();
	const rLen = der[offset + 1];
	if (rLen <= 0 || offset + 2 + rLen > der.length) throw malformed();
	const rBytes = der.subarray(offset + 2, offset + 2 + rLen);
	offset += 2 + rLen;

	// s tag + length + body must fit
	if (offset + 2 > der.length) throw malformed();
	if (der[offset] !== 0x02) throw malformed();
	const sLen = der[offset + 1];
	if (sLen <= 0 || offset + 2 + sLen > der.length) throw malformed();
	const sBytes = der.subarray(offset + 2, offset + 2 + sLen);
	// No bytes may follow `s` inside the SEQUENCE.
	if (offset + 2 + sLen !== der.length) throw malformed();

	// `hexlify(empty)` returns "0x" which BigInt rejects; preserve the
	// 0n short-circuit. For DER-parsed r/s the bytes are non-empty by
	// the rLen/sLen > 0 checks above, but keep the guard explicit.
	const r = rBytes.length === 0 ? 0n : BigInt(hexlify(rBytes));
	let s = sBytes.length === 0 ? 0n : BigInt(hexlify(sBytes));

	// Low-S normalize: some authenticators return the high-S form; the
	// Safe WebAuthn verifier and most P-256 checkers accept only low-S.
	const P256_N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
	const P256_N_HALF = P256_N >> 1n;
	if (s > P256_N_HALF) s = P256_N - s;

	return { r, s };
}
