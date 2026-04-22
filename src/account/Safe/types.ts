import type {
	GasOption,
	OnChainIdentifierParamsType,
	PolygonChain,
	StateOverrideSet,
	UserOperationV9,
} from "../../types";

/**
 * Overrides for the "createBaseUserOperationAndFactoryAddressAndFactoryData" function
 */
export interface CreateBaseUserOperationOverrides {
	/** set the nonce instead of querying the current nonce from the rpc node */
	nonce?: bigint;
	/** set the callData instead of using the encoding of the provided Metatransactions*/
	callData?: string;
	/** set the callGasLimit instead of estimating gas using the bundler*/
	callGasLimit?: bigint;
	/** set the verificationGasLimit instead of estimating gas using the bundler*/
	verificationGasLimit?: bigint;
	/** set the preVerificationGas instead of estimating gas using the bundler*/
	preVerificationGas?: bigint;
	/** set the maxFeePerGas instead of querying the current gas price from the rpc node */
	maxFeePerGas?: bigint;
	/** set the maxPriorityFeePerGas instead of querying the current gas price from the rpc node */
	maxPriorityFeePerGas?: bigint;

	/** set the callGasLimitPercentageMultiplier instead of estimating gas using the bundler*/
	callGasLimitPercentageMultiplier?: number;
	/** set the verificationGasLimitPercentageMultiplier instead of estimating gas using the bundler*/
	verificationGasLimitPercentageMultiplier?: number;
	/** set the preVerificationGasPercentageMultiplier instead of estimating gas using the bundler*/
	preVerificationGasPercentageMultiplier?: number;
	/** set the maxFeePerGasPercentageMultiplier instead of querying the current gas price from the rpc node */
	maxFeePerGasPercentageMultiplier?: number;
	/** set the maxPriorityFeePerGasPercentageMultiplier instead of querying the current gas price from the rpc node */
	maxPriorityFeePerGasPercentageMultiplier?: number;

	/** pass some state overrides for gas estimation */
	state_override_set?: StateOverrideSet;

	/**
	 * Skip calling the bundler's gas estimation entirely. When true, the returned
	 * UserOperation still gets a dummy signature, but its gas limits come from the
	 * provided overrides (or stay at 0n). Useful when estimation is run separately
	 * — for example, by a paymaster sponsorship call that returns its own limits.
	 */
	skipGasEstimation?: boolean;

	dummySignerSignaturePairs?: SignerSignaturePair[];

	webAuthnSharedSigner?: string;
	webAuthnSignerFactory?: string;
	webAuthnSignerSingleton?: string;
	webAuthnSignerProxyCreationCode?: string;

	eip7212WebAuthnPrecompileVerifier?: string;
	eip7212WebAuthnContractVerifier?: string;
	safeModuleExecutorFunctionSelector?: SafeModuleExecutorFunctionSelector;
	multisendContractAddress?: string;

	gasLevel?: GasOption;
	polygonGasStation?: PolygonChain;

	expectedSigners?: Signer[];
	isMultiChainSignature?: boolean;

	parallelPaymasterInitValues?: {
		/** set the paymaster contract address */
		paymaster: string;
		/** set the paymaster verification gas limit */
		paymasterVerificationGasLimit: bigint;
		/** set the paymaster post-operation gas limit */
		paymasterPostOpGasLimit: bigint;
		/** set the paymaster data, only valid value is 0x22e325a297439656 */
		paymasterData: string;
	};
}

/**
 * Overrides for the "createUserOperation" function
 */
export interface CreateUserOperationV6Overrides extends CreateBaseUserOperationOverrides {
	/** set the initCode instead of using the calculated value */
	initCode?: string;
}

/**
 * Overrides for the "createUserOperation" function
 */
export interface CreateUserOperationV7Overrides extends CreateBaseUserOperationOverrides {
	/** set the factory address instead of using the calculated value */
	factory?: string;
	/** set the factory data instead of using the calculated value */
	factoryData?: string;
}

export interface CreateUserOperationV9Overrides extends CreateUserOperationV7Overrides {}

/** Safe singleton contract address and init hash for deterministic deployment. */
export interface SafeAccountSingleton {
	/** The address of the Safe singleton contract */
	singletonAddress: string;
	/** The init code hash used for CREATE2 address computation */
	singletonInitHash: string;
}

/**
 * Overrides for initializing a new Safe account
 */
