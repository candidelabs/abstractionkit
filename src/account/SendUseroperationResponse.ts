import { Bundler } from "src/Bundler";
import { AbstractionKitError } from "src/errors";
import { UserOperationReceiptResult } from "src/types";

/**
 * Response object returned after submitting a UserOperation to a bundler.
 * Provides methods to poll for the operation's inclusion in a block.
 *
 * @example
 * const response = await smartAccount.sendUserOperation(userOp, bundlerRpcUrl);
 * console.log("UserOp hash:", response.userOperationHash);
 * const receipt = await response.included(); // waits for on-chain inclusion
 */
export class SendUseroperationResponse {
	/** The UserOperation hash, used to track this operation */
	readonly userOperationHash: string;
	/** The Bundler instance used to poll for the receipt */
	readonly bundler: Bundler;
	/** The EntryPoint address the operation was submitted to */
	readonly entrypointAddress: string;

	/**
	 * @param userOperationHash - The hash returned by the bundler after submission
	 * @param bundler - The Bundler instance to use for polling
	 * @param entrypointAddress - The EntryPoint contract address
	 */
	constructor(
		userOperationHash: string,
		bundler: Bundler,
		entrypointAddress: string,
	) {
		this.bundler = bundler;
		this.userOperationHash = userOperationHash;
		this.entrypointAddress = entrypointAddress;
	}

	private delay(ms: number) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	/**
	 * Poll the bundler until the UserOperation is included on-chain or the timeout is reached.
	 *
	 * @param timeoutInSeconds - Maximum time to wait before throwing a TIMEOUT error (default: 180)
	 * @param requestIntervalInSeconds - Time between polling requests in seconds (default: 2)
	 * @returns The UserOperation receipt once included
	 * @throws RangeError if timeoutInSeconds or requestIntervalInSeconds are <= 0, or if timeout < interval
	 * @throws AbstractionKitError with code "TIMEOUT" if the operation is not found within the timeout
	 *
	 * @example
	 * const receipt = await response.included(120, 3);
	 * if (receipt?.success) {
	 *   console.log("Transaction hash:", receipt.receipt.transactionHash);
	 * }
	 */
	async included(
		timeoutInSeconds: number = 180,
		requestIntervalInSeconds: number = 2,
	): Promise<UserOperationReceiptResult> {
		if (timeoutInSeconds <= 0 || requestIntervalInSeconds <= 0) {
			throw RangeError(
				"timeoutInSeconds and requestIntervalInSeconds should be bigger than zero",
			);
		}
		if (timeoutInSeconds < requestIntervalInSeconds) {
			throw RangeError(
				"timeoutInSeconds can't be less than requestIntervalInSeconds",
			);
		}
		let count = 0;
		while (count <= timeoutInSeconds) {
			await this.delay(requestIntervalInSeconds * 1000);
			const res = await this.bundler.getUserOperationReceipt(
				this.userOperationHash,
			);
			if (res == null) {
				count++;
			} else {
				return res;
			}
		}
		throw new AbstractionKitError("TIMEOUT", "can't find useroperation", {
			context: this.userOperationHash,
		});
	}
}
