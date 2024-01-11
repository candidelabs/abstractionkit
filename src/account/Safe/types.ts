import { BytesLike } from "ethers";
import type { Operation } from "../../types";

export interface MetaTransactionInput {
    to: string;
    value?: bigint;
    data?: BytesLike;
    operation?: Operation;
}

export interface MetaTransaction {
    to: string;
    value: bigint;
    data: BytesLike;
    operation?: Operation;
}

export interface CreateUserOperationOverrides {
	nonce?: bigint,
	initCode?: BytesLike;
	callData?: BytesLike;
	callGasLimit?: bigint,
	verificationGasLimit?: bigint,
	preVerificationGas?: bigint,
	maxFeePerGas?: bigint,
	maxPriorityFeePerGas?: bigint,
}

export interface InitCodeOverrides {
	threshold?: number,
	c2Nonce?: bigint,
	singletonAddress?: string,
	safeAccountFactoryAddress?: string,
	safe4337ModuleAddress?: string,
	addModuleLibAddress?: string,
}

export enum SafeModuleExecutorFunctionSelector {
	executeUserOpWithErrorString = "0x541d63c8",
	executeUserOp = "0x7bb37428",
}