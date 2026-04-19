import { Wallet, getAddress } from "ethers";
import { Signer, TypedData } from "./types";

// Structural types for well-known signers. NO imports from viem / ethers
// at the type level (beyond the already-present ethers runtime dep used by
// fromPrivateKey); these shapes match their public APIs so users can pass
// an instance directly.

/**
 * Shape matching viem's `PrivateKeyAccount` / `LocalAccount`.
 *
 * @remarks Requires viem &gt;= 2.0. The `sign({ hash })` method was added in
 * the viem 2.0 account refactor; viem 1.x callers see a type error and
 * should upgrade.
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
 * Minimal shape required by {@link fromViemWalletClient}. We only need to
 * read `account.address` structurally; `signTypedData` is invoked via a
 * localized cast inside the adapter because viem types it with const
 * generics that can't be reproduced without re-exporting viem's type
 * system. The runtime call shape is stable across viem 2.x.
 *
 * @remarks Requires viem &gt;= 2.0.
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
 * Shape matching ethers `Wallet` / `HDNodeWallet`.
 *
 * @remarks Requires ethers &gt;= 6.0. In ethers 5.x the typed-data method was
 * the private `_signTypedData`; the structural match fails there and callers
 * should upgrade.
 *
 * Parameter types intentionally widen ethers' concrete `TypedDataDomain` /
 * `TypedDataField[]` so the interface doesn't depend on ethers' type
 * exports while still accepting an ethers Wallet instance without casts
 * at the call site.
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
 * Build a Signer from a raw private key. Uses the library's existing
 * ethers dependency internally, so no additional packages are required on
 * the caller side. Supports both raw-hash and typed-data signing.
 *
 * Prefer this when all you have is a private key (test suites, server-side
 * scripts, scripts with env-injected keys, etc.). If you already hold a
 * viem Account or ethers Wallet from elsewhere in your app, pass it to
 * {@link fromViem} or {@link fromEthersWallet} instead.
 *
 * @example
 * import { fromPrivateKey } from "abstractionkit";
 * const signer = fromPrivateKey(process.env.PRIVATE_KEY!);
 * userOp.signature = await safe.signUserOp(userOp, [signer], chainId);
 */
export function fromPrivateKey(privateKey: string): Signer {
	const wallet = new Wallet(privateKey);
	return {
		address: getAddress(wallet.address) as `0x${string}`,
		signHash: async (hash) =>
			wallet.signingKey.sign(hash).serialized as `0x${string}`,
		signTypedData: async (td) =>
			(await wallet.signTypedData(
				td.domain,
				td.types,
				td.message,
			)) as `0x${string}`,
	};
}

/**
 * Adapt a viem Local Account (e.g. `privateKeyToAccount(pk)`) to a Signer.
 * Supports both raw-hash and typed-data signing.
 *
 * @remarks Requires viem &gt;= 2.0.
 */
export function fromViem(account: ViemLocalAccountLike): Signer {
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
 * Adapt a viem WalletClient to a Signer. WalletClient is the client-style
 * API dApps use to drive browser / JSON-RPC wallets, so only typed-data
 * signing is exposed (JSON-RPC wallets can't sign raw hashes).
 *
 * Requires the client to have been constructed with an `account` (local or
 * JSON-RPC). For local accounts, pass that directly to `fromViem` instead
 * if you want raw-hash fallback.
 *
 * @remarks Requires viem &gt;= 2.0.
 */
export function fromViemWalletClient(client: ViemWalletClientLike): Signer {
	if (!client.account) {
		throw new Error(
			"fromViemWalletClient: client has no `account` configured. " +
				"Construct with `createWalletClient({ account, transport, chain })`.",
		);
	}
	// Capture the full account object (at runtime it may expose local
	// signing methods that cause viem to sign without hitting JSON-RPC).
	// Passing just the address string here would force a route to
	// `eth_signTypedData_v4`, which fails against an HTTP transport.
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
export function fromEthersWallet(wallet: EthersWalletLike): Signer {
	// ethers types `address` as plain `string`; at runtime it's always
	// checksummed 0x-prefixed hex.
	return {
		address: wallet.address as `0x${string}`,
		signHash: async (hash) =>
			wallet.signingKey.sign(hash).serialized as `0x${string}`,
		signTypedData: async (td) =>
			(await wallet.signTypedData(td.domain, td.types, td.message)) as `0x${string}`,
	};
}
