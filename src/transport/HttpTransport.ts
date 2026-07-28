import {BaseRpcTransport, type JsonRpcEnvelope} from "./BaseRpcTransport";
import {type RequestOptions, type Transport, TransportRpcError} from "./Transport";

/**
 * Construction options for {@link HttpTransport}.
 */
export interface HttpTransportOptions {
	/**
	 * Override the global `fetch`. Useful in environments without a global
	 * fetch (older Node, React Native edge cases) or to inject a polyfill,
	 * mock (msw, jest), or auth-aware wrapper (`undici`, `node-fetch`).
	 */
	fetch?: typeof globalThis.fetch;
	/**
	 * Static headers added to every request. Merged with the default
	 * `Content-Type: application/json` (which always wins for the body type).
	 */
	headers?: Record<string, string>;
}

/**
 * Default concrete {@link Transport}: POSTs JSON-RPC envelopes to an HTTP
 * endpoint. Used by every URL-string call site once a string is normalized
 * into a transport.
 *
 * @example
 * ```ts
 * const t = new HttpTransport("https://api.candide.dev/public/v3/11155111");
 * const chainId = await t.request<string>({ method: "eth_chainId" });
 *
 * // With auth headers and a custom fetch:
 * const t2 = new HttpTransport("https://...", {
 *   headers: { Authorization: `Bearer ${token}` },
 *   fetch: myFetchWithRetry,
 * });
 * ```
 */
export class HttpTransport extends BaseRpcTransport {
	/** Endpoint URL this transport POSTs to. */
	readonly url: string;
	/** Options passed at construction time. */
	readonly options: HttpTransportOptions;

	/**
	 * @param url - JSON-RPC endpoint URL (bundler, paymaster, or node)
	 * @param options - Optional fetch override and static headers
	 */
	constructor(url: string, options: HttpTransportOptions = {}) {
		super();
		this.url = url;
		this.options = options;
	}

	protected async send(envelope: JsonRpcEnvelope, options?: RequestOptions): Promise<unknown> {
		// Content-Type is fixed by this class (body is always a JSON-RPC
		// envelope), so it wins against any user-supplied header.
		const headers: Record<string, string> = {
			...(this.options.headers ?? {}),
			"Content-Type": "application/json",
		};
		const body = HttpTransport.serializeEnvelope(envelope);
		const fetchImpl = this.options.fetch ?? globalThis.fetch;
		const response = await fetchImpl(this.url, {
			method: "POST",
			headers,
			body,
			redirect: "follow",
			signal: options?.signal,
		});
		const responseText = await response.text();
		let parsed: unknown;
		try {
			parsed = JSON.parse(responseText);
		} catch {
			// non-JSON body (HTML error page, plain text) — the HTTP status is
			// the real diagnostic, so surface it instead of a JSON parse error
			throw new TransportRpcError(
				-32603,
				`HTTP ${response.status} ${response.statusText}: response body is not JSON`.trim(),
				responseText.slice(0, 1000),
			);
		}
		// Only a properly shaped JSON-RPC error object counts. A non-RPC JSON
		// error body (e.g. `{"error": "rate limited"}` from a gateway) must not
		// mask the HTTP status below.
		const rpcError =
			typeof parsed === "object" && parsed != null && "error" in parsed
				? (parsed as {error: unknown}).error
				: null;
		const hasRpcError =
			typeof rpcError === "object" &&
			rpcError != null &&
			typeof (rpcError as {code: unknown}).code === "number" &&
			typeof (rpcError as {message: unknown}).message === "string";
		if (!response.ok && !hasRpcError) {
			// On HTTP failure, only a JSON-RPC *error* envelope falls through
			// (parseResponse reports the server's error, e.g. a 429 rate
			// limit). Anything else — including a contradictory "result" — is
			// not trusted; the status is the real diagnostic.
			throw new TransportRpcError(
				-32603,
				`HTTP ${response.status} ${response.statusText}`.trim(),
				parsed,
			);
		}
		return parsed;
	}
}

/**
 * Narrowing helper for {@link HttpTransport}. Useful for code that wants to
 * read the underlying URL — e.g. when serializing a configured Bundler for
 * logging or diagnostics.
 *
 * @example
 * ```ts
 * if (isHttpTransport(bundler.transport)) {
 *   console.log("Bundler URL:", bundler.transport.url);
 * }
 * ```
 */
export function isHttpTransport(transport: Transport): transport is HttpTransport {
	return transport instanceof HttpTransport;
}
