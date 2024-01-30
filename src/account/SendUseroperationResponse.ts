import { Bundler } from "src/Bundler";
import { AbstractionKitError } from "src/errors";
import { UserOperationReceiptResult } from "src/types";

export class SendUseroperationResponse {
	readonly userOperationHash: string;
	readonly bundler: Bundler;
	readonly entrypointAddress: string;

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
	 * Query the bundler for the useroperation receipt repeatedly
	 * and return when successful or timeout
	 * @param timeoutInSeconds - number of seconds to stop trying after
	 * @param requestIntervalInSeconds - time between getUserOperationReceipt request
	 * @returns UserOperationReceiptResult
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
