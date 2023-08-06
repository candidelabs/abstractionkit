import "ethers";
import type { BytesLike } from "ethers";
import type { UserOperation, JsonRpcError } from "src/types";

export abstract class Paymaster {
	readonly address: string;

	constructor(address: string) {
		this.address = address;
	}

	abstract getPaymasterCallData(
		userOperation: UserOperation,
		config: string[],
	): Promise<BytesLike | JsonRpcError>;
	abstract getPaymasterCallDataAndEstimateGas(
		userOperation: UserOperation,
		config: string[],
	): Promise<BytesLike | JsonRpcError>;
}
