import { type UserOperation } from "./types";

export const ZeroAddress = "0x0000000000000000000000000000000000000000";

export const UserOperationDummyValues: UserOperation = {
	//dummy values for somewhat accurate gas estimation
	sender: ZeroAddress,
	nonce: 0n,
	initCode: "0x",
	callData: "0x",
	callGasLimit: 0n,
	verificationGasLimit: 0n,
	preVerificationGas: 0n,
	maxFeePerGas: 0n,
	maxPriorityFeePerGas: 0n,
	paymasterAndData: "0x",
	signature: "0x",
};
