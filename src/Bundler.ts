import {
	AbstractionKitError,
	type BasicErrorCode,
	type BundlerErrorCode,
	BundlerErrorCodeDict,
	ensureError,
} from "./errors";
import {
	HttpTransport,
	normalizingTransport,
	type ProviderRpcError,
	type RequestArgs,
	type RequestOptions,
	type Transport,
} from "./transport";
import type {
	GasEstimationResult,
	JsonRpcResult,
	StateOverrideSet,
	UserOperationByHashResult,
	UserOperationReceipt,
	UserOperationReceiptResult,
	UserOperationV6,
	UserOperationV7,
	UserOperationV8,
	UserOperationV9,
} from "./types";

/**
 * JSON-RPC client for an ERC-4337 bundler.
 *
 * Accepts either a URL string (wrapped automatically in {@link HttpTransport})
 * or any {@link Transport} — including a viem client, an EIP-1193 wallet
 * provider, an in-process mock, or a user-composed fallback/retry transport.
 *
 * The class itself implements {@link Transport}, so a `Bundler` can be passed
 * back into any other Transport position.
 *
 * Candide bundler endpoints:
 * - `https://api.candide.dev/api/v3/{chainId}/{apiKey}` (authenticated)
 * - `https://api.candide.dev/public/v3/{chainId}` (public)
 *
 * @example URL string (most common)
 * ```ts
 * const bundler = new Bundler("https://api.candide.dev/public/v3/11155111");
 * const receipt = await bundler.getUserOperationReceipt(userOpHash);
 * ```
 *
 * @example Custom transport (composed retry behavior)
 * ```ts
 * const retryingTransport: Transport = {
 *   async request(args, options) {
 *     for (let i = 0; i < 3; i++) {
 *       try { return await inner.request(args, options); }
 *       catch (e) { if (i === 2) throw e; await sleep(2 ** i * 100); }
 *     }
 *   },
 * };
 * const bundler = new Bundler(retryingTransport);
 * ```
 */
export class Bundler implements Transport {
	/**
	 * The raw transport the user passed in (or {@link HttpTransport} when a URL
	 * string was passed). Exposed for introspection — reading `.url`,
	 * `isHttpTransport(...)` checks, passing it back into another service.
	 *
	 * Calls made directly on this field (`bundler.transport.request(...)`) go
	 * to the raw transport and skip SDK-level behavior like bigint param
	 * normalization. For SDK-pipeline behavior, use {@link Bundler.request} or
	 * the typed methods.
	 */
	readonly transport: Transport;
	/** Normalizing wrapper around {@link transport}, used for every SDK-outbound call. */
	private readonly outbound: Transport;

	/**
	 * @param rpc - Bundler JSON-RPC endpoint URL, or any {@link Transport}.
	 */
	constructor(rpc: string | Transport) {
		this.transport = typeof rpc === "string" ? new HttpTransport(rpc) : rpc;
		this.outbound = normalizingTransport(this.transport);
	}

	/**
	 * Normalize any acceptable input into a `Bundler`. When the input is
	 * already a `Bundler` instance, it is returned by reference (so a user's
	 * pre-constructed Bundler is never re-wrapped and its transport is
	 * reused for follow-up calls like {@link SendUseroperationResponse.included}).
	 *
	 * @param input - URL string, Transport, or existing Bundler
	 */
	static from(input: string | Transport | Bundler): Bundler {
		return input instanceof Bundler ? input : new Bundler(input);
	}

	/**
	 * Transport delegate. Forwards directly to the underlying
	 * {@link Transport.request}. Lets a `Bundler` itself slot into any other
	 * transport position.
	 */
	request<T = unknown>(args: RequestArgs, options?: RequestOptions): Promise<T> {
		return this.outbound.request<T>(args, options);
	}

	/**
	 * Get the bundler's chain ID.
	 * @returns The chain ID as a hex-encoded string
	 */
	async chainId(): Promise<string> {
		try {
			const chainId = await this.outbound.request<unknown>({ method: "eth_chainId" });
			if (typeof chainId !== "string") {
				throw new AbstractionKitError("BAD_DATA", "bundler eth_chainId rpc call failed");
			}
			return chainId;
		} catch (err) {
			throw translateBundlerError(err, "eth_chainId");
		}
	}

	/**
	 * Get EntryPoint addresses supported by this bundler.
	 * @returns An array of supported EntryPoint contract addresses
	 */
	async supportedEntryPoints(): Promise<string[]> {
		try {
			const result = await this.outbound.request<string[]>({
				method: "eth_supportedEntryPoints",
			});
			return result;
		} catch (err) {
			throw translateBundlerError(err, "eth_supportedEntryPoints");
		}
	}

	/**
	 * Estimate gas limits for a UserOperation.
	 * @param useroperation - UserOperation to estimate gas for
	 * @param entrypointAddress - Target EntryPoint address
	 * @param state_override_set - Optional state overrides for estimation
	 * @returns Gas estimation with callGasLimit, preVerificationGas, and verificationGasLimit
	 */
	async estimateUserOperationGas(
		useroperation: UserOperationV6 | UserOperationV7 | UserOperationV8 | UserOperationV9,
		entrypointAddress: string,
		state_override_set?: StateOverrideSet,
	): Promise<GasEstimationResult> {
		try {
			const params: unknown[] =
				state_override_set == null
					? [useroperation, entrypointAddress]
					: [useroperation, entrypointAddress, state_override_set];
			const jsonRpcResult = await this.outbound.request<JsonRpcResult>({
				method: "eth_estimateUserOperationGas",
				params,
			});
			const res = jsonRpcResult as GasEstimationResult;
			const gasEstimationResult: GasEstimationResult = {
				callGasLimit: BigInt(res.callGasLimit),
				preVerificationGas: BigInt(res.preVerificationGas),
				verificationGasLimit: BigInt(res.verificationGasLimit),
			};
			// Non-spec extension: some bundlers return paymaster gas fields
			// alongside the standard ones. Forward them when present.
			if (res.paymasterVerificationGasLimit != null) {
				gasEstimationResult.paymasterVerificationGasLimit = BigInt(
					res.paymasterVerificationGasLimit,
				);
			}
			if (res.paymasterPostOpGasLimit != null) {
				gasEstimationResult.paymasterPostOpGasLimit = BigInt(res.paymasterPostOpGasLimit);
			}

			return gasEstimationResult;
		} catch (err) {
			throw translateBundlerError(err, "eth_estimateUserOperationGas");
		}
	}

