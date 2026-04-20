import { AbstractionKitError } from "../errors";
import { Signer, SigningScheme, TypedData } from "./types";

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
	// Use `typeof === "function"` (not truthiness) so a malformed signer
	// like `{ signHash: true }` (e.g. from a JS caller bypassing types) is
	// rejected via pickScheme's AbstractionKitError instead of crashing
	// later with a raw TypeError on the call site.
	const signerCan: SigningScheme[] = [];
	if (typeof signer.signTypedData === "function") signerCan.push("typedData");
	if (typeof signer.signHash === "function") signerCan.push("hash");

	for (const scheme of accepted) {
		if (signerCan.includes(scheme)) return scheme;
	}

	throw new AbstractionKitError("BAD_DATA", buildMismatchMessage({
		accountName: context.accountName,
		signerIndex: context.signerIndex,
		signerAddress: signer.address,
		accepted,
		signerCan,
	}));
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
			? "Signer must implement at least one of `signHash` or `signTypedData`. "
			: "") +
		"Hint: `fromViem` / `fromEthersWallet` give both; " +
		"`fromViemWalletClient` gives only `typedData` (use Safe for JSON-RPC wallets)."
	);
}

/**
 * Invoke a signer for one scheme. Keeps the dispatch in one place so the
 * account-side code stays linear. `typedData` is optional: accounts that
 * only accept the `"hash"` scheme (Simple7702, Calibur) pass just `hash`.
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
	if (scheme === "typedData") {
		if (typeof signer.signTypedData !== "function") {
			throw new AbstractionKitError("BAD_DATA",
				`signer ${signer.address} is missing signTypedData`);
		}
		if (!payload.typedData) {
			throw new AbstractionKitError("BAD_DATA",
				`scheme "typedData" selected but no typedData payload provided`);
		}
		return signer.signTypedData(payload.typedData, payload.context);
	}
	if (typeof signer.signHash !== "function") {
		throw new AbstractionKitError("BAD_DATA",
			`signer ${signer.address} is missing signHash`);
	}
	return signer.signHash(payload.hash, payload.context);
}
