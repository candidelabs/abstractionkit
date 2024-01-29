import type { AbiInputValue } from "../types";
import { createCallData } from "../utils";

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
	): string {
		const callData = createCallData(
			this.generatorFunctionSelector,
			this.generatorFunctionInputAbi,
			generatorFunctionInputParameters,
		);
		const res: string = this.address + callData.slice(2);

		return res;
	}
}
