/**
 * Base wrapper for a useroperation
 */
export interface BaseUserOperation {
	sender: string;
	nonce: bigint;
	callData: string;
	callGasLimit: bigint;
	verificationGasLimit: bigint;
	preVerificationGas: bigint;
	maxFeePerGas: bigint;
	maxPriorityFeePerGas: bigint;
	signature: string;
}

/**
 * Wrapper for a useroperation for an entrypoint v0.06
 */
export interface UserOperationV6 extends BaseUserOperation {
	initCode: string;
	paymasterAndData: string;
}

/**
 * Wrapper for a useroperation for an entrypoint v0.07
 */
export interface UserOperationV7 extends BaseUserOperation {
	factory: string | null;
	factoryData: string | null;
	paymaster: string | null;
	paymasterVerificationGasLimit: bigint | null;
	paymasterPostOpGasLimit: bigint | null;
	paymasterData: string | null;
}

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
	| SupportedERC20TokensAndMetadataV7
	| SupportedERC20TokensAndMetadataV6
	| PmUserOperationV7Result
	| PmUserOperationV6Result;

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
	userOperation: UserOperationV6 | UserOperationV7;
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

export type SponsorMetadata = {
	name: string;
	description: string;
	url: string;
	icons: string[];
};

export type PmUserOperationV7Result = {
	paymaster: string;
	paymasterVerificationGasLimit: bigint;
	paymasterPostOpGasLimit: bigint;
	paymasterData: string;
	callGasLimit?: bigint;
	verificationGasLimit?: bigint;
	preVerificationGas?: bigint;
	maxFeePerGas?: bigint;
	maxPriorityFeePerGas?: bigint;
	sponsorMetadata?: SponsorMetadata;
};

export type PmUserOperationV6Result = {
	paymasterAndData: string;
	callGasLimit?: bigint;
	preVerificationGas?: bigint;
	verificationGasLimit?: bigint;
	maxFeePerGas?: bigint;
	maxPriorityFeePerGas?: bigint;
	sponsorMetadata?: SponsorMetadata;
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
	name: string;
	/** Token symbol */
	symbol: string;
	/** Token address */
	address: string;
	/** Token decimal places */
	decimals: number;
}

/**
 * Erc20 token info from the token paymaster with exchange rate
 */
export interface ERC20TokenWithExchangeRate extends ERC20Token {
	/** Token exchange rate*/
	exchangeRate: bigint;
}

/**
 * Paymaster metadata
 */
interface BasePaymasterMetadata {
	name: string;
	description: string;
	icons: string[];
	/** Paymaster contract address */
	address: string;
	/** the event that will be emitted when a useroperation is sponsored */
	sponsoredEventTopic: string;
}

export interface PaymasterMetadataV7 extends BasePaymasterMetadata {
	/** dummyPaymasterAndData to use for gas estimation */
	dummyPaymasterAndData: {
		paymaster: string;
		paymasterVerificationGasLimit: bigint;
		paymasterPostOpGasLimit: bigint;
		paymasterData: string;
	};
}

export interface PaymasterMetadataV6 extends BasePaymasterMetadata {
	/** dummyPaymasterAndData to use for gas estimation */
	dummyPaymasterAndData: string;
}

/**
 * Paymaster metadata and supported erc20 tokens
 */
export interface SupportedERC20TokensAndMetadataV7 {
	paymasterMetadata: PaymasterMetadataV7;
	tokens: ERC20Token[];
}

/**
 * Paymaster metadata and supported erc20 tokens
 */
export interface SupportedERC20TokensAndMetadataV6 {
	paymasterMetadata: PaymasterMetadataV6;
	tokens: ERC20Token[];
}

/**
 * Paymaster metadata and supported erc20 tokens
 */
export interface SupportedERC20TokensAndMetadataV7WithExchangeRate {
	paymasterMetadata: PaymasterMetadataV7;
	tokens: ERC20TokenWithExchangeRate[];
}

/**
 * Paymaster metadata and supported erc20 tokens
 */
export interface SupportedERC20TokensAndMetadataV6WithExchangeRate {
	paymasterMetadata: PaymasterMetadataV6;
	tokens: ERC20TokenWithExchangeRate[];
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
