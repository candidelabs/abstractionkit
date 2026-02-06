/**
 * UserOperation for EntryPoint v0.6.
 * Contains all fields needed to submit an account-abstracted transaction
 * via the ERC-4337 EntryPoint v0.6 contract.
 */
export type UserOperation = {
	/** The account making the operation */
	sender: string;
	/** Anti-replay parameter; also used as the salt for first-time account creation */
	nonce: bigint;
	/** Concatenated factory address and factory-specific data for deploying a new account (empty "0x" if account already deployed) */
	initCode: string;
	/** The calldata to execute on the sender account */
	callData: string;
	/** Gas limit for the inner account execution */
	callGasLimit: bigint;
	/** Gas limit for the account verification step */
	verificationGasLimit: bigint;
	/** Extra gas to pay the bundler (covers calldata cost, EntryPoint overhead, etc.) */
	preVerificationGas: bigint;
	/** Maximum fee per gas (similar to EIP-1559 max_fee_per_gas) */
	maxFeePerGas: bigint;
	/** Maximum priority fee per gas (similar to EIP-1559 max_priority_fee_per_gas) */
	maxPriorityFeePerGas: bigint;
	/** Concatenated paymaster address and paymaster-specific data (empty "0x" for self-funded operations) */
	paymasterAndData: string;
	/** Signature over the UserOperation hash, verified during the verification step */
	signature: string;
};

/**
 * Union type for values that can be ABI-encoded as function parameters.
 * Supports strings, bigints, numbers, booleans, and nested arrays of these types.
 */
export type AbiInputValue =
	| string
	| bigint
	| number
	| boolean
	| AbiInputValue[];

/**
 * Union type for JSON-RPC request parameters.
 * Supports strings, bigints, booleans, objects, and nested arrays of these types.
 */
export type JsonRpcParam = string | bigint | boolean | object | JsonRpcParam[];

/**
 * Standard JSON-RPC 2.0 response envelope.
 */
export type JsonRpcResponse = {
	/** Request identifier (matches the id sent in the request) */
	id: number | null;
	/** JSON-RPC protocol version (always "2.0") */
	jsonrpc: string;
	/** The result payload on success */
	result?: JsonRpcResult;
	/** The error payload on failure */
	error?: JsonRpcError;
};

export type ChainIdResult = string;
export type SupportedEntryPointsResult = string[];

export type JsonRpcResult =
	| ChainIdResult
	| SupportedEntryPointsResult
	| GasEstimationResult
	| UserOperationByHashResult
	| UserOperationReceipt
	| UserOperationReceiptResult
	| SupportedERC20TokensAndMetadata
	| PmUserOperationResult;

/**
 * JSON-RPC error object returned when a request fails.
 */
export type JsonRpcError = {
	/** Numeric error code (e.g., -32602 for invalid params) */
	code: number;
	/** Human-readable error message */
	message: string;
	/** Additional structured error data */
	data: object;
};

/**
 * Gas estimation result returned by eth_estimateUserOperationGas.
 */
export type GasEstimationResult = {
	/** Estimated gas limit for the inner account execution */
	callGasLimit: bigint;
	/** Estimated extra gas to pay the bundler */
	preVerificationGas: bigint;
	/** Estimated gas limit for the account verification step */
	verificationGasLimit: bigint;
};

/**
 * Result of eth_getUserOperationByHash. Null if the operation is not found.
 */
export type UserOperationByHashResult = {
	/** The full UserOperation object */
	userOperation: UserOperation;
	/** The EntryPoint address this operation was submitted to */
	entryPoint: string;
	/** Block number the operation was included in (null if pending) */
	blockNumber: bigint | null;
	/** Block hash the operation was included in (null if pending) */
	blockHash: string | null;
	/** Transaction hash of the bundle that included this operation (null if pending) */
	transactionHash: string | null;
} | null;

/**
 * On-chain transaction receipt for the bundle that included a UserOperation.
 */
export type UserOperationReceipt = {
	/** Hash of the block containing the transaction */
	blockHash: string;
	/** Block number containing the transaction */
	blockNumber: bigint;
	/** Address of the bundler that submitted the transaction */
	from: string;
	/** Total gas used in the block up to and including this transaction */
	cumulativeGasUsed: bigint;
	/** Gas used by this specific transaction */
	gasUsed: bigint;
	/** JSON-encoded array of log entries emitted during execution */
	logs: string;
	/** Bloom filter for the logs in this transaction */
	logsBloom: string;
	/** Hash of the bundle transaction */
	transactionHash: string;
	/** Index of the transaction within the block */
	transactionIndex: bigint;
	/** Actual gas price paid (post EIP-1559) */
	effectiveGasPrice?: bigint;
};

