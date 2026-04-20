import type { Authorization7702Hex } from "./utils7702";

/**
 * Base fields shared by all UserOperation versions.
 * Extended by version-specific interfaces (UserOperationV6, V7, V8).
 */
export interface BaseUserOperation {
	/** The account making the operation */
	sender: string;
	/** Anti-replay parameter; also used as the salt for first-time account creation */
	nonce: bigint;
	/** The calldata to execute on the sender account */
	callData: string;
	/** Gas limit for the inner account execution */
	callGasLimit: bigint;
	/** Gas limit for the account verification step */
	verificationGasLimit: bigint;
	/** Extra gas to pay the bundler */
	preVerificationGas: bigint;
	/** Maximum fee per gas (EIP-1559 max_fee_per_gas) */
	maxFeePerGas: bigint;
	/** Maximum priority fee per gas (EIP-1559 max_priority_fee_per_gas) */
	maxPriorityFeePerGas: bigint;
	/** Signature over the UserOperation hash */
	signature: string;
}

/**
 * UserOperation for EntryPoint v0.6. Uses concatenated initCode and paymasterAndData fields.
 */
export interface UserOperationV6 extends BaseUserOperation {
	/** Concatenated factory address and factory-specific data (empty '0x' if already deployed) */
	initCode: string;
	/** Concatenated paymaster address and paymaster-specific data (empty '0x' for self-funded) */
	paymasterAndData: string;
}

/**
 * UserOperation for EntryPoint v0.7. Uses separate factory/paymaster fields.
 */
export interface UserOperationV7 extends BaseUserOperation {
	/** Factory contract address used to deploy the account (null if already deployed) */
	factory: string | null;
	/** Factory-specific data for account creation (null if already deployed) */
	factoryData: string | null;
	/** Paymaster contract address (null for self-funded operations) */
	paymaster: string | null;
	/** Gas limit for the paymaster verification step (null if no paymaster) */
	paymasterVerificationGasLimit: bigint | null;
	/** Gas limit for the paymaster post-operation callback (null if no paymaster) */
	paymasterPostOpGasLimit: bigint | null;
	/** Paymaster-specific data (null if no paymaster) */
	paymasterData: string | null;
}

/**
 * UserOperation for EntryPoint v0.8. Adds EIP-7702 authorization support.
 */
export interface UserOperationV8 extends BaseUserOperation {
	/** Factory contract address used to deploy the account (null if already deployed) */
	factory: string | null;
	/** Factory-specific data for account creation (null if already deployed) */
	factoryData: string | null;
	/** Paymaster contract address (null for self-funded operations) */
	paymaster: string | null;
	/** Gas limit for the paymaster verification step (null if no paymaster) */
	paymasterVerificationGasLimit: bigint | null;
	/** Gas limit for the paymaster post-operation callback (null if no paymaster) */
	paymasterPostOpGasLimit: bigint | null;
	/** Paymaster-specific data (null if no paymaster) */
	paymasterData: string | null;
	/** EIP-7702 delegation authorization (null if not using 7702) */
	eip7702Auth: Authorization7702Hex | null;
}

/**
 * UserOperation for EntryPoint v0.9. Same structure as v0.8.
 */
export interface UserOperationV9 extends UserOperationV8 {}

/** Union type for values that can be ABI-encoded as function parameters. */
export type AbiInputValue = string | bigint | number | boolean | AbiInputValue[];

/** Union type for JSON-RPC request parameters. */
export type JsonRpcParam = string | bigint | boolean | object | JsonRpcParam[];

/** Standard JSON-RPC 2.0 response envelope. */
export type JsonRpcResponse = {
	/** Request identifier */
	id: number | null;
	/** JSON-RPC protocol version */
	jsonrpc: string;
	/** The result payload on success */
	result?: JsonRpcResult;
	/** Tenderly simulation results */
	simulation_results?: JsonRpcResult;
	/** The error payload on failure */
	error?: JsonRpcError;
};

/** Hex-encoded chain ID returned by eth_chainId. */
export type ChainIdResult = string;
/** Array of EntryPoint addresses returned by eth_supportedEntryPoints. */
export type SupportedEntryPointsResult = string[];

/** Result for a single transaction from a Tenderly bundle simulation. */
export type SingleTransactionTenderlySimulationResult = {
	transaction: Record<string, unknown>;
	simulation: { id: string } & Record<string, unknown>;
};

