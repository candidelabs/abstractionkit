import {AbiCoder, getAddress} from "ethers";
import {
	AbstractionKitError,
	type BasicErrorCode,
	ensureError,
	type JsonRpcErrorCode,
	JsonRpcErrorDict,
} from "../errors";
import {GasOption} from "../types";
import type {DepositInfo} from "../utils";
import {HttpTransport} from "./HttpTransport";
import type {ProviderRpcError, RequestArgs, RequestOptions, Transport} from "./Transport";

/**
 * Transaction shape accepted by {@link JsonRpcNode.call}.
 */
export type EthCallTransaction = {
	from?: string;
	to: string;
	gas?: bigint;
	gasPrice?: bigint;
	value?: bigint;
	data?: string;
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * High-level service class for the JSON-RPC node methods abstractionkit reads
 * from. Intentionally NOT a general Ethereum client — only exposes the
 * methods the SDK actually uses. For broader functionality, drop down to
 * `.transport` and call `request({ method, params })` directly, or use a
 * dedicated library like viem / ethers.
 *
 * Like {@link Bundler} and the paymaster classes, `JsonRpcNode` itself
 * implements {@link Transport} so it can be passed back into any Transport
 * position.
 *
 * @example
 * ```ts
 * const node = new JsonRpcNode("https://ethereum-sepolia.publicnode.com");
 * const id = await node.chainId();
 * const code = await node.getCode("0x...");
 *
 * // Also a Transport — can be slotted in:
 * const bundler = new Bundler(node);  // bundler will speak through this node
 * ```
 */
export class JsonRpcNode implements Transport {
	/** The underlying transport. Always set — strings are wrapped in {@link HttpTransport}. */
	readonly transport: Transport;

	/**
	 * @param rpc - Node JSON-RPC endpoint URL, or any {@link Transport}
	 */
	constructor(rpc: string | Transport) {
		this.transport = typeof rpc === "string" ? new HttpTransport(rpc) : rpc;
	}

	/**
	 * Normalize any acceptable input into a {@link JsonRpcNode}. Used at every
	 * public-API widening site (in account / paymaster classes). When the
	 * input is already a `JsonRpcNode`, the same instance is returned by
	 * reference, so a user's preconstructed `JsonRpcNode` is never re-wrapped.
	 *
	 * @param input - URL string, Transport, or existing JsonRpcNode
	 */
	static from(input: string | Transport | JsonRpcNode): JsonRpcNode {
		return input instanceof JsonRpcNode ? input : new JsonRpcNode(input);
	}

	/**
	 * Transport delegate. Forwards directly to the underlying
	 * {@link Transport.request}. Lets a `JsonRpcNode` itself slot into any
	 * other transport position.
	 */
	request<T = unknown>(args: RequestArgs, options?: RequestOptions): Promise<T> {
		return this.transport.request<T>(args, options);
	}

	// ─── Standard JSON-RPC methods ───────────────────────────────────────

	/**
	 * `eth_chainId`. Returns the hex-encoded chain id (e.g. `"0xaa36a7"` for
	 * Sepolia).
	 */
	async chainId(options?: RequestOptions): Promise<string> {
		try {
			const result = await this.transport.request<unknown>({ method: "eth_chainId" }, options);
			if (typeof result !== "string") {
				throw new AbstractionKitError("BAD_DATA", "eth_chainId returned ill formed data", {
					context: JSON.stringify(result),
				});
			}
			return result;
		} catch (err) {
			throw translateNodeError(err, "eth_chainId");
		}
	}

	/**
	 * `eth_blockNumber`. Returns the latest block number as a bigint.
	 */
	async blockNumber(options?: RequestOptions): Promise<bigint> {
		try {
			const result = await this.transport.request<unknown>({ method: "eth_blockNumber" }, options);
			if (typeof result !== "string") {
				throw new AbstractionKitError("BAD_DATA", "eth_blockNumber returned ill formed data", {
					context: JSON.stringify(result),
				});
			}
			return BigInt(result);
		} catch (err) {
			throw translateNodeError(err, "eth_blockNumber");
		}
	}

	/**
	 * `eth_getCode`. Returns the deployed bytecode at `address` at the given
	 * block tag (default `"latest"`).
	 */
	async getCode(
		address: string,
		blockTag: string | bigint = "latest",
		options?: RequestOptions,
	): Promise<string> {
		try {
			const result = await this.transport.request<unknown>(
				{ method: "eth_getCode", params: [address, blockTag] },
				options,
			);
			if (typeof result !== "string") {
				throw new AbstractionKitError("BAD_DATA", "eth_getCode returned ill formed data", {
					context: JSON.stringify(result),
				});
			}
			return result;
		} catch (err) {
			throw translateNodeError(err, "eth_getCode");
		}
	}

	/**
	 * `eth_call`. Executes a read-only call against `to` and returns the raw
	 * return data as a hex string. Supports state overrides via the optional
	 * third parameter.
	 */
	async call(
		tx: EthCallTransaction,
		blockTag: string | bigint = "latest",
		stateOverrides?: object,
		options?: RequestOptions,
	): Promise<string> {
		const params: unknown[] =
			stateOverrides == null ? [tx, blockTag] : [tx, blockTag, stateOverrides];
		try {
			const result = await this.transport.request<unknown>(
				{ method: "eth_call", params },
				options,
			);
			if (typeof result !== "string") {
				throw new AbstractionKitError("BAD_DATA", "eth_call returned ill formed data", {
					context: JSON.stringify(result),
				});
			}
			return result;
		} catch (err) {
			throw translateNodeError(err, "eth_call");
		}
	}

	/**
	 * `eth_getTransactionCount`. Returns the transaction count (account nonce
	 * at the EOA level — not the EntryPoint nonce; see
	 * {@link JsonRpcNode.getEntryPointNonce}) as a bigint.
	 */
	async getTransactionCount(
		address: string,
		blockTag: string | bigint = "latest",
		options?: RequestOptions,
	): Promise<bigint> {
		try {
			const result = await this.transport.request<unknown>(
				{ method: "eth_getTransactionCount", params: [address, blockTag] },
				options,
			);
			if (typeof result !== "string") {
				throw new AbstractionKitError(
					"BAD_DATA",
					"eth_getTransactionCount returned ill formed data",
					{ context: JSON.stringify(result) },
				);
			}
			return BigInt(result);
		} catch (err) {
			throw translateNodeError(err, "eth_getTransactionCount");
		}
	}

	// ─── Higher-level helpers ────────────────────────────────────────────

	/**
	 * Fetch current gas prices and apply a level multiplier.
	 *
	 * Tries `eth_maxPriorityFeePerGas` + `eth_gasPrice` first (EIP-1559),
	 * falling back to `eth_gasPrice` alone if the priority-fee method is
	 * unsupported, and finally to a 1 gwei floor multiplied by `gasLevel`.
	 *
	 * @param gasLevel - {@link GasOption} multiplier (default: Medium = 1.2x)
	 * @returns `[maxFeePerGas, maxPriorityFeePerGas]` as bigints
	 */
	async getFeeData(
		gasLevel: GasOption = GasOption.Medium,
		options?: RequestOptions,
	): Promise<[bigint, bigint]> {
		try {
			let gasPrice: bigint | null = null;
			let maxPriorityFeePerGas: bigint | null = null;

			try {
				const result = await this.transport.request<unknown>(
					{ method: "eth_gasPrice" },
					options,
				);
				if (typeof result !== "string") {
					throw new AbstractionKitError(
						"BAD_DATA",
						"eth_gasPrice returned ill formed data",
						{ context: JSON.stringify(result) },
					);
				}
				gasPrice = BigInt(result);
			} catch (err) {
				if (!isMethodNotSupportedError(err)) throw err;
				// method unsupported on this node; fall through to gas-price-less branch
			}

			try {
				const result = await this.transport.request<unknown>(
					{ method: "eth_maxPriorityFeePerGas" },
					options,
				);
				if (typeof result !== "string") {
					throw new AbstractionKitError(
						"BAD_DATA",
						"eth_maxPriorityFeePerGas returned ill formed data",
						{ context: JSON.stringify(result) },
					);
				}
				maxPriorityFeePerGas = BigInt(result);
			} catch (err) {
				if (!isMethodNotSupportedError(err)) throw err;
				// older chains don't support this; fall through
			}

			let maxFeePerGas: bigint;
			let priorityFee: bigint;
			if (gasPrice != null && maxPriorityFeePerGas != null) {
				maxFeePerGas = scaleBigIntByGasLevel(gasPrice, gasLevel);
				priorityFee = scaleBigIntByGasLevel(maxPriorityFeePerGas, gasLevel);
			} else if (gasPrice != null) {
				maxFeePerGas = scaleBigIntByGasLevel(gasPrice, gasLevel);
				priorityFee = maxFeePerGas;
			} else {
				maxFeePerGas = scaleBigIntByGasLevel(1_000_000_000n, gasLevel);
				priorityFee = maxFeePerGas;
			}

			if (maxFeePerGas === 0n) maxFeePerGas = 1n;
			if (priorityFee === 0n) priorityFee = 1n;

			return [maxFeePerGas, priorityFee];
		} catch (err) {
			throw translateNodeError(err, "getFeeData");
		}
	}

	/**
	 * Check whether an address is EIP-7702-delegated and return the delegatee
	 * address. EIP-7702-delegated accounts have bytecode of the form
	 * `0xef0100<20-byte-delegatee>` per the spec.
	 *
	 * @returns The checksummed delegatee address, or `null` if not delegated
	 */
	async getDelegatedAddress(
		accountAddress: string,
		options?: RequestOptions,
	): Promise<string | null> {
		const code = (await this.getCode(accountAddress, "latest", options)).toLowerCase();
		if (code.length === 48 && code.startsWith("0xef0100")) {
			return getAddress(`0x${code.slice(8)}`);
		}
		return null;
	}

	/**
	 * Fetch the smart account's nonce from the EntryPoint contract via
	 * `eth_call`. This is the 4337 nonce (an EntryPoint-managed counter with
	 * 192-bit parallel keys), not the EOA `eth_getTransactionCount`.
	 *
	 * @param entryPoint - EntryPoint contract address
	 * @param account - Smart account address
	 * @param key - Nonce key as a `bigint` (default `0n`). Different keys allow
	 *   parallel nonce channels. `bigint` so the full `uint192` range is
	 *   representable (a JS `number` would cap at 2^53−1).
	 */
	async getEntryPointNonce(
		entryPoint: string,
		account: string,
		key: bigint = 0n,
		options?: RequestOptions,
	): Promise<bigint> {
		// getNonce(address,uint192) selector
		const getNonceSelector = "0x35567e1a";
		const abiCoder = AbiCoder.defaultAbiCoder();
		const params = abiCoder.encode(["address", "uint192"], [account, key]);
		const data = getNonceSelector + params.slice(2);

		const callResult = await this.call(
			{ from: ZERO_ADDRESS, to: entryPoint, data },
			"latest",
			undefined,
			options,
		);
		try {
			return BigInt(callResult);
		} catch (err) {
			throw new AbstractionKitError("BAD_DATA", "getNonce returned ill formed data", {
				cause: ensureError(err),
				context: callResult,
			});
		}
	}

	/**
	 * Get the EntryPoint deposit balance for an address.
	 *
	 * @returns The deposit balance in wei as a bigint
	 */
	async getEntryPointDeposit(
		address: string,
		entryPoint: string,
		options?: RequestOptions,
	): Promise<bigint> {
		const info = await this.getEntryPointDepositInfo(address, entryPoint, options);
		return info.deposit;
	}

	/**
	 * Get the full {@link DepositInfo} for an address from the EntryPoint
	 * contract.
	 */
	async getEntryPointDepositInfo(
		address: string,
		entryPoint: string,
		options?: RequestOptions,
	): Promise<DepositInfo> {
		// getDepositInfo(address) selector
		const getDepositInfoSelector = "0x5287ce12";
		const abiCoder = AbiCoder.defaultAbiCoder();
		const params = abiCoder.encode(["address"], [address]);
		const data = getDepositInfoSelector + params.slice(2);

		const callResult = await this.call(
			{ from: ZERO_ADDRESS, to: entryPoint, data },
			"latest",
			undefined,
			options,
		);
		try {
			const decoded = abiCoder.decode(
				["uint256", "bool", "uint112", "uint32", "uint48"],
				callResult,
			);
			if (decoded.length !== 5) {
				throw new AbstractionKitError("BAD_DATA", "getDepositInfo returned ill formed data", {
					context: JSON.stringify(decoded),
				});
			}
			return {
				deposit: BigInt(decoded[0]),
				staked: Boolean(decoded[1]),
				stake: BigInt(decoded[2]),
				unstakeDelaySec: BigInt(decoded[3]),
				withdrawTime: BigInt(decoded[4]),
			};
		} catch (err) {
			if (err instanceof AbstractionKitError) throw err;
			throw new AbstractionKitError("BAD_DATA", "getDepositInfo returned ill formed data", {
				cause: ensureError(err),
			});
		}
	}
}

/**
 * Apply a fractional `gasLevel` multiplier (e.g. 1.2 = 120%) to a `bigint`
 * gas price without going through JS number precision.
 *
 * The naive `BigInt(Math.ceil(Number(value) * gasLevel))` truncates any
 * `value` above `Number.MAX_SAFE_INTEGER` (2^53 − 1 ≈ 9.0 × 10^15 wei),
 * which is well within the range a chain can legitimately report
 * (especially on testnets, fork networks, or anomalous mainnet spikes).
 *
 * Approach: scale the multiplier into integer space (three-decimal precision
 * — sufficient for `GasOption` and any reasonable custom value), do the
 * multiplication in `BigInt`, then ceiling-divide back down. Preserves the
 * original `Math.ceil(...)` rounding behavior bit-for-bit on small values.
 *
 * @internal
 */
function scaleBigIntByGasLevel(value: bigint, gasLevel: number): bigint {
	const scale = 1000n;
	const scaledLevel = BigInt(Math.round(gasLevel * Number(scale)));
	return (value * scaledLevel + scale - 1n) / scale;
}

/**
 * Detect whether an error indicates the JSON-RPC method itself is not
 * implemented by the node. Used by {@link JsonRpcNode.getFeeData} to fall
 * back gracefully on chains that don't expose EIP-1559 fee methods, while
 * still surfacing transport, auth, and parse errors to the caller.
 *
 * @internal
 */
function isMethodNotSupportedError(err: unknown): boolean {
	const code = (err as ProviderRpcError | undefined)?.code;
	if (code === -32601) return true;
	const message = (err as Error | undefined)?.message?.toLowerCase() ?? "";
	return (
		message.includes("method not found") ||
		message.includes("not supported") ||
		message.includes("unsupported")
	);
}

/**
 * Translate a transport-level error (or already-wrapped {@link AbstractionKitError})
 * into the `NODE_ERROR` outer / specific inner shape used by {@link JsonRpcNode}.
 *
 * - `AbstractionKitError` passes through unchanged (already domain-translated).
 * - {@link ProviderRpcError} with a known JSON-RPC code → inner code from
 *   {@link JsonRpcErrorDict}.
 * - Anything else → inner `UNKNOWN_ERROR`.
 *
 * @internal
 */
function translateNodeError(err: unknown, method: string): AbstractionKitError {
	if (err instanceof AbstractionKitError) return err;
	const code = (err as ProviderRpcError | undefined)?.code;
	const codeString = code != null ? String(code) : "";
	const innerCode: JsonRpcErrorCode | BasicErrorCode =
		codeString in JsonRpcErrorDict ? JsonRpcErrorDict[codeString] : "UNKNOWN_ERROR";
	const error = ensureError(err);
	return new AbstractionKitError("NODE_ERROR", `node ${method} rpc call failed`, {
		cause: new AbstractionKitError(innerCode, error.message, {
			errno: code,
		}),
		errno: code,
	});
}
