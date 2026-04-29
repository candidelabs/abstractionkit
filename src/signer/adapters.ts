import { getAddress, getBytes, Wallet } from "ethers";
import { SafeAccount } from "../account/Safe/SafeAccount";
import type { WebauthnPublicKey, WebauthnSignatureData } from "../account/Safe/types";
import type { Signer, TypedData } from "./types";

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
	/** Override the WebAuthn shared signer address used when `isInit`. */
	webAuthnSharedSigner?: string;
	/** Override the WebAuthn signer factory used to derive the verifier proxy. */
	webAuthnSignerFactory?: string;
	/** Override the WebAuthn signer singleton used to derive the verifier proxy. */
	webAuthnSignerSingleton?: string;
	/** Override the WebAuthn signer proxy creation code used in the address derivation. */
	webAuthnSignerProxyCreationCode?: string;
	/** Override the EIP-7212 precompile verifier used in the address derivation. */
	eip7212WebAuthnPrecompileVerifier?: string;
	/** Override the EIP-7212 contract verifier used in the address derivation. */
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
 * @example
 * import { fromSafeWebauthn } from "abstractionkit";
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
