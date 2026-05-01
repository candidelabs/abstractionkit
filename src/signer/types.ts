import type { BaseUserOperation } from "../types";

/**
 * Narrow EIP-712 typed data payload. All hex fields are typed as
 * `` `0x${string}` `` so callers don't need casts when handing this straight
 * to viem / ethers. `EIP712Domain` is stripped from `types` before the payload
 * is handed to a Signer, so consumers don't need to filter it out.
 */
export interface TypedData {
	domain: {
		name?: string;
		version?: string;
		chainId?: number | bigint;
		verifyingContract?: `0x${string}`;
		salt?: `0x${string}`;
	};
	types: Record<string, Array<{ name: string; type: string }>>;
	primaryType: string;
	message: Record<string, unknown>;
}

/** Signing schemes accounts may accept and signers may provide. */
export type SigningScheme = "hash" | "typedData";

/**
 * Context the SDK passes to a signer on every account's
 * `signUserOperationWithSigner(s)` (the single-op path — 99% of usage).
 * All fields are required; IDE autocomplete shows them directly without a
 * type guard. Default for {@link Signer}, {@link SignHashFn},
 * {@link SignTypedDataFn}.
 *
 * For the multi-op Merkle path
 * (`SafeMultiChainSigAccountV1.signUserOperationsWithSigners`), see
 * {@link MultiOpSignContext}.
 */
export interface SignContext<T extends BaseUserOperation = BaseUserOperation> {
	readonly userOperation: T;
	readonly chainId: bigint;
	readonly entryPoint: string;
}

/**
 * Context for the multi-op Merkle signing path
 * (`SafeMultiChainSigAccountV1.signUserOperationsWithSigners`). The signer
 * sees the full bundle so you can show "you're
 * authorizing N ops across these chains" instead of an opaque root.
 *
 * Type your multi-op signer as `ExternalSigner<MultiOpSignContext>` for
 * full autocomplete on `userOperations`. Pre-built adapters
 * `fromPrivateKey`, `fromViem`, and `fromEthersWallet` return a universal
 * `Signer<unknown>` and work on either single-op or multi-op paths
 * without retyping. `fromViemWalletClient` only exposes `signTypedData`,
 * so it's usable on single-op paths only — the multi-op Merkle root is
 * opaque, has no typed-data display, and requires raw-hash signing.
 */
export interface MultiOpSignContext<T extends BaseUserOperation = BaseUserOperation> {
	readonly userOperations: ReadonlyArray<{
		readonly userOperation: T;
		readonly chainId: bigint;
	}>;
	readonly entryPoint: string;
}

/** Common fields every Signer exposes. */
interface SignerBase {
	/** Address that will recover from signatures this signer produces. */
	readonly address: `0x${string}`;
	/**
	 * Signature kind this signer produces. `"ecdsa"` (default) is a raw
	 * 65-byte ECDSA signature appended inline. `"contract"` is an EIP-1271
	 * signature blob from a smart-contract owner; it gets encoded as a
	 * dynamic-length contract-signature segment when the aggregate is built.
	 *
	 * Account-agnostic: `Signer` is shared with non-Safe accounts that ignore
	 * this field. For Safe, this drives the per-pair `isContractSignature`
	 * flag set on the {@link SignerSignaturePair} produced for this signer,
	 * so different signers in the same batch can mix kinds correctly.
	 */
	readonly type?: "ecdsa" | "contract";
}

/**
 * Sign a 32-byte hash raw (no EIP-191 prefix). Required for Simple7702 /
 * Calibur; acceptable fallback for Safe.
 *
 * Generic over the context type the SDK will pass when signing through an
 * account. The context argument is optional so direct calls to a signer can
 * use `signer.signHash(hash)` without passing a placeholder. Defaults to
 * {@link SignContext} (single-op) — set explicitly to
 * {@link MultiOpSignContext} for multi-op signers, or to `unknown` for
 * universal/context-agnostic signers like the built-in adapters.
 */
export type SignHashFn<C = SignContext> = (
	hash: `0x${string}`,
	context?: C,
) => Promise<`0x${string}`>;

/**
 * Sign an EIP-712 typed data payload. Preferred for Safe because wallets
 * can display structured fields instead of a hex blob.
 *
 * Generic over context — see {@link SignHashFn}. The SDK passes context when
 * it invokes the signer, but direct callers may omit it.
 */
export type SignTypedDataFn<C = SignContext> = (
	data: TypedData,
	context?: C,
) => Promise<`0x${string}`>;

/**
 * A capability-oriented signer. Must declare at least one of `signHash` or
 * `signTypedData`; the account picks the best match at sign time. Declared
 * as a discriminated union so TypeScript rejects `{ address }` with neither
 * method at compile time.
 *
 * Re-exported at the package root as `ExternalSigner` (the unqualified
 * `Signer` name is already a Safe owner-identifier union).
 *
 * `signMessage` (EIP-191) is intentionally omitted: the `v`-byte mismatch
 * between default tooling and Safe's on-chain validator makes it a footgun.
 * Use `signTypedData` for JSON-RPC wallets or `signHash` for local keys.
 *
 * @example Built-in adapters cover the common cases:
 * ```ts
 * import { fromPrivateKey, fromViem, fromEthersWallet } from "abstractionkit"
 * const a = fromPrivateKey(pkHexString)
 * const b = fromViem(privateKeyToAccount(pk))
 * const c = fromEthersWallet(new Wallet(pk))
 * ```
 *
 * @example Uint8Array-only / secure-dispose posture (key never hex-stringified):
 * ```ts
 * import { SigningKey, computeAddress } from "ethers"
 * function fromPrivateKeyBytes(pkBytes: Uint8Array): ExternalSigner {
 *   const sk = new SigningKey(pkBytes)
 *   return {
 *     address: computeAddress(sk.publicKey) as `0x${string}`,
 *     signHash: async (hash) => sk.sign(hash).serialized as `0x${string}`,
 *   }
 * }
 * const signer = fromPrivateKeyBytes(bytes)
 * try { userOp.signature = await safe.signUserOperationWithSigners(op, [signer], chainId) }
 * finally { bytes.fill(0) }  // zero the buffer on dispose
 * ```
 *
 * @example HSM / hardware-wallet / MPC: key never exists in JS memory:
 * ```ts
 * const hsmSigner: ExternalSigner = {
 *   address: deviceAddress,
 *   signHash: async (hash) => await hsm.signHash(hash),     // RPC to device
 *   signTypedData: async (td) => await hsm.signTypedData(td),
 * }
 * ```
 */
export type Signer<C = SignContext> = SignerBase &
	(
		| { signHash: SignHashFn<C>; signTypedData?: SignTypedDataFn<C> }
		| { signHash?: SignHashFn<C>; signTypedData: SignTypedDataFn<C> }
	);