/** Result array from a Tenderly bundle simulation (one entry per transaction). */
export type TenderlySimulationResult = SingleTransactionTenderlySimulationResult[];

/** Union of all possible `result` payloads returned by SDK-level JSON-RPC calls. */
export type JsonRpcResult =
	| ChainIdResult
	| SupportedEntryPointsResult
	| GasEstimationResult
	| UserOperationByHashResult
	| UserOperationReceipt
	| UserOperationReceiptResult
	| SupportedERC20TokensAndMetadata
	| PmUserOperationV7Result
	| PmUserOperationV6Result
	| TenderlySimulationResult;

/** JSON-RPC error object returned when a request fails. */
export type JsonRpcError = {
	/** Numeric error code */
	code: number;
	/** Human-readable error message */
	message: string;
	/** Additional structured error data */
	data: object;
};

/** Gas estimation result returned by eth_estimateUserOperationGas. */
export type GasEstimationResult = {
	/** Estimated gas limit for inner execution */
	callGasLimit: bigint;
	/** Estimated extra gas to pay the bundler */
	preVerificationGas: bigint;
	/** Estimated gas limit for verification step */
	verificationGasLimit: bigint;
	/** Paymaster verification gas limit. Non-standard bundler extension; see `Bundler.estimateUserOperationGas`. */
	paymasterVerificationGasLimit?: bigint;
	/** Paymaster post-op gas limit. Non-standard bundler extension; see `Bundler.estimateUserOperationGas`. */
	paymasterPostOpGasLimit?: bigint;
};

/** Result of eth_getUserOperationByHash. Null if not found. */
export type UserOperationByHashResult = {
	/** The UserOperation object */
	userOperation: UserOperationV6 | UserOperationV7;
	/** The EntryPoint address */
	entryPoint: string;
	/** Block number (null if pending) */
	blockNumber: bigint | null;
	/** Block hash (null if pending) */
	blockHash: string | null;
	/** Transaction hash of the bundle (null if pending) */
	transactionHash: string | null;
} | null;

/** On-chain transaction receipt for the bundle that included a UserOperation. */
export type UserOperationReceipt = {
	/** Hash of the block containing the transaction */
	blockHash: string;
	/** Number of the block containing the transaction */
	blockNumber: bigint;
	/** Address of the bundler that submitted the transaction */
	from: string;
	/** Total gas used in the block up to and including this transaction */
	cumulativeGasUsed: bigint;
	/** Gas used by this specific transaction */
	gasUsed: bigint;
	/** Encoded logs emitted during execution */
	logs: string;
	/** Bloom filter for the transaction logs */
	logsBloom: string;
	/** Hash of the bundle transaction */
	transactionHash: string;
	/** Index of the transaction within the block */
	transactionIndex: bigint;
	/** Effective gas price paid (EIP-1559) */
	effectiveGasPrice?: bigint;
};

/** Full result of eth_getUserOperationReceipt. Null if not found. */
export type UserOperationReceiptResult = {
	/** Hash of the UserOperation */
	userOpHash: string;
	/** EntryPoint contract address that processed the operation */
	entryPoint: string;
	/** Sender (smart account) address */
	sender: string;
	/** Nonce used by the UserOperation */
	nonce: bigint;
	/** Paymaster address (or zero address if self-funded) */
	paymaster: string;
	/** Actual gas cost charged (in wei) */
	actualGasCost: bigint;
	/** Actual gas units consumed */
	actualGasUsed: bigint;
	/** Whether the inner account execution succeeded */
	success: boolean;
	/** Encoded logs emitted during execution */
	logs: string;
	/** The underlying transaction receipt */
	receipt: UserOperationReceipt;
} | null;

/** Metadata about the sponsor of a UserOperation. */
export type SponsorMetadata = {
	/** Sponsor display name */
	name: string;
	/** Sponsor description */
	description: string;
	/** Sponsor website URL */
	url: string;
	/** Sponsor icon URLs */
	icons: string[];
};

