import type {RequestArgs, RequestOptions, Transport} from "./Transport";

/**
 * Recursively convert any `bigint` values inside an RPC param to `0x`-prefixed
 * hex strings, descending into arrays and plain objects. Other values pass
 * through unchanged.
 *
 * Required for user-supplied {@link Transport} implementations that don't go
 * through {@link BaseRpcTransport.serializeEnvelope} (EIP-1193 providers, viem
 * clients, etc.) and would otherwise see raw `bigint`s in `params`. Mirrors the
 * normalization done in {@link sendJsonRpcRequest}.
 *
 * @internal
 */
export function normalizeRpcValue(value: unknown): unknown {
	if (typeof value === "bigint") return `0x${value.toString(16)}`;
	if (Array.isArray(value)) return value.map(normalizeRpcValue);
	if (value !== null && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value)) out[k] = normalizeRpcValue(v);
		return out;
	}
	return value;
}

/**
 * Wrap a {@link Transport} so every outbound `request` has its `params`
 * normalized (bigints → 0x-hex) before delegation. Idempotent: wrapping an
 * already-normalizing transport is harmless because the second pass sees only
 * strings.
 *
 * Applied once at each service boundary (Bundler, CandidePaymaster,
 * Erc7677Paymaster, JsonRpcNode, …) so normalization is impossible to forget
 * per-method. Required for user-supplied transports (EIP-1193 providers, viem
 * clients, etc.) that don't route through {@link BaseRpcTransport.serializeEnvelope}.
 *
 * @internal
 */
export function normalizingTransport(inner: Transport): Transport {
	return {
		request<T = unknown>(args: RequestArgs, options?: RequestOptions) {
			const params =
				args.params == null
					? args.params
					: (normalizeRpcValue(args.params) as readonly unknown[] | object);
			return inner.request<T>({method: args.method, params}, options);
		},
	};
}
