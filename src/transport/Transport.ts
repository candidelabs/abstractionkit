/**
 * Core transport abstractions for abstractionkit.
 *
 * The transport layer is the SDK's single, swappable seam for talking to
 * external services (bundler, paymaster, JSON-RPC node). It is intentionally
 * shaped after [EIP-1193](https://eips.ethereum.org/EIPS/eip-1193) so that
 * browser wallet providers, WalletConnect, viem clients, and ethers'
 * `Eip1193Provider`-shaped objects can be passed in directly with no wrapper
 * code.
 *
 * The SDK ships exactly one concrete transport ({@link HttpTransport}). All
 * other behaviors — fallback, retry, hedging, logging, circuit breakers — are
 * intentionally left to the user to compose. See `FEATURE_TRANSPORT.md` for
 * the design rationale.
 */

/**
 * EIP-1193-shaped request arguments. Matches the 1193 `provider.request()`
 * args verbatim so 1193 providers drop in as a Transport with zero wrappers.
 */
export interface RequestArgs {
	readonly method: string;
	readonly params?: readonly unknown[] | object;
}

/**
 * Per-request options. Intentionally narrow at v1; the options-bag shape leaves
 * room to add `timeoutMs`, `headers`, `retryHint`, etc. in future minor
 * releases without further widening of {@link Transport.request}.
 *
 * Cancellation is best-effort: the awaited promise rejects on abort, but the
 * underlying network request may complete. This matches how viem and ethers
 * handle abort propagation.
 */
export interface RequestOptions {
	readonly signal?: AbortSignal;
}

/**
 * EIP-1193-shaped error. Throw an object matching this shape from a custom
 * {@link Transport} so the SDK's service classes (Bundler, JsonRpcNode,
 * paymaster) can introspect `code` and translate it into their own domain
 * error vocabulary.
 *
 * @see https://eips.ethereum.org/EIPS/eip-1193#provider-errors
 */
export interface ProviderRpcError extends Error {
	readonly code: number;
	readonly data?: unknown;
}

/**
 * Default {@link ProviderRpcError} implementation. {@link BaseRpcTransport}
 * throws this automatically when a JSON-RPC envelope returns
 * `{ error: { code, message, data } }`.
 */
export class TransportRpcError extends Error implements ProviderRpcError {
	readonly code: number;
	readonly data?: unknown;

	/**
	 * @param code - Numeric JSON-RPC error code (e.g. -32601 for METHOD_NOT_FOUND)
	 * @param message - Human-readable error description
	 * @param data - Optional additional data returned by the RPC server
	 */
	constructor(code: number, message: string, data?: unknown) {
		super(message);
		this.name = "TransportRpcError";
		this.code = code;
		this.data = data;
	}
}

/**
 * Minimum capability shared by every backend the SDK can talk to.
 *
 * The single `request` method takes an EIP-1193-shaped `{ method, params }`
 * argument object and returns a `Promise` resolving to the JSON-RPC `result`
 * field. The optional `options` bag carries per-request concerns like
 * cancellation.
 *
 * Implementations should:
 * - Throw a {@link ProviderRpcError}-shaped object on JSON-RPC error responses
 *   so high-level services can translate codes into their domain vocabulary.
 * - Forward `options.signal` to their underlying I/O when supported.
 *
 * @example Implementing a custom transport
 * ```ts
 * const myTransport: Transport = {
 *   async request({ method, params }, options) {
 *     // ... your I/O here, honoring options?.signal if possible
 *     return result;
 *   },
 * };
 * new Bundler(myTransport);
 * ```
 */
export interface Transport {
	request<T = unknown>(args: RequestArgs, options?: RequestOptions): Promise<T>;
}

/**
 * Optional subtype consumers narrow to when they need pub/sub subscriptions
 * (block headers, pending transactions, etc.). The SDK itself never narrows
 * to this — it's provided for downstream code that wants to write
 * `if (isEventfulTransport(t))` without monkey-patching the base contract.
 */
export interface EventfulTransport extends Transport {
	on(event: string, listener: (...args: unknown[]) => void): void;
	removeListener(event: string, listener: (...args: unknown[]) => void): void;
}

/**
 * Narrowing helper for {@link EventfulTransport}.
 *
 * @param transport - Any transport to test
 * @returns `true` when both `on` and `removeListener` methods are present
 */
export function isEventfulTransport(transport: Transport): transport is EventfulTransport {
	const t = transport as Partial<EventfulTransport>;
	return typeof t.on === "function" && typeof t.removeListener === "function";
}
