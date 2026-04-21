import { AbiCoder } from "ethers";
import { AbstractionKitError } from "src/errors";
import type { MetaTransaction } from "../../../types";
import { SafeAccount } from "../SafeAccount";

/**
 * Abstract base class for Safe modules. Provides shared utilities for
 * encoding calldata, enabling the module, and validating on-chain results.
 */
export abstract class SafeModule {
	readonly moduleAddress: string;
	protected readonly abiCoder: AbiCoder;

	/**
	 * @param moduleAddress - The deployed address of the Safe module contract.
	 */
	constructor(moduleAddress: string) {
		this.moduleAddress = moduleAddress;
		this.abiCoder = AbiCoder.defaultAbiCoder();
	}

	/**
	 * create MetaTransaction to enable this module
	 * @param accountAddress - Safe account to enable the module for
	 * @returns a MetaTransaction
	 */
	public createEnableModuleMetaTransaction(accountAddress: string): MetaTransaction {
		return SafeAccount.createEnableModuleMetaTransaction(this.moduleAddress, accountAddress);
	}

	/**
	 * Throws if the RPC call returned empty data (`0x`), which typically
	 * indicates the module contract is not deployed at the expected address.
	 * @param result - The raw hex result from an `eth_call`.
	 * @param requestName - Name of the calling method, used in the error message.
	 */
	public checkForEmptyResultAndRevert(result: string, requestName: string): void {
		if (result === "0x") {
			throw new AbstractionKitError(
				"BAD_DATA",
				requestName +
					" returned 0x, " +
					"module contract " +
					this.moduleAddress +
					" is probably not deployed",
			);
		}
	}
}
