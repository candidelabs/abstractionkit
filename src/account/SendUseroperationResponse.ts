import type { Bundler } from "src/Bundler";
import { AbstractionKitError } from "src/errors";
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
	 * @throws AbstractionKitError with code "TIMEOUT" if the operation is not found within the timeout
	 */
	async included(
		timeoutInSeconds: number = 180,
		requestIntervalInSeconds: number = 2,
	): Promise<UserOperationReceiptResult> {
		if (timeoutInSeconds <= 0 || requestIntervalInSeconds <= 0) {
			throw new RangeError(
				"timeoutInSeconds and requestIntervalInSeconds should be bigger than zero",
			);
		}
		if (timeoutInSeconds < requestIntervalInSeconds) {
			throw new RangeError("timeoutInSeconds can't be less than requestIntervalInSeconds");
		}
		let count = 0;
		while (count <= timeoutInSeconds) {
			await this.delay(requestIntervalInSeconds * 1000);
			const res = await this.bundler.getUserOperationReceipt(this.userOperationHash);
			if (res == null) {
				count += requestIntervalInSeconds;
			} else {
				return res;
			}
		}
		throw new AbstractionKitError("TIMEOUT", "can't find useroperation", {
			context: this.userOperationHash,
		});
	}
}
