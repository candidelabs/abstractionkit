import type { BytesLike } from "ethers";

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
	| SupportedERC20Tokens
	| PmSponsorUserOperationResult;

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
	callGasLimit: string;
	preVerificationGas: string;
	verificationGasLimit: string;
};

export type UserOperationByHashResult = {
	userOperation: UserOperation;
	entryPoint: string;
	blockNumber: string;
	blockHash: BytesLike;
	transactionHash: BytesLike;
};

export type UserOperationReceipt = {
	blockHash: BytesLike;
	blockNumber: string;
	from: string;
	cumulativeGasUsed: string;
	gasUsed: string;
	logs: string;
	logsBloom: string;
	transactionHash: BytesLike;
	transactionIndex: string;
};

export type UserOperationReceiptResult = {
	userOpHash: BytesLike;
	entryPoint: string;
	sender: string;
	nonce: string;
	paymaster: string;
	actualGasCost: string;
	actualGasUsed: string;
	success: string;
	logs: string;
	receipt: UserOperationReceipt;
};

export type PmSponsorUserOperationResult = {
	paymasterAndData: BytesLike;
	callGasLimit?: string;
	preVerificationGas?: string;
	verificationGasLimit?: string;
	maxFeePerGas?: string;
	maxPriorityFeePerGas?: string;
};

export enum Operation {
	Call = 0,
	Delegate = 1,
}

export interface ERC20Token {
	symbol: string;
	address: string;
	decimal: number;
	fee: number;
	exchangeRate: string;
}
export interface PaymasterMetadata {
	name: string;
	description: string;
	icons: string[];
	address: string;
	sponsoredEventTopic: string;
	dummyPaymasterAndData: string;
}

export interface SupportedERC20Tokens {
	paymasterMetadata: PaymasterMetadata;
	tokens: ERC20Token[];
}

interface Dictionary<T> {
    [Key: string]: T;
}

export type AddressToState = {
	balance?:bigint,
	nonce?:bigint,
	code?:BytesLike,
	state?:Dictionary<string>,
	stateDiff?:Dictionary<string>,
}

export type StateOverrideSet = {
	[key: string]: AddressToState,
}

export enum GasOption {
	Slow=1,
	Medium=1.2,
	Fast=1.5
}
