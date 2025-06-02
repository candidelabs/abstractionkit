import { AbstractionKitError } from "src/errors";
import { MetaTransaction } from "../../../types";
import { SafeAccount } from "../SafeAccount";
import { AbiCoder } from "ethers";

export abstract class SafeModule {
	readonly moduleAddress: string;
    protected readonly abiCoder:AbiCoder;

	constructor(moduleAddress: string) {
		this.moduleAddress = moduleAddress;
        this.abiCoder = AbiCoder.defaultAbiCoder();
	}

    /**
	 * create MetaTransaction to enable this module
	 * @param accountAddress - Safe account to enable the module for
	 * @returns a MetaTransaction
	 */
    public createEnableModuleMetaTransaction(
        accountAddress: string,
    ):MetaTransaction{
        return SafeAccount.createEnableModuleMetaTransaction(
            this.moduleAddress,
            accountAddress
        );
    }

    public checkForEmptyResultAndRevert(
        result: string, requestName: string
    ): void {
        if(result == "0x"){
            throw new AbstractionKitError(
				"BAD_DATA",
				requestName + " returned 0x, " +
                "module contract " + this.moduleAddress + 
                " is probably not deployed"
            );
        } 
    }
}
