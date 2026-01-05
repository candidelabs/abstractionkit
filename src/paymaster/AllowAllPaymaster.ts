import { Paymaster } from "./Paymaster";
import { PaymasterFieldsInitValues, UserOperationV9 } from "../types";

export class AllowAllPaymaster extends Paymaster {
	readonly address: string;

	constructor(address: string = "0x3eebbf9cC5F40eF5F9E54466F9b81677bBd99476") {
		super();
		this.address = address;
	}

	async getPaymasterFieldsInitValues(chainId: bigint):Promise<PaymasterFieldsInitValues>{
        return {
            paymaster: this.address,
            paymasterVerificationGasLimit: 45_000n,
            paymasterPostOpGasLimit: 45_000n,
            paymasterData:"0x22e325a297439656" // PAYMASTER_SIG_MAGIC
        };
    }

	/**
	 * getApprovedPaymasterData will return a valid paymasterData
     * This function is async to simulate a paymaster service
     * that require an http call to fetch approved data.
	 * @param userOperation - User operation to be sponsored
	 * @returns a promise of string
	 */
	async getApprovedPaymasterData(
		userOperation: UserOperationV9,
	):Promise<string>{
       return "0x7603fbcd3c6cebdb7193b716f62fe7e9d4afd859df4bf7fcdb2e9d486f57a1ca" // the allow all paymaster only checks for this fixed signature
            + "0020" // signature length
            + "22e325a297439656"; // PAYMASTER_SIG_MAGIC
    }
}
