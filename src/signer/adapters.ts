import { getAddress, Wallet } from "ethers";
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