/** Paymaster fields returned by pm_getPaymasterData for EntryPoint v0.7+. */
export type PmUserOperationV7Result = {
	/** Paymaster contract address */
	paymaster: string;
	/** Gas limit for the paymaster verification step */
	paymasterVerificationGasLimit: bigint;
	/** Gas limit for the paymaster post-operation callback */
	paymasterPostOpGasLimit: bigint;
	/** Paymaster-specific data */
	paymasterData: string;
	/** Overridden call gas limit (if provided by paymaster) */
	callGasLimit?: bigint;
	/** Overridden verification gas limit (if provided by paymaster) */
	verificationGasLimit?: bigint;
	/** Overridden pre-verification gas (if provided by paymaster) */
	preVerificationGas?: bigint;
	/** Overridden max fee per gas (if provided by paymaster) */
	maxFeePerGas?: bigint;
	/** Overridden max priority fee per gas (if provided by paymaster) */
	maxPriorityFeePerGas?: bigint;
	/** Metadata about the sponsor */
	sponsorMetadata?: SponsorMetadata;
};

/** Paymaster fields returned by pm_getPaymasterData for EntryPoint v0.8 (identical shape to v0.7). */
export type PmUserOperationV8Result = PmUserOperationV7Result;

/** Paymaster fields returned by pm_getPaymasterData for EntryPoint v0.6. */
export type PmUserOperationV6Result = {
	/** Concatenated paymaster address and paymaster-specific data */
	paymasterAndData: string;
	/** Overridden call gas limit (if provided by paymaster) */
	callGasLimit?: bigint;
	/** Overridden pre-verification gas (if provided by paymaster) */
	preVerificationGas?: bigint;
	/** Overridden verification gas limit (if provided by paymaster) */
	verificationGasLimit?: bigint;
	/** Overridden max fee per gas (if provided by paymaster) */
	maxFeePerGas?: bigint;
	/** Overridden max priority fee per gas (if provided by paymaster) */
	maxPriorityFeePerGas?: bigint;
	/** Metadata about the sponsor */
	sponsorMetadata?: SponsorMetadata;
};

/**
 * Specifies whether a transaction is a regular call or a delegatecall.
 */
export enum Operation {
	/** Standard call to the target address */
	Call = 0,
	/** Delegatecall (executes target code in caller's context) */
	Delegate = 1,
}

/**
 * A single transaction to be included in a UserOperation.
 * Multiple MetaTransactions can be batched via multi-send.
 */
export interface MetaTransaction {
	/** Target contract or recipient address */
	to: string;
	/** Amount of native token (wei) to send */
	value: bigint;
	/** ABI-encoded calldata for the target contract */
	data: string;
	/** Call type: Call (0) or Delegate (1). Defaults to Call. */
	operation?: Operation;
}

/**
 * Erc20 token info from the token paymaster
 */
export interface ERC20Token {
	/** Token name */
	name: string;
	/** Token symbol */
	symbol: string;
	/** Token address */
	address: string;
	/** Token decimal places */
	decimals: number;
}

/**
 * Erc20 token info from the token paymaster with exchange rate
 */
export interface ERC20TokenWithExchangeRate extends ERC20Token {
	/** Token exchange rate */
	exchangeRate: bigint;
}

/**
 * Paymaster metadata returned by the paymaster RPC.
 * V7/V8 paymasters return structured dummyPaymasterAndData; V6 returns a concatenated hex string.
 */
export interface PaymasterMetadata {
	/** Sponsor display name */
	name: string;
	/** Sponsor description */
	description: string;
	/** Sponsor icon URLs */
	icons: string[];
	/** Paymaster contract address */
	address: string;
	/** The event topic emitted on-chain when a UserOperation is sponsored */
	sponsoredEventTopic: string;
	/** Dummy paymaster data used for gas estimation */
	dummyPaymasterAndData:
		| {
				paymaster: string;
				paymasterVerificationGasLimit: bigint;
				paymasterPostOpGasLimit: bigint;
				paymasterData: string;
		  }
		| string;
}

/** @deprecated Use PaymasterMetadata instead */
export type PaymasterMetadataV7 = PaymasterMetadata;
/** @deprecated Use PaymasterMetadata instead */
export type PaymasterMetadataV8 = PaymasterMetadata;
/** @deprecated Use PaymasterMetadata instead */
export type PaymasterMetadataV6 = PaymasterMetadata;

/**
 * Paymaster metadata and supported erc20 tokens
 */
export interface SupportedERC20TokensAndMetadata {
	paymasterMetadata: PaymasterMetadata;
	tokens: ERC20Token[];
}

