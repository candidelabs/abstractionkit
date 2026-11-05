import type { Bundler } from "src/Bundler";
import { AbstractionKitError, ensureError } from "src/errors";
import type { UserOperationReceiptResult } from "src/types";

/**
 * Response object returned after submitting a UserOperation to a bundler.
 * Provides the `included()` method to poll for on-chain inclusion.
 *
 * @example
 * const response = await smartAccount.sendUserOperation(userOp, bundlerRpc);
 * const receipt = await response.included();
 */
export class SendUseroperationResponse {
	/** The hash of the submitted UserOperation */
	readonly userOperationHash: string;
	/** The bundler client used for polling */
	readonly bundler: Bundler;
	/** The EntryPoint address the operation was submitted to */
	readonly entrypointAddress: string;

	/**
	 * @param userOperationHash - The hash of the submitted UserOperation
	 * @param bundler - The bundler client to use for polling
	 * @param entrypointAddress - The EntryPoint address
	 */
	constructor(userOperationHash: string, bundler: Bundler, entrypointAddress: string) {
		this.bundler = bundler;
		this.userOperationHash = userOperationHash;
		this.entrypointAddress = entrypointAddress;
	}

	private delay(ms: number) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	/**
	 * Poll the bundler for the UserOperation receipt until it is included on-chain or times out.
	 *
	 * @param timeoutInSeconds - Maximum time to wait for inclusion (default: 180s)
	 * @param requestIntervalInSeconds - Time between polling requests (default: 2s)
	 * @returns The UserOperation receipt once included
	 * @throws RangeError if timeout or interval are <= 0, or timeout < interval
	 * @throws AbstractionKitError with code "TIMEOUT" if the operation is not found within the
	 * timeout (wall-clock). A failed poll does not end the wait; if the wait times out, the last
	 * poll failure is the error's `cause`.
	 * @throws the poll's own error, without waiting out the timeout, when retrying cannot help:
	 * the bundler rejected the request itself (JSON-RPC -32600 invalid request, -32601 method
	 * not found, -32602 invalid params, e.g. a malformed hash).
	 */
	async included(
		timeoutInSeconds: number = 180,
		requestIntervalInSeconds: number = 2,
	): Promise<UserOperationReceiptResult> {
		// `!(x > 0)` also rejects NaN, which `x <= 0` lets through
		if (!(timeoutInSeconds > 0) || !(requestIntervalInSeconds > 0)) {
			throw new RangeError(
				"timeoutInSeconds and requestIntervalInSeconds should be bigger than zero",
			);
		}
		if (timeoutInSeconds < requestIntervalInSeconds) {
			throw new RangeError("timeoutInSeconds can't be less than requestIntervalInSeconds");
		}
		// The timeout is wall-clock time. Counting the sleeps alone ignored how
		// long each request took, so a slow bundler stretched the wait to
		// several times the timeout.
		const intervalInMilliseconds = requestIntervalInSeconds * 1000;
		const deadline = Date.now() + timeoutInSeconds * 1000;
		let lastError: Error | undefined;
		while (true) {
			// The last sleep is cut short so the final poll lands on the
			// deadline instead of up to one interval before it.
			const remaining = deadline - Date.now();
			if (remaining <= 0) {
				break;
			}
			await this.delay(Math.min(intervalInMilliseconds, remaining));
			try {
				const res = await this.bundler.getUserOperationReceipt(this.userOperationHash);
				if (res != null) {
					return res;
				}
				lastError = undefined;
			} catch (err) {
				const error = ensureError(err);
				// A request the bundler rejects as such fails the same way on
				// every poll; report it now rather than after the timeout.
				if (isPermanentPollError(error)) {
					throw error;
				}
				// One failed poll (a 502, a dropped connection) says nothing
				// about the operation. Keep polling and report the last
				// failure if the wait times out.
				lastError = error;
			}
		}
		throw new AbstractionKitError("TIMEOUT", "can't find useroperation", {
			context: this.userOperationHash,
			cause: lastError,
		});
	}
}

/**
 * JSON-RPC codes for a request the server refuses as such: invalid request,
 * method not found, invalid params. Retrying the same request cannot succeed.
 */
const PERMANENT_JSON_RPC_CODES = new Set([-32600, -32601, -32602]);

/**
 * Whether a failed receipt poll will fail the same way on every retry.
 * {@link Bundler} reports the JSON-RPC code as `errno`; a raw transport error
 * carries it as `code`.
 */
function isPermanentPollError(error: Error): boolean {
	const { errno, code } = error as Error & { errno?: unknown; code?: unknown };
	const rpcCode = typeof errno === "number" ? errno : code;
	return typeof rpcCode === "number" && PERMANENT_JSON_RPC_CODES.has(rpcCode);
}
