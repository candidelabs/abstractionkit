import {type RequestArgs, type RequestOptions, type Transport, TransportRpcError,} from "./Transport";

/**
 * JSON-RPC 2.0 envelope. The shape sent by {@link BaseRpcTransport.request} to
 * its subclass `send` implementation.
 */
export interface JsonRpcEnvelope {
	readonly jsonrpc: "2.0";
	readonly id: number;
	readonly method: string;
	readonly params?: unknown;
}

/**
 * JSON-RPC 2.0 response. Either `result` or `error` is set.
 */
type JsonRpcResponseEnvelope =
	| { jsonrpc?: string; id: number | string | null; result: unknown }
	| {
			jsonrpc?: string;
			id: number | string | null;
			error: { code: number; message: string; data?: unknown };
	  };

/**
 * Optional convenience base class for users writing new wire-level
 * {@link Transport} backends (WebSocket, IPC, custom HTTP, in-process mock,
 * etc.). Handles JSON-RPC framing, id assignment, bigint serialization, and
 * standard error parsing so subclasses implement only the byte-level
 * `send(envelope, options)` hook.
 *
 * Users who already have a {@link Transport} in hand (window.ethereum, viem
 * `WalletClient`, ethers `Eip1193Provider`-shaped object, etc.) do NOT need
 * this class — they pass their object directly.
 *
 * @example
 * ```ts
 * class WebSocketTransport extends BaseRpcTransport {
 *   protected async send(envelope) {
 *     // serialize envelope to JSON, send over the socket, await response
 *     return JSON.parse(await this.socket.sendAndAwait(JSON.stringify(envelope)));
 *   }
 * }
 * ```
 */
export abstract class BaseRpcTransport implements Transport {
	private nextId = 1;

	/**
	 * Build a JSON-RPC envelope, delegate the wire I/O to the subclass's
	 * {@link BaseRpcTransport.send} method, and parse the response.
	 *
	 * @throws {@link TransportRpcError} when the response contains an `error` field
	 * @throws {@link TransportRpcError} (code -32603) when the response is malformed
	 */
	async request<T = unknown>(args: RequestArgs, options?: RequestOptions): Promise<T> {
		const envelope: JsonRpcEnvelope = {
			jsonrpc: "2.0",
			id: this.nextId++,
			method: args.method,
			params: args.params,
		};
		const raw = await this.send(envelope, options);
		return BaseRpcTransport.parseResponse<T>(raw);
	}

	/**
	 * Subclass hook. Send a JSON-RPC envelope and return the parsed response.
	 *
	 * Subclasses are responsible for JSON-encoding the envelope (using
	 * {@link BaseRpcTransport.serializeEnvelope} for correct bigint handling)
	 * and JSON-decoding the response. They should forward `options.signal` to
	 * their underlying I/O when supported.
	 *
	 * @param envelope - JSON-RPC 2.0 envelope to send
	 * @param options - Per-request options (cancellation, etc.)
	 * @returns The decoded JSON-RPC response object
	 */
	protected abstract send(envelope: JsonRpcEnvelope, options?: RequestOptions): Promise<unknown>;

	/**
	 * Serialize a JSON-RPC envelope to a string, converting bigint values to
	 * `0x`-prefixed hex strings (preserving the historical SDK behavior).
	 */
	protected static serializeEnvelope(envelope: JsonRpcEnvelope): string {
		return JSON.stringify(envelope, (_key, value) =>
			// biome-ignore lint/suspicious/noExplicitAny: JSON.stringify replacer signature
			typeof value === "bigint" ? `0x${(value as bigint).toString(16)}` : (value as any),
		);
	}

	/**
	 * Parse a decoded JSON-RPC response. Returns the `result` field on success
	 * or throws a {@link TransportRpcError} on error / malformed response.
	 */
	private static parseResponse<T>(raw: unknown): T {
		if (raw == null || typeof raw !== "object") {
			throw new TransportRpcError(-32603, "malformed JSON-RPC response", raw);
		}
		const response = raw as JsonRpcResponseEnvelope;
		if ("error" in response) {
			const { code, message, data } = response.error;
			throw new TransportRpcError(code, message, data);
		}
		if ("result" in response) {
			return response.result as T;
		}
		throw new TransportRpcError(-32603, "malformed JSON-RPC response", raw);
	}
}
