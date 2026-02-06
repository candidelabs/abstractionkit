/**
 * Abstract base class for all ERC-4337 smart account implementations.
 * Defines the shared interface that concrete account types (e.g., SafeAccountV0_2_0)
 * must implement, including proxy bytecode, initializer encoding, and executor encoding.
 */
export abstract class SmartAccount {
	/** The on-chain address of this smart account */
	readonly accountAddress: string;
	/** Bytecode of the proxy contract deployed for each account instance */
	static readonly proxyByteCode: string;
	/** 4-byte function selector for the account's initializer (called during deployment) */
	static readonly initializerFunctionSelector: string;
	/** ABI types for the initializer function parameters */
	static readonly initializerFunctionInputAbi: string[];
	/** 4-byte function selector for the account's executor (called for each UserOperation) */
	static readonly executorFunctionSelector: string;
	/** ABI types for the executor function parameters */
	static readonly executorFunctionInputAbi: string[];

	/**
	 * Create a SmartAccount instance for an already-known account address.
	 *
	 * @param accountAddress - The on-chain address of the smart account
	 */
	constructor(accountAddress: string) {
		this.accountAddress = accountAddress;
	}
}
