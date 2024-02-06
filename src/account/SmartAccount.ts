export abstract class SmartAccount {
	readonly accountAddress: string;
	static readonly proxyByteCode: string;
	static readonly initializerFunctionSelector: string;
	static readonly initializerFunctionInputAbi: string[];
	static readonly executorFunctionSelector: string;
	static readonly executorFunctionInputAbi: string[];

	constructor(accountAddress: string) {
		this.accountAddress = accountAddress;
	}
}
