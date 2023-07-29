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
	| UserOperation
	| AbiInputValue[];

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
	| UserOperationReceiptResult;

export type JsonRpcError = {
	code: number;
	message: string;
};

export type GasEstimationResult = {
	callGasLimit: BigNumberish;
	preVerificationGas: BigNumberish;
	verificationGas: BigNumberish;
	deadline: BigNumberish;
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

export enum Operation {
	Call = 0,
	Delegate = 1,
}