export interface InitCodeOverrides {
	/** signature threshold
	 * @defaultValue 1
	 */
	threshold?: number;
	/** create2 nonce - to generate different sender addresses from the same owners
	 * @defaultValue 0
	 */
	c2Nonce?: bigint;
	safe4337ModuleAddress?: string;
	safeModuleSetupAddress?: string;

	entrypointAddress?: string;
	/** Safe contract singleton address
	 */
	safeAccountSingleton?: SafeAccountSingleton;
	/** Safe Factory address
	 */
	safeAccountFactoryAddress?: string;
	/** Safe 4337 module address
	 */
	multisendContractAddress?: string;
	webAuthnSharedSigner?: string;
	eip7212WebAuthnPrecompileVerifierForSharedSigner?: string;
	eip7212WebAuthnContractVerifierForSharedSigner?: string;

	onChainIdentifierParams?: OnChainIdentifierParamsType;
	onChainIdentifier?: string;
}

export interface BaseInitOverrides {
	/** signature threshold
	 * @defaultValue 1
	 */
	threshold?: number;
	/** create2 nonce - to generate different sender addresses from the same owners
	 * @defaultValue 0
	 */
	c2Nonce?: bigint;

	safeAccountSingleton?: SafeAccountSingleton;
	/** Safe Factory address
	 */
	safeAccountFactoryAddress?: string;
	/** Safe 4337 module address
	 */
	multisendContractAddress?: string;
	webAuthnSharedSigner?: string;
	eip7212WebAuthnPrecompileVerifierForSharedSigner?: string;
	eip7212WebAuthnContractVerifierForSharedSigner?: string;
}

/** Overrides for WebAuthn signature creation and verification. */
export interface WebAuthnSignatureOverrides {
	isInit?: boolean;
	webAuthnSharedSigner?: string;
	eip7212WebAuthnPrecompileVerifier?: string;
	eip7212WebAuthnContractVerifier?: string;
	webAuthnSignerFactory?: string;
	webAuthnSignerSingleton?: string;
	webAuthnSignerProxyCreationCode?: string;
	validAfter?: bigint;
	validUntil?: bigint;
	isMultiChainSignature?: boolean;
	multiChainMerkleProof?: string;
	safe4337ModuleAddress?: string;
}

/**
 * Safe has two executor functions "executeUserOpWithErrorString" and "executeUserOp"
 */
export enum SafeModuleExecutorFunctionSelector {
	executeUserOpWithErrorString = "0x541d63c8",
	executeUserOp = "0x7bb37428",
}

/** EIP-712 domain for Safe UserOperation signing. */
export interface SafeUserOperationTypedDataDomain {
	/** Target chain ID to prevent cross-chain replay */
	chainId: number;
	/** Address of the Safe 4337 module contract */
	verifyingContract: string;
}

/** EIP-712 typed data values for a Safe UserOperation (EntryPoint v0.6). */
export interface SafeUserOperationV6TypedMessageValue {
	/** The Safe account address */
	safe: string;
	/** The UserOperation nonce */
	nonce: bigint;
	/** Packed factory address and init data for account deployment */
	initCode: string;
	/** Encoded call data for the account to execute */
	callData: string;
	/** Gas limit for the main execution call */
	callGasLimit: bigint;
	/** Gas limit for the verification step */
	verificationGasLimit: bigint;
	/** Gas overhead to compensate for pre-verification execution */
	preVerificationGas: bigint;
	/** Maximum fee per gas unit */
	maxFeePerGas: bigint;
	/** Maximum priority fee (tip) per gas unit */
	maxPriorityFeePerGas: bigint;
	/** Packed paymaster address and data */
	paymasterAndData: string;
	/** Unix timestamp after which the signature becomes valid */
	validAfter: bigint;
	/** Unix timestamp after which the signature expires */
	validUntil: bigint;
	/** EntryPoint contract address */
	entryPoint: string;
}

