import { Bundler } from "src/Bundler";
import {
	BundlerErrorCode,
	BundlerJsonRpcError,
	UserOperationReceiptResult,
} from "src/types";

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

	async included(
		timeoutInSeconds: number = 60,
		requestIntervalInSeconds: number = 1,
	): Promise<UserOperationReceiptResult | BundlerJsonRpcError> {
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
		let error = {} as BundlerJsonRpcError;
		while (count <= timeoutInSeconds) {
			await this.delay(requestIntervalInSeconds * 1000);
			const res = await this.bundler.getUserOperationReceipt(
				this.userOperationHash,
			);
			if ("code" in res) {
				if (
					res["code"] == (BundlerErrorCode.InvalidUseroperationHash as number)
				) {
					count++;
					error = res;
				} else {
					return res;
				}
			} else {
				return res;
			}
		}
		return error;
	}
}
