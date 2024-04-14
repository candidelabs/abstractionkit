import { MetaTransaction } from "../../../types";
import {
	createCallData,
	getFunctionSelector,
} from "../../../utils";


export abstract class SafeModule {
	readonly moduleAddress: string;

	constructor(moduleAddress: string) {
		this.moduleAddress = moduleAddress;
	}

    /**
	 * create MetaTransaction to enable this module
	 * @param accountAddress - Safe account to enable the module for
	 * @returns a MetaTransaction
	 */
    public createEnableModuleMetaTransaction(
        accountAddress: string,
    ):MetaTransaction{
        const functionSignature = "enableModule(address)";
        const functionSelector = getFunctionSelector(
            functionSignature,
        );
        const callData = createCallData(
            functionSelector,
            ["address"],
            [this.moduleAddress],
        );
        return {
            to:accountAddress,
            data: callData,
            value: 0n
        }
    }
}
