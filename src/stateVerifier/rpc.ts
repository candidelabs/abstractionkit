/**
 * Minimal JSON-RPC client with per-call timeout and exponential backoff retry.
 * Used internally by the state verifier module. Not exported from the package.
 *
 * @internal
 */
export async function jsonRpcCall<T = unknown>(params: {
  url: string;
  method: string;
  params: unknown[];
  timeoutMs?: number;
  retries?: number;
}): Promise<T> {
  const { url, method, params: rpcParams, timeoutMs = 10_000, retries = 0 } = params;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      // Exponential backoff: 500ms, 1s, 2s, capped at 2s for further retries.
      const delayMs = Math.min(500 * Math.pow(2, attempt - 1), 2000);
      await new Promise((r) => setTimeout(r, delayMs));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: rpcParams }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} from ${url}`);
      }
      const data = (await res.json()) as { result?: T; error?: { message: string } };
      if (data.error) {
        throw new Error(`${method} error: ${data.error.message}`);
      }
      return data.result as T;
    } catch (e) {
      lastError = e;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}
