import type { BytesLike } from "ethers";
import type { AbiInputValue } from "../types";
import { getCallData } from "../utils";

export class SmartAccountFactory {
	readonly address: string;
	readonly generatorFunctionSelector: string;
	readonly generatorFunctionInputAbi: string[];

	constructor(
		address: string,
		generatorFunctionSelector: string,
		generatorFunctionInputAbi: string[],
	) {
		this.address = address;
		this.generatorFunctionSelector = generatorFunctionSelector;
		this.generatorFunctionInputAbi = generatorFunctionInputAbi;
	}

	getFactoryGeneratorFunctionCallData(
		generatorFunctionInputParameters: AbiInputValue[],
	): BytesLike {
		const callData = getCallData(
			this.generatorFunctionSelector,
			this.generatorFunctionInputAbi,
			generatorFunctionInputParameters,
		) as string;
		const res: string = this.address + callData.slice(2);

		return res;
	}
}
