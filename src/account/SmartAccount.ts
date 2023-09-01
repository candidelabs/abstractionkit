import type { BytesLike } from "ethers";
import { AbiInputValue } from "../types";
import { getCallData } from "../utils";

export class SmartAccount {
	readonly singletonAddress: string;
	readonly proxyByteCode: BytesLike;
	readonly initializerFunctionSelector: string;
	readonly initializerFunctionInputAbi: string[];
	readonly executorFunctionSelector: string;
	readonly executorFunctionInputAbi: string[];

	constructor(
		singletonAddress: string,
		proxyByteCode: BytesLike,
		initializerFunctionSelector: string,
		initializerFunctionInputAbi: string[],
		executorFunctionSelector: string,
		executorFunctionInputAbi: string[],
	) {
		this.singletonAddress = singletonAddress;
		this.proxyByteCode = proxyByteCode;
		this.initializerFunctionSelector = initializerFunctionSelector;
		this.initializerFunctionInputAbi = initializerFunctionInputAbi;
		this.executorFunctionSelector = executorFunctionSelector;
		this.executorFunctionInputAbi = executorFunctionInputAbi;
	}

	getInitializerCallData(
		initializerFunctionInputParameters: AbiInputValue[],
	): BytesLike {
		const callData = getCallData(
			this.initializerFunctionSelector,
			this.initializerFunctionInputAbi,
			initializerFunctionInputParameters,
		);
		return callData;
	}

	getExecutorCallData(
		executorFunctionInputParameters: AbiInputValue[],
	): BytesLike {
		const callData = getCallData(
			this.executorFunctionSelector,
			this.executorFunctionInputAbi,
			executorFunctionInputParameters,
		);
		return callData;
	}
}