	/**
	 * Submit a signed UserOperation to the bundler for on-chain inclusion.
	 * @param useroperation - The signed UserOperation to submit
	 * @param entrypointAddress - Target EntryPoint address
	 * @returns The UserOperation hash
	 */
	async sendUserOperation(
		useroperation: UserOperationV6 | UserOperationV7 | UserOperationV8 | UserOperationV9,
		entrypointAddress: string,
	): Promise<string> {
		try {
			const jsonRpcResult = await this.outbound.request<string>({
				method: "eth_sendUserOperation",
				params: [useroperation, entrypointAddress],
			});
			return jsonRpcResult;
		} catch (err) {
			throw translateBundlerError(err, "eth_sendUserOperation");
		}
	}

	/**
	 * Get the receipt for a previously submitted UserOperation.
	 * @param useroperationhash - The hash of the UserOperation to look up
	 * @returns The receipt, or null if not yet included on-chain
	 */
	async getUserOperationReceipt(useroperationhash: string): Promise<UserOperationReceiptResult> {
		try {
			const jsonRpcResult = await this.outbound.request<UserOperationReceiptResult | null>({
				method: "eth_getUserOperationReceipt",
				params: [useroperationhash],
			});
			if (jsonRpcResult == null) return null;
			const res = jsonRpcResult;

			const userOperationReceipt: UserOperationReceipt = {
				...res.receipt,
				blockNumber: BigInt(res.receipt.blockNumber),
				cumulativeGasUsed: BigInt(res.receipt.cumulativeGasUsed),
				gasUsed: BigInt(res.receipt.gasUsed),
				transactionIndex: BigInt(res.receipt.transactionIndex),
				effectiveGasPrice:
					res.receipt.effectiveGasPrice == null
						? undefined
						: BigInt(res.receipt.effectiveGasPrice),
				logs: JSON.stringify(res.receipt.logs),
			};

			return {
				...res,
				nonce: BigInt(res.nonce),
				actualGasCost: BigInt(res.actualGasCost),
				actualGasUsed: BigInt(res.actualGasUsed),
				logs: JSON.stringify(res.logs),
				receipt: userOperationReceipt,
			};
		} catch (err) {
			throw translateBundlerError(err, "eth_getUserOperationReceipt", { useroperationhash });
		}
	}

	/**
	 * Look up a UserOperation by its hash.
	 * @param useroperationhash - The hash of the UserOperation to look up
	 * @returns The UserOperation with metadata, or null if not found
	 */
	async getUserOperationByHash(useroperationhash: string): Promise<UserOperationByHashResult> {
		try {
			const jsonRpcResult = await this.outbound.request<UserOperationByHashResult | null>({
				method: "eth_getUserOperationByHash",
				params: [useroperationhash],
			});
			if (jsonRpcResult == null) return null;
			return {
				...jsonRpcResult,
				blockNumber: jsonRpcResult.blockNumber == null ? null : BigInt(jsonRpcResult.blockNumber),
			};
		} catch (err) {
			throw translateBundlerError(err, "eth_getUserOperationByHash", { useroperationhash });
		}
	}
}

/**
 * Translate a transport-level error (or already-wrapped
 * {@link AbstractionKitError}) into the `BUNDLER_ERROR` outer / specific
 * 4337-code inner shape used by {@link Bundler}.
 *
 * - `AbstractionKitError` passes through unchanged (already domain-translated).
 * - {@link ProviderRpcError} with a known 4337 code → inner code from
 *   {@link BundlerErrorCodeDict}.
 * - Anything else → inner `UNKNOWN_ERROR`.
 *
 * @internal
 */
function translateBundlerError(
	err: unknown,
	method: string,
	context?: { readonly useroperationhash?: string },
): AbstractionKitError {
	if (err instanceof AbstractionKitError) {
		// BC: existing callers see outer BUNDLER_ERROR even when the inner
		// translation has already happened (e.g. via JsonRpcNode reuse, future
		// proofing). Re-wrap if not already a BUNDLER_ERROR.
		if (err.code === "BUNDLER_ERROR") return err;
		return new AbstractionKitError("BUNDLER_ERROR", `bundler ${method} rpc call failed`, {
			cause: err,
			errno: err.errno,
			context,
		});
	}
	const code = (err as ProviderRpcError | undefined)?.code;
	const codeString = code != null ? String(code) : "";
	const innerCode: BundlerErrorCode | BasicErrorCode =
		codeString in BundlerErrorCodeDict ? BundlerErrorCodeDict[codeString] : "UNKNOWN_ERROR";
	const error = ensureError(err);
	return new AbstractionKitError("BUNDLER_ERROR", `bundler ${method} rpc call failed`, {
		cause: new AbstractionKitError(innerCode, error.message, { errno: code }),
		errno: code,
		context,
	});
}
