import { type UserOperation } from "./types";

/** The Ethereum zero address (0x0000...0000), used as a placeholder for empty/null addresses */
export const ZeroAddress = "0x0000000000000000000000000000000000000000";

/**
 * Default placeholder UserOperation with zero/empty values.
 * Used during gas estimation to provide a structurally valid UserOperation
 * before actual values are known.
 */
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
