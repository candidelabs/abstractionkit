import { BytesLike } from "ethers";

export class SmartAccount {
	readonly accountAddress: string;
	static readonly proxyByteCode: BytesLike;
	static readonly initializerFunctionSelector: string;
	static readonly initializerFunctionInputAbi: string[];
	static readonly executorFunctionSelector: string;
	static readonly executorFunctionInputAbi: string[];

	constructor(accountAddress: string) {
		this.accountAddress = accountAddress;
	}
}
