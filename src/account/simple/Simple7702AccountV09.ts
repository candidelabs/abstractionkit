import { ENTRYPOINT_V9 } from "src/constants";
import type { Signer as AkSigner } from "src/signer/types";
import type { StateOverrideSet, UserOperationV9 } from "src/types";
import type { SendUseroperationResponse } from "../SendUseroperationResponse";
import {
	BaseSimple7702Account,
	type CreateUserOperationOverrides,
	type SimpleMetaTransaction,
} from "./Simple7702Account";

/**
 * EIP-7702 simple smart account targeting EntryPoint v0.9
 * (`0x433709009B8330FDa32311DF1C2AFA402eD8D009`).
 * Extends {@link BaseSimple7702Account} with concrete types for
 * {@link UserOperationV9} and sensible defaults for the delegatee address.
 */
export class Simple7702AccountV09 extends BaseSimple7702Account {
	static readonly DEFAULT_DELEGATEE_ADDRESS = "0xa46cc63eBF4Bd77888AA327837d20b23A63a56B5";

	/**
	 * @param accountAddress - The EOA address that will be delegated via EIP-7702
	 * @param overrides - Optional overrides for entrypoint and delegatee addresses
	 * @param overrides.entrypointAddress - Custom EntryPoint address (defaults to EntryPoint v0.9)
	 * @param overrides.delegateeAddress - Custom delegatee contract address
	 */
	constructor(
		accountAddress: string,
		overrides: {
			entrypointAddress?: string;
			delegateeAddress?: string;
		} = {},
	) {
		super(
			accountAddress,
			overrides.entrypointAddress ?? ENTRYPOINT_V9,
			overrides.delegateeAddress ?? Simple7702AccountV09.DEFAULT_DELEGATEE_ADDRESS,
		);
	}

	/**
	 * Create a {@link UserOperationV9} for EntryPoint v0.9.
	 * Determines nonce, fetches gas prices, estimates gas limits, and returns
	 * an unsigned UserOperation. All auto-determined values can be overridden.
	 * @param transactions - One or more transactions to encode into callData
	 * @param providerRpc - JSON-RPC endpoint for nonce and gas price queries
	 * @param bundlerRpc - Bundler RPC endpoint for gas estimation
	 * @param overrides - Optional overrides for gas, nonce, and EIP-7702 auth fields
	 * @returns A promise resolving to an unsigned {@link UserOperationV9}
	 */
	public async createUserOperation(
		transactions: SimpleMetaTransaction[],
		providerRpc?: string,
		bundlerRpc?: string,
		overrides: CreateUserOperationOverrides = {},
	): Promise<UserOperationV9> {
		return this.baseCreateUserOperation(transactions, providerRpc, bundlerRpc, overrides);
	}

	/**
	 * Estimate gas limits for a {@link UserOperationV9}.
	 * @param userOperation - The UserOperation to estimate gas for
	 * @param bundlerRpc - Bundler RPC endpoint for gas estimation
	 * @param overrides - Optional overrides
	 * @param overrides.stateOverrideSet - State overrides to apply during estimation
	 * @param overrides.dummySignature - Custom dummy signature for estimation
	 * @returns A promise resolving to `[preVerificationGas, verificationGasLimit, callGasLimit]`
	 */
	public async estimateUserOperationGas(
		userOperation: UserOperationV9,
		bundlerRpc: string,
		overrides: {
			stateOverrideSet?: StateOverrideSet;
			dummySignature?: string;
		} = {},
	): Promise<[bigint, bigint, bigint]> {
		return this.baseEstimateUserOperationGas(userOperation, bundlerRpc, overrides);
	}

	/**
	 * Sign a {@link UserOperationV9} with an EOA private key.
	 * Computes the UserOperation hash and produces an ECDSA signature.
	 * @param useroperation - The UserOperation to sign
	 * @param privateKey - Hex-encoded private key of the EOA signer
	 * @param chainId - Target chain ID
	 * @returns Hex-encoded ECDSA signature
	 */
	public signUserOperation(
		useroperation: UserOperationV9,
		privateKey: string,
		chainId: bigint,
	): string {
		return this.baseSignUserOperation(useroperation, privateKey, chainId);
	}

	/**
	 * Sign a {@link UserOperationV9} using an {@link ExternalSigner}. This is
	 * the recommended entry point for any non-private-key signer.
	 *
	 * Accepts signers that implement `signTypedData` (JSON-RPC wallets, viem
	 * `WalletClient`, browser wallets), `signHash` (local keys, hardware
	 * wallets), or both. The v0.9 userOpHash IS the EIP-712 digest of the
	 * PackedUserOperation under the EntryPoint domain, so both schemes
	 * produce signatures that validate against the same `userOpHash`.
	 *
	 * Wrapping a custom signing primitive is just an object literal; no
	 * adapter function required:
	 *
	 * ```ts
	 * const signer: ExternalSigner = {
	 *   address: ownerAddress,
	 *   signTypedData: async (td) => myWallet.signTypedData(td),
	 * }
	 * userOp.signature = await account.signUserOperationWithSigner(userOp, signer, chainId)
	 * ```
	 *
	 * For signing with a raw private-key string, use the sync
	 * {@link signUserOperation} method, or wrap explicitly with
	 * `fromPrivateKey(pk)`.
	 *
	 * @see {@link BaseSimple7702Account.getUserOperationEip712TypedData} for
	 *   the lower-level escape hatch when you need the typed data outside the
	 *   dispatcher.
	 */
	public async signUserOperationWithSigner(
		useroperation: UserOperationV9,
		signer: AkSigner,
		chainId: bigint,
	): Promise<string> {
		return this.baseSignUserOperationWithSigner(useroperation, signer, chainId);
	}

	/**
	 * Send a signed {@link UserOperationV9} to a bundler for on-chain inclusion.
	 * @param userOperation - The signed UserOperation to submit
	 * @param bundlerRpc - Bundler RPC endpoint
	 * @returns A {@link SendUseroperationResponse} that can be used to wait for inclusion
	 */
	public async sendUserOperation(
		userOperation: UserOperationV9,
		bundlerRpc: string,
	): Promise<SendUseroperationResponse> {
		return this.baseSendUserOperation(userOperation, bundlerRpc);
	}
}
