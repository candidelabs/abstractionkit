import { SafeAccountSingleton } from "./account/Safe/types";

export const ZeroAddress = "0x0000000000000000000000000000000000000000";

export const ENTRYPOINT_V7 = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
export const ENTRYPOINT_V6 = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";

export const Safe_L2_V1_4_1: SafeAccountSingleton = {
	singletonAddress: "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762",
	singletonInitHash:
		"0xe298282cefe913ab5d282047161268a8222e4bd4ed106300c547894bbefd31ee",
};

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

export const EIP712_SAFE_OPERATION_V6_TYPE = {
    SafeOp: [
        { type: "address", name: "safe" },
        { type: "uint256", name: "nonce" },
        { type: "bytes", name: "initCode" },
        { type: "bytes", name: "callData" },
        { type: "uint256", name: "callGasLimit" },
        { type: "uint256", name: "verificationGasLimit" },
        { type: "uint256", name: "preVerificationGas" },
        { type: "uint256", name: "maxFeePerGas" },
        { type: "uint256", name: "maxPriorityFeePerGas" },
        { type: "bytes", name: "paymasterAndData" },
        { type: "uint48", name: "validAfter" },
        { type: "uint48", name: "validUntil" },
        { type: "address", name: "entryPoint" },
    ],
};

export const EIP712_SAFE_OPERATION_V7_TYPE = {
    SafeOp: [
        { type: "address", name: "safe" },
        { type: "uint256", name: "nonce" },
        { type: "bytes", name: "initCode" },
        { type: "bytes", name: "callData" },
        { type: "uint128", name: "verificationGasLimit" },
        { type: "uint128", name: "callGasLimit" },
        { type: "uint256", name: "preVerificationGas" },
        { type: "uint128", name: "maxPriorityFeePerGas" },
        { type: "uint128", name: "maxFeePerGas" },
        { type: "bytes", name: "paymasterAndData" },
        { type: "uint48", name: "validAfter" },
        { type: "uint48", name: "validUntil" },
        { type: "address", name: "entryPoint" },
    ],
};

