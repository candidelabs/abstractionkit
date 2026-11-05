import { AbstractionKitError } from "../errors";
import type { ExternalSigner, SigningScheme, TypedData } from "./types";

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
	signer: ExternalSigner<C>,
	accepted: readonly SigningScheme[],
	context: { accountName: string; signerIndex: number },
): SigningScheme {
	// Typeof-check (not truthiness) so malformed signers like
	// `{ signHash: true }` from JS callers bypassing types get a clear
	// AbstractionKitError here instead of a raw TypeError at the call site.
	const signerCan: SigningScheme[] = [];
	if (typeof signer.signTypedData === "function") signerCan.push("typedData");
	if (typeof signer.signHash === "function") signerCan.push("hash");

	for (const scheme of accepted) {
		if (signerCan.includes(scheme)) return scheme;
	}

	throw new AbstractionKitError(
		"BAD_DATA",
		buildMismatchMessage({
			accountName: context.accountName,
			signerIndex: context.signerIndex,
			signerAddress: signer.address,
			accepted,
			signerCan,
		}),
	);
}

function buildMismatchMessage(params: {
	accountName: string;
	signerIndex: number;
	signerAddress: string;
	accepted: readonly SigningScheme[];
	signerCan: SigningScheme[];
}): string {
	const { accountName, signerIndex, signerAddress, accepted, signerCan } = params;
	const canStr = signerCan.length > 0 ? signerCan.join(", ") : "none";
	return (
		`No compatible signing scheme for signer[${signerIndex}] ${signerAddress}. ` +
		`${accountName} accepts: [${accepted.join(", ")}]; signer provides: [${canStr}]. ` +
		(signerCan.length === 0
			? "ExternalSigner must implement at least one of `signHash` or `signTypedData`. "
			: "") +
		"Hint: `fromViem` / `fromEthersWallet` give both; " +
		"`fromViemWalletClient` gives only `typedData`; `fromSafeWebauthn` gives only `hash`."
	);
}

/**
 * Invoke a signer for one scheme. Keeps the dispatch in one place so the
 * account-side code stays linear. `typedData` is optional: accounts that
 * only accept the `"hash"` scheme can pass just `hash`.
 *
 * `context` is always forwarded to the signer so power-user implementations
 * can inspect the userOp.
 */
export async function invokeSigner<C>(
	signer: ExternalSigner<C>,
	scheme: SigningScheme,
	payload: {
		hash: `0x${string}`;
		typedData?: TypedData;
		context: C;
	},
): Promise<`0x${string}`> {
	if (scheme === "typedData") {
		if (typeof signer.signTypedData !== "function") {
			throw new AbstractionKitError(
				"BAD_DATA",
				`signer ${signer.address} is missing signTypedData`,
			);
		}
		if (!payload.typedData) {
			throw new AbstractionKitError(
				"BAD_DATA",
				`scheme "typedData" selected but no typedData payload provided`,
			);
		}
		return normalizeRecoveryId(
			signer,
			await signer.signTypedData(payload.typedData, payload.context),
		);
	}
	if (typeof signer.signHash !== "function") {
		throw new AbstractionKitError("BAD_DATA", `signer ${signer.address} is missing signHash`);
	}
	return normalizeRecoveryId(signer, await signer.signHash(payload.hash, payload.context));
}

/**
 * KMS, HSM and MPC raw-sign APIs often return the recovery id as 0 / 1
 * (yParity) where the contracts expect 27 / 28. Left as is, a Safe reads
 * v = 0 as a contract signature and v = 1 as an approved hash, and an ECDSA
 * recover rejects both, so the operation fails only at the bundler.
 *
 * Only a 65-byte signature of an `"ecdsa"` signer is touched, and only when
 * `r` is a real curve value. Safe's own v = 0 / v = 1 encodings put a
 * left-padded address in `r`, which a real signature never has, so they
 * pass through unchanged.
 */
function normalizeRecoveryId<C>(
	signer: ExternalSigner<C>,
	signature: `0x${string}`,
): `0x${string}` {
	if (signer.type === "contract") return signature;
	if (typeof signature !== "string" || signature.length !== 2 + 65 * 2) return signature;
	const v = signature.slice(-2).toLowerCase();
	if (v !== "00" && v !== "01") return signature;
	const rIsPaddedAddress = /^0x0{24}/i.test(signature);
	if (rIsPaddedAddress) return signature;
	return `${signature.slice(0, -2)}${v === "00" ? "1b" : "1c"}` as `0x${string}`;
}
