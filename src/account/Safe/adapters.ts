import { getBytes } from "ethers";
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
 * **Override consistency.** Every WebAuthn-related override on
 * {@link FromSafeWebauthnParams} (shared signer, signer factory/singleton,
 * proxy creation code, EIP-7212 precompile/contract verifier) must match
 * the value passed to `InitCodeOverrides` at `initializeNewAccount` time.
 * The on-chain owner set is locked to whatever was used at init —
 * `webAuthnSharedSigner` for `isInit=true`, the deterministic verifier
 * proxy derived from the other five for `isInit=false`. A mismatch
 * produces a signature pointing at an address that isn't an owner;
 * on-chain `checkSignatures` reverts with `GS026` and the bundler
 * surfaces it as a generic "Invalid UserOp signature" with no offline
 * diagnostic. If you stick to defaults at both call sites you're fine —
 * only set these when you've also overridden them at init.
 *
 * @example
 * import { fromSafeWebauthn } from "abstractionkit";
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

	const address = isInit
		? (webAuthnSharedSigner ?? SafeAccount.DEFAULT_WEB_AUTHN_SHARED_SIGNER)
		: SafeAccount.createWebAuthnSignerVerifierAddress(publicKey.x, publicKey.y, {
				webAuthnSignerFactory,
				webAuthnSignerSingleton,
				webAuthnSignerProxyCreationCode,
				eip7212WebAuthnPrecompileVerifier,
				eip7212WebAuthnContractVerifier,
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
