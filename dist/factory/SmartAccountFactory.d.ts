import type { BytesLike } from "ethers";
import type { AbiInputValue } from "../types";
export declare class SmartAccountFactory {
	readonly address: string;
	readonly generatorFunctionSelector: string;
	readonly generatorFunctionInputAbi: string[];
	constructor(
		address: string,
		generatorFunctionSelector: string,
		generatorFunctionInputAbi: string[],
	);
	getFactoryGeneratorFunctionCallData(
		generatorFunctionInputParameters: AbiInputValue[],
	): BytesLike;
}
//# sourceMappingURL=SmartAccountFactory.d.ts.map
