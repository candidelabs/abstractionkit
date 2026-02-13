/**
 * Abstract base class for all smart account implementations.
 * Defines common properties shared across account types (Safe, Simple, etc.).
 */
export abstract class SmartAccount {
	/** The on-chain address of the smart account */
	readonly accountAddress: string;
	/** Proxy contract creation bytecode */
	static readonly proxyByteCode: string;
	/** 4-byte function selector for the account initializer */
	static readonly initializerFunctionSelector: string;
	/** ABI types for the initializer function parameters */
	static readonly initializerFunctionInputAbi: string[];
	/** 4-byte function selector for the executor function */
	static readonly executorFunctionSelector: string;
	/** ABI types for the executor function parameters */
	static readonly executorFunctionInputAbi: string[];

	/**
	 * @param accountAddress - The on-chain address of the smart account
	 */
	constructor(accountAddress: string) {
		this.accountAddress = accountAddress;
	}
}
