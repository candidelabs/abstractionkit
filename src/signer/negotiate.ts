import { AbstractionKitError } from "../errors";
import type { Signer, SigningScheme, TypedData, WebAuthnAssertion } from "./types";

/**
 * Pick the best mutually-supported signing scheme for one signer against an
 * account's accepted schemes. Later in the `accepted` array = lower preference;
 * the account ranks by preference.
 *
 * Throws a detailed {@link AbstractionKitError} if no scheme overlaps,
 * citing the signer's address, what the account accepts, and what the
 * signer can do.
 */
export function pickScheme<C>(
	signer: Signer<C>,
	accepted: readonly SigningScheme[],
	context: { accountName: string; signerIndex: number },
): SigningScheme {
	// Typeof-check (not truthiness) so malformed signers like
	// `{ signHash: true }` from JS callers bypassing types get a clear
	// AbstractionKitError here instead of a raw TypeError at the call site.
	const signerCan: SigningScheme[] = [];
	if (typeof signer.signTypedData === "function") signerCan.push("typedData");
	if (typeof signer.signHash === "function") signerCan.push("hash");
	if (typeof signer.signWebauthn === "function") signerCan.push("webauthn");

	for (const scheme of accepted) {
		if (signerCan.includes(scheme)) return scheme;
	}

	throw new AbstractionKitError(
		"BAD_DATA",
		buildMismatchMessage({
			accountName: context.accountName,
			signerIndex: context.signerIndex,
			signerIdentity: describeSignerIdentity(signer),
			accepted,
			signerCan,
		}),
	);
}

function describeSignerIdentity<C>(signer: Signer<C>): string {
	if (typeof signer.signWebauthn === "function" && signer.pubkey) {
		// Identify WebAuthn signers by a short hex of the x-coordinate so
		// error messages distinguish them without leaking the full pubkey.
		const xHex = signer.pubkey.x.toString(16).padStart(64, "0");
		return `webauthn(x=0x${xHex.slice(0, 8)}…${xHex.slice(-8)})`;
	}
	return signer.address as string;
}

function buildMismatchMessage(params: {
	accountName: string;
	signerIndex: number;
	signerIdentity: string;
	accepted: readonly SigningScheme[];
	signerCan: SigningScheme[];
}): string {
	const { accountName, signerIndex, signerIdentity, accepted, signerCan } = params;
	const canStr = signerCan.length > 0 ? signerCan.join(", ") : "none";
	return (
		`No compatible signing scheme for signer[${signerIndex}] ${signerIdentity}. ` +
		`${accountName} accepts: [${accepted.join(", ")}]; signer provides: [${canStr}]. ` +
		(signerCan.length === 0
			? "Signer must implement at least one of `signHash`, `signTypedData`, or `signWebauthn`. "
			: "") +
		"Hint: `fromViem` / `fromEthersWallet` give both `hash` and `typedData`; " +
		"`fromViemWalletClient` gives only `typedData` (use Safe for JSON-RPC wallets); " +
		"`fromWebAuthn` gives `webauthn` (Safe and Calibur only)."
	);
}

/**
 * Invoke a signer for a hash / typedData scheme. Keeps the dispatch in one
 * place so the account-side code stays linear. `typedData` is optional:
 * accounts that only accept the `"hash"` scheme (Simple7702, Calibur) pass
 * just `hash`.
 *
 * For `"webauthn"`, use {@link invokeWebauthnSigner} — the return type
 * differs (raw assertion vs. hex signature).
 *
 * `context` is always forwarded to the signer so power-user implementations
 * can inspect the userOp.
 */
export async function invokeSigner<C>(
	signer: Signer<C>,
	scheme: SigningScheme,
	payload: {
		hash: `0x${string}`;
		typedData?: TypedData;
		context: C;
	},
): Promise<`0x${string}`> {
	if (scheme === "webauthn") {
		throw new AbstractionKitError(
			"BAD_DATA",
			"invokeSigner cannot dispatch the `webauthn` scheme; use invokeWebauthnSigner instead.",
		);
	}
	if (scheme === "typedData") {
		if (typeof signer.signTypedData !== "function") {
			throw new AbstractionKitError(
				"BAD_DATA",
				`signer ${signer.address ?? "(webauthn)"} is missing signTypedData`,
			);
		}
		if (!payload.typedData) {
			throw new AbstractionKitError(
				"BAD_DATA",
				`scheme "typedData" selected but no typedData payload provided`,
			);
		}
		return signer.signTypedData(payload.typedData, payload.context);
	}
	if (typeof signer.signHash !== "function") {
		throw new AbstractionKitError(
			"BAD_DATA",
			`signer ${signer.address ?? "(webauthn)"} is missing signHash`,
		);
	}
	return signer.signHash(payload.hash, payload.context);
}

/**
 * Invoke a WebAuthn signer. Returns the raw {@link WebAuthnAssertion}; the
 * calling account encodes it into its own on-chain format (Safe's verifier
 * expects `abi.encode(bytes,bytes,uint256[2])`, Calibur's expects
 * `abi.encode(bytes32 keyHash, bytes sig, bytes hookData)`).
 */
export async function invokeWebauthnSigner<C>(
	signer: Signer<C>,
	payload: { challenge: `0x${string}`; context: C },
): Promise<WebAuthnAssertion> {
	if (typeof signer.signWebauthn !== "function") {
		throw new AbstractionKitError(
			"BAD_DATA",
			"signer is missing signWebauthn; construct it with `fromWebAuthn(...)`",
		);
	}
	return signer.signWebauthn(payload.challenge, payload.context);
}
