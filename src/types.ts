import type { BytesLike } from "ethers";

/**
 * Wrapper for a useroperation for an entrypoint v0.6
 */
export type UserOperation = {
	sender: string;
	nonce: bigint;
	initCode: BytesLike;
	callData: BytesLike;
	callGasLimit: bigint;
	verificationGasLimit: bigint;
	preVerificationGas: bigint;
	maxFeePerGas: bigint;
	maxPriorityFeePerGas: bigint;
	paymasterAndData: BytesLike;
	signature: BytesLike;
};

export type AbiInputValue =
	| string
	| bigint
	| number
	| BytesLike
	| boolean
	| AbiInputValue[];

export type JsonRpcParam =
	| string
	| bigint
	| BytesLike
	| boolean
	| object
	| JsonRpcParam[];

export type JsonRpcResponse = {
	id: number;
	result?: JsonRpcResult;
	error?: BundlerJsonRpcError;
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

export enum BundlerErrorCode {
	InvalidFields = -32602,
    SimulateValidation = -32500,
    SimulatePaymasterValidation = -32501,
    OpcodeValidation = -32502,
    ExpiresShortly = -32503,
    Reputation = -32504,
    InsufficientStake = -32505,
    UnsupportedSignatureAggregator = -32506,
    InvalidSignature = -32507,
    InvalidUseroperationHash = -32601,
	ExecutionReverted = -32521
}

export type JsonRpcError = {
	code: number;
	message: string;
};

export type BundlerJsonRpcError = {
	code: BundlerErrorCode | number;
	message: string;
};

export type GasEstimationResult = {
	callGasLimit: bigint;
	preVerificationGas: bigint;
	verificationGasLimit: bigint;
};

export type UserOperationByHashResult = {
	userOperation: UserOperation;
	entryPoint: string;
	blockNumber: bigint;
	blockHash: string;
	transactionHash: string;
};

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
	userOpHash: BytesLike;
	entryPoint: string;
	sender: string;
	nonce: bigint;
	paymaster: string;
	actualGasCost: bigint;
	actualGasUsed: bigint;
	success: boolean;
	logs: string;
	receipt: UserOperationReceipt;
};

export type PmUserOperationResult = {
	paymasterAndData: BytesLike;
	callGasLimit?: bigint;
	preVerificationGas?: bigint;
	verificationGasLimit?: bigint;
	maxFeePerGas?: bigint;
	maxPriorityFeePerGas?: bigint;
};
/**
 * Call or Delegate Operation
 * @enum
 */
export enum Operation {
	Call = 0,
	Delegate = 1,
}

/**
 * Erc20 token info from the token paymaster
 */
export interface ERC20Token {
	/** Token sympol */
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
interface Dictionary<T> {
    [Key: string]: T;
}

/**
 * Wrapper for a state diff
 */
export type AddressToState = {
	balance?:bigint,
	nonce?:bigint,
	code?:BytesLike,
	state?:Dictionary<string>,
	stateDiff?:Dictionary<string>,
}

/**
 * Wrapper for state overrides for gas estimation
 */
export type StateOverrideSet = {
	[key: string]: AddressToState,
}

/**
 * Multiplier to determine the gas price for the user operation
 */
export enum GasOption {
	Slow=1,
	Medium=1.2,
	Fast=1.5
}
