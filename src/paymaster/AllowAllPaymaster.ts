import { Paymaster } from "./Paymaster";
import { PaymasterFieldsInitValues, UserOperationV9 } from "../types";

/**
 * A paymaster that sponsors all UserOperations unconditionally.
 * Uses a fixed magic signature that the on-chain paymaster contract accepts
 * without additional validation.
 *
 * **WARNING: FOR DEVELOPMENT AND TESTING ONLY.**
 * This paymaster accepts all operations without validation and should
 * not be used in production environments. Use CandidePaymaster for prod.
 */
export class AllowAllPaymaster extends Paymaster {
	/** The on-chain paymaster contract address. */
	readonly address: string;

	/**
	 * @param address - Paymaster contract address. Defaults to the canonical AllowAll deployment.
	 */
	constructor(address: string = "0x36A337b8b4cE5CF6ca1dDaeef73Da4928d714DF2") {
		super();
		this.address = address;
	}

	/**
	 * Returns initial paymaster fields (address, gas limits, and data) for
	 * UserOperation construction before gas estimation.
	 * @param chainId - The chain ID (unused, kept for interface compatibility)
	 * @returns Paymaster fields with the magic signature as paymasterData
	 */
	async getPaymasterFieldsInitValues(
        chainId: bigint
    ):Promise<PaymasterFieldsInitValues>{
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
	async getApprovedPaymasterData(userOperation: UserOperationV9):Promise<string>{
        // the allow all paymaster only checks for this fixed signature
        return "0x7603fbcd3c6cebdb7193b716f62fe7e9d4afd859df4bf7fcdb2e9d486f57a1ca"
            + "0020" // signature length
            + "22e325a297439656"; // PAYMASTER_SIG_MAGIC
    }
}
