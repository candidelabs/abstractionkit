/**
 * Wrapper for a useroperation for an entrypoint v0.6
 */
export type UserOperation = {
	sender: string;
	nonce: bigint;
	initCode: string;
	callData: string;
	callGasLimit: bigint;
	verificationGasLimit: bigint;
	preVerificationGas: bigint;
	maxFeePerGas: bigint;
	maxPriorityFeePerGas: bigint;
	paymasterAndData: string;
	signature: string;
};

export type AbiInputValue =
	| string
	| bigint
	| number
	| boolean
	| AbiInputValue[];

export type JsonRpcParam = string | bigint | boolean | object | JsonRpcParam[];

export type JsonRpcResponse = {
	id: number | null;
	jsonrpc: string;
	result?: JsonRpcResult;
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

export type JsonRpcError = {
	code: number;
	message: string;
	data: object;
};

export type GasEstimationResult = {
	callGasLimit: bigint;
	preVerificationGas: bigint;
	verificationGasLimit: bigint;
};

export type UserOperationByHashResult = {
	userOperation: UserOperation;
	entryPoint: string;
	blockNumber: bigint | null;
	blockHash: string | null;
	transactionHash: string | null;
} | null;

export type UserOperationReceipt = {
	blockHash: string;
	blockNumber: bigint;
	from: string;
	cumulativeGasUsed: bigint;
	gasUsed: bigint;
	logs: string;
	logsBloom: string;
	transactionHash: string;
	transactionIndex: bigint;
	effectiveGasPrice?: bigint;
};

export type UserOperationReceiptResult = {
	userOpHash: string;
	entryPoint: string;
	sender: string;
	nonce: bigint;
	paymaster: string;
	actualGasCost: bigint;
	actualGasUsed: bigint;
	success: boolean;
	logs: string;
	receipt: UserOperationReceipt;
} | null;

export type PmUserOperationResult = {
	paymasterAndData: string;
	callGasLimit?: bigint;
	preVerificationGas?: bigint;
	verificationGasLimit?: bigint;
	maxFeePerGas?: bigint;
	maxPriorityFeePerGas?: bigint;
};

/**
 * Call or Delegate Operation
 */
export enum Operation {
	Call = 0,
	Delegate = 1,
}

/**
 * Wrapper for a Metatransaction
 */
export interface MetaTransaction {
	to: string;
	value: bigint;
	data: string;
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
 * Wrapper for a state diff
 */
export type AddressToState = {
	balance?: bigint;
	nonce?: bigint;
	code?: string;
	state?: Dictionary<string>;
	stateDiff?: Dictionary<string>;
};

/**
 * Wrapper for state overrides for gas estimation
 */
export type StateOverrideSet = {
	[key: string]: AddressToState;
};

/**
 * Multiplier to determine the gas price for the user operation
 */
export enum GasOption {
	Slow = 1,
	Medium = 1.2,
	Fast = 1.5,
}