/**
 * Full result of eth_getUserOperationReceipt. Null if the operation receipt is not found.
 */
export type UserOperationReceiptResult = {
	/** Hash of the UserOperation */
	userOpHash: string;
	/** EntryPoint address the operation was submitted to */
	entryPoint: string;
	/** The account (sender) address */
	sender: string;
	/** Nonce used for this operation */
	nonce: bigint;
	/** Paymaster address used (ZeroAddress if self-funded) */
	paymaster: string;
	/** Actual gas cost in wei charged for this operation */
	actualGasCost: bigint;
	/** Actual gas units consumed by this operation */
	actualGasUsed: bigint;
	/** Whether the inner account execution succeeded */
	success: boolean;
	/** JSON-encoded array of log entries */
	logs: string;
	/** The on-chain transaction receipt for the bundle */
	receipt: UserOperationReceipt;
} | null;

/**
 * Paymaster-modified UserOperation fields returned by pm_sponsorUserOperation.
 * Optional fields are only present if the paymaster chose to override them.
 */
export type PmUserOperationResult = {
	/** Paymaster address concatenated with paymaster-specific data */
	paymasterAndData: string;
	/** Paymaster-overridden call gas limit */
	callGasLimit?: bigint;
	/** Paymaster-overridden pre-verification gas */
	preVerificationGas?: bigint;
	/** Paymaster-overridden verification gas limit */
	verificationGasLimit?: bigint;
	/** Paymaster-overridden max fee per gas */
	maxFeePerGas?: bigint;
	/** Paymaster-overridden max priority fee per gas */
	maxPriorityFeePerGas?: bigint;
};

/**
 * Specifies whether a transaction is a regular call or a delegatecall.
 */
export enum Operation {
	/** Standard call to the target address */
	Call = 0,
	/** Delegatecall to the target address (executes target code in caller's context) */
	Delegate = 1,
}

/**
 * A single transaction to be included in a UserOperation.
 * Multiple MetaTransactions can be batched via multi-send.
 */
export interface MetaTransaction {
	/** Target contract or recipient address */
	to: string;
	/** Amount of native token (wei) to send */
	value: bigint;
	/** ABI-encoded calldata for the target contract */
	data: string;
	/** Call type: Call (0) for regular calls, Delegate (1) for delegatecalls. Defaults to Call. */
	operation?: Operation;
}

/**
 * Erc20 token info from the token paymaster
 */
export interface ERC20Token {
	/** Token symbol */
	symbol: string;
	/** Token address */
	address: string;
	/** Token decimal places */
	decimal: number;
	/** Paymaster fee for this token*/
	fee: bigint;
	/** Token exchange rate*/
	exchangeRate: bigint;
}

/**
 * Paymaster metadata
 */
export interface PaymasterMetadata {
	name: string;
	description: string;
	icons: string[];
	/** Paymaster contract address */
	address: string;
	/** the event that will be emitted when a useroperation is sponsored */
	sponsoredEventTopic: string;
	/** dummyPaymasterAndData to use for gas estimation */
	dummyPaymasterAndData: string;
}

/**
 * Paymaster metadata and supported erc20 tokens
 */
export interface SupportedERC20TokensAndMetadata {
	paymasterMetadata: PaymasterMetadata;
	tokens: ERC20Token[];
}

/**
 * Wrapper for a dictionary type
 */
export interface Dictionary<T> {
	[Key: string]: T;
}

/**
 * State overrides for a single address, used during gas estimation
 * to simulate different on-chain state.
 */
export type AddressToState = {
	/** Override the account's ETH balance (in wei) */
	balance?: bigint;
	/** Override the account's nonce */
	nonce?: bigint;
	/** Override the account's deployed bytecode */
	code?: string;
	/** Completely replace the account's storage (all slots not specified become zero) */
	state?: Dictionary<string>;
	/** Selectively override individual storage slots (other slots remain unchanged) */
	stateDiff?: Dictionary<string>;
};

/**
 * Wrapper for state overrides for gas estimation
 */
export type StateOverrideSet = {
	[key: string]: AddressToState;
};

/**
 * Multiplier to determine the gas price for the user operation.
 * Higher values result in faster inclusion but higher cost.
 */
export enum GasOption {
	/** 1x multiplier — lowest cost, slowest inclusion */
	Slow = 1,
	/** 1.2x multiplier — balanced cost and speed */
	Medium = 1.2,
	/** 1.5x multiplier — highest cost, fastest inclusion */
	Fast = 1.5,
}
