import { type UserOperation } from "./types";

export const ZeroAddress = "0x0000000000000000000000000000000000000000";

export const UserOperationDummyValues: UserOperation = {
	//dummy values for somewhat accurate gas estimation
	sender: ZeroAddress,
	nonce: 0n,
	initCode: "0x",
	callData: "0x",
	callGasLimit: 0xffffffn,
	verificationGasLimit: 0xffffffn,
	preVerificationGas: 0xffffffn,
	maxFeePerGas: 0xffffffn,
	maxPriorityFeePerGas: 0xfffffffn,
	paymasterAndData: "0x",
	signature: "0x",
};