/** EIP-712 typed data values for a Safe UserOperation (EntryPoint v0.7). Note: field order differs from v0.6. */
export interface SafeUserOperationV7TypedMessageValue {
	/** The Safe account address */
	safe: string;
	/** The UserOperation nonce */
	nonce: bigint;
	/** Packed factory address and init data for account deployment */
	initCode: string;
	/** Encoded call data for the account to execute */
	callData: string;
	/** Gas limit for the verification step */
	verificationGasLimit: bigint;
	/** Gas limit for the main execution call */
	callGasLimit: bigint;
	/** Gas overhead to compensate for pre-verification execution */
	preVerificationGas: bigint;
	/** Maximum priority fee (tip) per gas unit */
	maxPriorityFeePerGas: bigint;
	/** Maximum fee per gas unit */
	maxFeePerGas: bigint;
	/** Packed paymaster address and data */
	paymasterAndData: string;
	/** Unix timestamp after which the signature becomes valid */
	validAfter: bigint;
	/** Unix timestamp after which the signature expires */
	validUntil: bigint;
	/** EntryPoint contract address */
	entryPoint: string;
}

/** EIP-712 typed data values for a Safe UserOperation (EntryPoint v0.9). */
export interface SafeUserOperationV9TypedMessageValue
	extends SafeUserOperationV7TypedMessageValue {}

/** An Ethereum address string representing an ECDSA signer. */
export type ECDSAPublicAddress = string;

/** WebAuthn/Passkey public key with x,y coordinates on the P-256 curve. */
export interface WebauthnPublicKey {
	/** X coordinate of the public key */
	x: bigint;
	/** Y coordinate of the public key */
	y: bigint;
}

/** A signer can be either an ECDSA address or a WebAuthn public key. */
export type Signer = ECDSAPublicAddress | WebauthnPublicKey;

export type ECDSASignature = string;

export interface WebauthnSignatureData {
	authenticatorData: ArrayBuffer;
	clientDataFields: string;
	rs: [bigint, bigint];
}

/** A pair of signer identity and their signature. */
export interface SignerSignaturePair {
	/** The signer (ECDSA address or WebAuthn key) */
	signer: Signer;
	/** The signature hex string */
	signature: string;
	/** Whether this is a contract signature (EIP-1271) */
	isContractSignature?: boolean;
}

/** Dummy signer-signature pair for gas estimation with EOA signers. */
export const EOADummySignerSignaturePair: SignerSignaturePair = {
	signer: "0xfD90FAd33ee8b58f32c00aceEad1358e4AFC23f9",
	signature:
		"0x47003599ffa7e9198f321afa774e34a12a959844efd6363b88896e9c24ed33cf4e1be876ef123a3c4467e7d451511434039539699f2baa2f44955fa3d1c1c6d81c",
	isContractSignature: false,
};

/** Dummy signer-signature pair for gas estimation with WebAuthn signers. */
export const WebauthnDummySignerSignaturePair: SignerSignaturePair = {
	signer: "0xfD90FAd33ee8b58f32c00aceEad1358e4AFC23f9",
	signature:
		"0x000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000e06c92f0ac5c4ef9e74721c23d80a9fc12f259ca84afb160f0890483539b9e6080d824c0e6c795157ad5d1ee5eff1ceeb3031009a595f9360919b83dd411c5a78d0000000000000000000000000000000000000000000000000000000000000025a24f744b28d73f066bf3203d145765a7bc735e6328168c8b03e476da3ad0d8fe0400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001e226f726967696e223a2268747470733a2f2f736166652e676c6f62616c220000",
	isContractSignature: true,
};

/** A UserOperation with chain context ready for signing. */
export interface UserOperationToSign {
	chainId: bigint;
	userOperation: UserOperationV9;
	validAfter?: bigint;
	validUntil?: bigint;
}

/** Extends UserOperationToSign with per-operation WebAuthn/module overrides. */
export interface UserOperationToSignWithOverrides extends UserOperationToSign {
	overrides?: {
		isInit?: boolean;
		webAuthnSharedSigner?: string;
		eip7212WebAuthnPrecompileVerifier?: string;
		eip7212WebAuthnContractVerifier?: string;
		webAuthnSignerFactory?: string;
		webAuthnSignerSingleton?: string;
		webAuthnSignerProxyCreationCode?: string;
		safe4337ModuleAddress?: string;
	};
}

/** EIP-712 domain for multi-chain signature Merkle tree root. */
export interface MultiChainSignatureMerkleTreeRootTypedDataDomain {
	verifyingContract: string;
}

/** EIP-712 typed message value containing a Merkle tree root for multi-chain signatures. */
export interface MultiChainSignatureMerkleTreeRootTypedMessageValue {
	merkleTreeRoot: string;
}
