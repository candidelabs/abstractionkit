import { SafeAccountSingleton } from "./account/Safe/types";

export const ZeroAddress = "0x0000000000000000000000000000000000000000";

export const ENTRYPOINT_V7 = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
export const ENTRYPOINT_V6 = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";

export const Safe_L2_V1_4_1: SafeAccountSingleton = {
    singletonAddress:"0x29fcB43b46531BcA003ddC8FCB67FFE91900C762",
    singletonInitHash:"0xe298282cefe913ab5d282047161268a8222e4bd4ed106300c547894bbefd31ee"
}

export const BaseUserOperationDummyValues = {
	//dummy values for somewhat accurate gas estimation
	sender: ZeroAddress,
	nonce: 0n,
	callData: "0x",
	callGasLimit: 0n,
	verificationGasLimit: 0n,
	preVerificationGas: 0n,
	maxFeePerGas: 0n,
	maxPriorityFeePerGas: 0n,
	signature: "0x",
};
