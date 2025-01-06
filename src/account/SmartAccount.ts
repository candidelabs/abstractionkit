import { DepositInfo, getBalanceOf, getDepositInfo } from "src/utils";

export abstract class SmartAccount {
	readonly accountAddress: string;
	readonly entrypointAddress: string;
	static readonly proxyByteCode: string;
	static readonly initializerFunctionSelector: string;
	static readonly initializerFunctionInputAbi: string[];
	static readonly executorFunctionSelector: string;
	static readonly executorFunctionInputAbi: string[];

	constructor(accountAddress: string, entrypointAddress: string) {
		this.accountAddress = accountAddress;
        this.entrypointAddress = entrypointAddress;
	}

    public async getDepositInfo(nodeRpcUrl: string): Promise<DepositInfo> {
       return getDepositInfo(nodeRpcUrl, this.accountAddress, this.entrypointAddress);
    }
    
    public async getBalanceOf(nodeRpcUrl: string): Promise<bigint> {
       return getBalanceOf(nodeRpcUrl, this.accountAddress, this.entrypointAddress);
    }
}
