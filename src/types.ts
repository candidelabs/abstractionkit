import type { BigNumberish, BytesLike } from "ethers";

export type UserOperation = {
	sender: string;
	nonce: BigNumberish;
	initCode: BytesLike;
	callData: BytesLike;
	callGasLimit: BigNumberish;
	verificationGasLimit: BigNumberish;
	preVerificationGas: BigNumberish;
	maxFeePerGas: BigNumberish;
	maxPriorityFeePerGas: BigNumberish;
	paymasterAndData: BytesLike;
	signature: BytesLike;
};

export type AbiInputValue =
	| string
	| BigNumberish
	| BytesLike
	| boolean
	| AbiInputValue[];

export type JsonRpcParam =
	| string
	| BigNumberish
	| BytesLike
	| boolean
	| object
	| JsonRpcParam[];

export type JsonRpcResponse = {
	id: number;
	result?: JsonRpcResult;
	error?: JsonRpcError;
};

export type JsonRpcResult =
	| string
	| string[]
	| GasEstimationResult
	| UserOperationByHashResult
	| UserOperationReceipt
	| UserOperationReceiptResult
	| SupportedERC20Tokens
	| PmSponsorUserOperationResult
	| SponsorshipEligibility;

export type JsonRpcError = {
	code: number;
	message: string;
};

export type GasEstimationResult = {
	callGasLimit: BigNumberish;
	preVerificationGas: BigNumberish;
	verificationGasLimit: BigNumberish;
};

export type UserOperationByHashResult = {
	userOperation: UserOperation;
	entryPoint: string;
	blockNumber: BigNumberish;
	blockHash: BytesLike;
	transactionHash: BytesLike;
};

export type UserOperationReceipt = {
	blockHash: BytesLike;
	blockNumber: BigNumberish;
	from: string;
	cumulativeGasUsed: BigNumberish;
	gasUsed: BigNumberish;
	logs: string;
	logsBloom: string;
	transactionHash: BytesLike;
	transactionIndex: BigNumberish;
};

export type UserOperationReceiptResult = {
	userOpHash: BytesLike;
	entryPoint: string;
	sender: string;
	nonce: BigNumberish;
	paymaster: string;
	actualGasCost: BigNumberish;
	actualGasUsed: BigNumberish;
	success: string;
	logs: string;
	receipt: UserOperationReceipt;
};

export type PmSponsorUserOperationResult = {
	paymasterAndData: BytesLike;
	callGasLimit?: BigNumberish;
	preVerificationGas?: BigNumberish;
	verificationGasLimit?: BigNumberish;
	maxFeePerGas?: BigNumberish;
	maxPriorityFeePerGas?: BigNumberish;
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

export interface SponsorshipEligibility {
	sponsored: boolean;
	sponsorMeta?: SponsorMetadata;
}

interface SponsorMetadata {
	name: string;
	description: string;
	url: string;
	icons: string[];
}
