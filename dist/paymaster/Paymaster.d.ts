import "ethers";
import type { BytesLike } from "ethers";
import type { UserOperation, AbiInputValue } from "src/types";
export declare abstract class Paymaster {
	readonly address: string;
	constructor(address: string);
	abstract getPaymasterCallData(
		userOperation: UserOperation,
		config: AbiInputValue,
	): BytesLike;
	abstract getPaymasterCallDataAndEstimateGas(
		userOperation: UserOperation,
		config: AbiInputValue,
	): UserOperation;
}
//# sourceMappingURL=Paymaster.d.ts.map
