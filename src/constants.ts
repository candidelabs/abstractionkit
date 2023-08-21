import { ZeroAddress } from "ethers";
import type { UserOperation } from "./types";

export const UserOperationEmptyValues: UserOperation = {
	sender: ZeroAddress,
	nonce: "0x00",
	initCode: "0x",
	callData: "0x",
	callGasLimit: "0x00",
	verificationGasLimit: "0x00",
	preVerificationGas: "0x00",
	maxFeePerGas: "0x00",
	maxPriorityFeePerGas: "0x00",
	paymasterAndData: "0x",
	signature: "0x",
};

export const UserOperationDummyValues: UserOperation = { //dummy values for somewhat accurate gas estimation
	sender: ZeroAddress,
	nonce: "0x00",
	initCode: "0x",
	callData: "0x",
	callGasLimit: "0xffffff",
	verificationGasLimit: "0xffffff",
	preVerificationGas: "0xffffff",
	maxFeePerGas: "0xffffff",
	maxPriorityFeePerGas: "0xfffffff",
	paymasterAndData: "0x",
	signature: "0x",
};
