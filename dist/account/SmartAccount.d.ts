import type { BytesLike, BigNumberish } from "ethers";
import { AbiInputValue } from "../types";
export declare class SmartAccount {
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
	);
	getInitializerCallData(
		initializerFunctionInputParameters: AbiInputValue[],
	): BytesLike;
	getExecutorCallData(
		executorFunctionInputParameters: AbiInputValue[],
	): BytesLike;
	getProxyAddress(
		initializerCallData: BytesLike,
		factoryAddress: string,
		c2Nonce: BigNumberish,
	): string;
}
//# sourceMappingURL=SmartAccount.d.ts.map
