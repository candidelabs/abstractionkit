import { BytesLike } from "ethers";
import type { Operation, StateOverrideSet } from "../../types";

/**
 * Wrapper for a Metatransaction
 */
export interface MetaTransaction {
    to: string;
    value: bigint;
    data: BytesLike;
    operation?: Operation;
}

/**
 * Overrides for the "createUserOperation" function
 */
export interface CreateUserOperationOverrides {
	/** set the nonce instead of quering the current nonce from the rpc node */
	nonce?: bigint,
	/** set the initCode instead of using the calculated value */
	initCode?: BytesLike;
	/** set the callData instead of using the enoding the provided Metatransactions*/
	callData?: BytesLike;
	/** set the callGasLimit instead of estimating gas using the bundler*/
	callGasLimit?: bigint,
	/** set the verificationGasLimit instead of estimating gas using the bundler*/
	verificationGasLimit?: bigint,
	/** set the preVerificationGas instead of estimating gas using the bundler*/
	preVerificationGas?: bigint,
	/** set the maxFeePerGas instead of quering the current gas price from the rpc node */
	maxFeePerGas?: bigint,
	/** set the maxPriorityFeePerGas instead of quering the current gas price from the rpc node */
	maxPriorityFeePerGas?: bigint,
	/** gas estimation depends on the number of owners as each owner will increase the signature size
	 * @default 1
	*/
	numberOfOwners?: number,
	/** pass some state overrides for gas estimation"*/
	state_override_set?: StateOverrideSet,
}

/**
 * Overrides for initilizing a new Safe account
 */
export interface InitCodeOverrides {
	/** signature threshold 
	 * @default 1
	*/
	threshold?: number,
	/** create2 nonce - to generate different sender addresses from the same owners
	 * @default 0
	*/
	c2Nonce?: bigint,
	/** Safe contract singleton address
	 * @default "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762"
	*/
	singletonAddress?: string,
	/** Safe Factory address
	 * @default "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67"
	*/
	safeAccountFactoryAddress?: string,
	/** Safe 4337 module address
	 * @default "0xa581c4A4DB7175302464fF3C06380BC3270b4037"
	*/
	safe4337ModuleAddress?: string,
	/** addModuleLib address
	 * "0x8EcD4ec46D4D2a6B64fE960B3D64e8B94B2234eb"
	*/
	addModuleLibAddress?: string,
}

/**
 * Safe has two executor functions "executeUserOpWithErrorString" and "executeUserOp"
 * @enum
 */
export enum SafeModuleExecutorFunctionSelector {
	executeUserOpWithErrorString = "0x541d63c8",
	executeUserOp = "0x7bb37428",
}