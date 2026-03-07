import { SafeAccountSingleton } from "./account/Safe/types";

/** The Ethereum zero address (0x0000...0000), used as a placeholder for empty/null addresses */
export const ZeroAddress = "0x0000000000000000000000000000000000000000";

/** EntryPoint v0.9 contract address */
export const ENTRYPOINT_V9 = "0x433709009B8330FDa32311DF1C2AFA402eD8D009";
/** EntryPoint v0.8 contract address */
export const ENTRYPOINT_V8 = "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108";
/** EntryPoint v0.7 contract address */
export const ENTRYPOINT_V7 = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
/** EntryPoint v0.6 contract address */
export const ENTRYPOINT_V6 = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";

/** Safe L2 singleton v1.5.0 address and init hash */
export const Safe_L2_V1_5_0: SafeAccountSingleton = {
	singletonAddress: "0xEdd160fEBBD92E350D4D398fb636302fccd67C7e",
	singletonInitHash:
		"0x1b94aebb5a7df6dff11d93589204a6bbc99b4b8c9014bf1d386d006c2c17a881",
};

/** Safe L2 singleton v1.4.1 address and init hash */
export const Safe_L2_V1_4_1: SafeAccountSingleton = {
	singletonAddress: "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762",
	singletonInitHash:
		"0xe298282cefe913ab5d282047161268a8222e4bd4ed106300c547894bbefd31ee",
};

/** Default placeholder values for gas estimation before actual values are known */
export const BaseUserOperationDummyValues = {
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

export const EIP712_SAFE_OPERATION_PRIMARY_TYPE = "SafeOp";

/** EIP-712 type definition for Safe UserOperation signing (EntryPoint v0.6) */
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

/** EIP-712 type definition for Safe UserOperation signing (EntryPoint v0.7) */
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

export const EIP712_MULTI_CHAIN_OPERATIONS_PRIMARY_TYPE = "MerkleTreeRoot";

/** EIP-712 type definition for multi-chain Safe operations using Merkle tree roots */
export const EIP712_MULTI_CHAIN_OPERATIONS_TYPE = {
	MerkleTreeRoot: [
		{ type: "bytes32", name: "merkleTreeRoot" },
	],
};

/** Default address for the secp256r1 (P-256) precompile used by WebAuthn verification */
export const DEFAULT_SECP256R1_PRECOMPILE_ADDRESS = "0x0000000000000000000000000000000000000100";

/** Uniswap Calibur singleton v1.0.0 (EntryPoint v0.8) */
export const CALIBUR_UNISWAP_V1_0_0_SINGLETON_ADDRESS = "0x000000009B1D0aF20D8C6d0A44e162d11F9b8f00";

/** Candide Calibur singleton v0.1.0 (EntryPoint v0.9, unaudited) */
export const CALIBUR_CANDIDE_V0_1_0_SINGLETON_ADDRESS = "0x71032285A847c4311Eb7ec2E7A636aB94A9805Aa";