/** @deprecated Use SupportedERC20TokensAndMetadata instead */
export type SupportedERC20TokensAndMetadataV7 = SupportedERC20TokensAndMetadata;
/** @deprecated Use SupportedERC20TokensAndMetadata instead */
export type SupportedERC20TokensAndMetadataV8 = SupportedERC20TokensAndMetadata;
/** @deprecated Use SupportedERC20TokensAndMetadata instead */
export type SupportedERC20TokensAndMetadataV6 = SupportedERC20TokensAndMetadata;

/**
 * Paymaster metadata and supported erc20 tokens with exchange rates
 */
export interface SupportedERC20TokensAndMetadataWithExchangeRate {
	paymasterMetadata: PaymasterMetadata;
	tokens: ERC20TokenWithExchangeRate[];
}

/** @deprecated Use SupportedERC20TokensAndMetadataWithExchangeRate instead */
export type SupportedERC20TokensAndMetadataV7WithExchangeRate =
	SupportedERC20TokensAndMetadataWithExchangeRate;
/** @deprecated Use SupportedERC20TokensAndMetadataWithExchangeRate instead */
export type SupportedERC20TokensAndMetadataV8WithExchangeRate =
	SupportedERC20TokensAndMetadataWithExchangeRate;
/** @deprecated Use SupportedERC20TokensAndMetadataWithExchangeRate instead */
export type SupportedERC20TokensAndMetadataV6WithExchangeRate =
	SupportedERC20TokensAndMetadataWithExchangeRate;

/**
 * Wrapper for a dictionary type
 */
export interface Dictionary<T> {
	[Key: string]: T;
}

/**
 * State overrides for a single address, used during gas estimation.
 */
export type AddressToState = {
	/** Override the account's ETH balance (in wei) */
	balance?: bigint;
	/** Override the account's nonce */
	nonce?: bigint;
	/** Override the account's deployed bytecode */
	code?: string;
	/** Completely replace the account's storage */
	state?: Dictionary<string>;
	/** Selectively override individual storage slots */
	stateDiff?: Dictionary<string>;
};

/**
 * Wrapper for state overrides for gas estimation
 */
export type StateOverrideSet = {
	[key: string]: AddressToState;
};

/**
 * Multiplier to determine the gas price. Higher values result in faster inclusion but higher cost.
 */
export enum GasOption {
	/** 1x multiplier -- lowest cost, slowest inclusion */
	Slow = 1,
	/** 1.2x multiplier -- balanced cost and speed */
	Medium = 1.2,
	/** 1.5x multiplier -- highest cost, fastest inclusion */
	Fast = 1.5,
}
/** Polygon network identifier used to select the correct Polygon Gas Station endpoint. */
export enum PolygonChain {
	Mainnet = "v2",
	ZkMainnet = "zkevm",
	Amoy = "amoy",
	Cardona = "cardona",
}

/** EIP-1559 gas price pair in Gwei, as returned by Polygon Gas Station. */
export type GasPrice = {
	/** Priority fee (tip) in Gwei */
	maxPriorityFee: number;
	/** Max fee per gas in Gwei */
	maxFee: number;
};

/** Response shape returned by the Polygon Gas Station API. */
export type PolygonGasStationJsonRpcResponse = {
	safeLow: GasPrice;
	standard: GasPrice;
	fast: GasPrice;
	estimatedBaseFee: string;
	blockTime: number;
	blockNumber: number;
};

/** Attribution parameters appended to calldata as an on-chain identifier for analytics. */
export type OnChainIdentifierParamsType = {
	/** Project name */
	project: string;
	/** Client platform; defaults to "Web" */
	platform?: "Web" | "Mobile" | "Safe App" | "Widget";
	/** Tool name; defaults to "abstractionkit" */
	tool?: string;
	/** Tool version; defaults to the current abstractionkit version */
	toolVersion?: string;
};

/** Paymaster fields pre-populated during UserOperation construction for parallel paymaster flows. */
export interface ParallelPaymasterInitValues {
	/** Paymaster contract address */
	paymaster: string;
	/** Paymaster verification gas limit */
	paymasterVerificationGasLimit: bigint;
	/** Paymaster post-operation gas limit */
	paymasterPostOpGasLimit: bigint;
	/** Paymaster-specific data */
	paymasterData: string;
}
