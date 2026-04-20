import type {
	GasOption,
	ParallelPaymasterInitValues,
	PolygonChain,
	StateOverrideSet,
} from "src/types";

/**
 * Key types supported by the Calibur smart account.
 */
export enum CaliburKeyType {
	/** Raw P-256 (secp256r1) key */
	P256 = 0,
	/** WebAuthn-wrapped P-256 key (passkey) */
	WebAuthnP256 = 1,
	/** secp256k1 key (standard Ethereum EOA) */
	Secp256k1 = 2,
}

/**
 * A key registered on a Calibur account.
 */
export interface CaliburKey {
	/** The type of cryptographic key */
	keyType: CaliburKeyType;
	/** ABI-encoded public key bytes (hex string) */
	publicKey: string;
}

/**
 * Settings for a key registered on a Calibur account.
 * All fields are optional — used as input when registering or updating keys.
 */
export interface CaliburKeySettings {
	/** Hook contract address called during validation (zero address = no hook) */
	hook?: string;
	/** Unix timestamp after which the key expires (0 = never) */
	expiration?: number;
	/** Whether the key has admin privileges */
	isAdmin?: boolean;
}

/**
 * Concrete key settings returned from on-chain reads.
 * Unlike {@link CaliburKeySettings}, all fields are required since
 * the contract always returns concrete values.
 */
export interface CaliburKeySettingsResult {
	/** Hook contract address called during validation (zero address = no hook) */
	hook: string;
	/** Unix timestamp after which the key expires (0 = never) */
	expiration: number;
	/** Whether the key has admin privileges */
	isAdmin: boolean;
}

/**
 * WebAuthn assertion data matching the on-chain `WebAuthn.WebAuthnAuth` struct.
 * Used when signing UserOperations with a passkey.
 */
export interface WebAuthnSignatureData {
	/** Authenticator data bytes (hex string) */
	authenticatorData: string;
	/** Client data JSON string (UTF-8) */
	clientDataJSON: string;
	/** Index of the challenge in clientDataJSON */
	challengeIndex: bigint;
	/** Index of the type field in clientDataJSON */
	typeIndex: bigint;
	/** ECDSA signature r component */
	r: bigint;
	/** ECDSA signature s component */
	s: bigint;
}

/**
 * Optional overrides for UserOperation fields when calling
 * {@link Calibur7702Account.createUserOperation}.
 * Any field left undefined will be auto-determined.
 */
export interface CaliburCreateUserOperationOverrides {
	/** Set the nonce instead of querying from the RPC node */
	nonce?: bigint;
	/** Set the callData instead of encoding the provided MetaTransactions */
	callData?: string;
	/** Set the callGasLimit instead of estimating via the bundler */
	callGasLimit?: bigint;
	/** Set the verificationGasLimit instead of estimating via the bundler */
	verificationGasLimit?: bigint;
	/** Set the preVerificationGas instead of estimating via the bundler */
	preVerificationGas?: bigint;
	/** Set the maxFeePerGas instead of querying current gas price */
	maxFeePerGas?: bigint;
	/** Set the maxPriorityFeePerGas instead of querying current gas price */
	maxPriorityFeePerGas?: bigint;

	/** Percentage multiplier applied to estimated callGasLimit */
	callGasLimitPercentageMultiplier?: number;
	/** Percentage multiplier applied to estimated verificationGasLimit */
	verificationGasLimitPercentageMultiplier?: number;
	/** Percentage multiplier applied to estimated preVerificationGas */
	preVerificationGasPercentageMultiplier?: number;
	/** Percentage multiplier applied to fetched maxFeePerGas */
	maxFeePerGasPercentageMultiplier?: number;
	/** Percentage multiplier applied to fetched maxPriorityFeePerGas */
	maxPriorityFeePerGasPercentageMultiplier?: number;

	/** State overrides for gas estimation */
	state_override_set?: StateOverrideSet;

	/** Override the dummy signature used during gas estimation */
	dummySignature?: string;

	/** Gas price level preference */
	gasLevel?: GasOption;
	/** Polygon chain identifier for fetching gas prices from Polygon Gas Station */
	polygonGasStation?: PolygonChain;

	/** Whether BatchedCall should revert on individual call failure (default: true) */
	revertOnFailure?: boolean;

	/**
	 * Paymaster init values for gas estimation. Set these to include
	 * paymaster data during gas estimation so preVerificationGas is accurate.
	 * Use {@link ExperimentalAllowAllPaymaster.getPaymasterFieldsInitValues} or similar
	 * to obtain these values.
	 */
	paymasterFields?: ParallelPaymasterInitValues;

	/**
	 * EIP-7702 authorization fields. Required for the first UserOperation
	 * to delegate the EOA to the Calibur singleton.
	 */
	eip7702Auth?: {
		chainId: bigint;
		address?: string;
		nonce?: bigint;
		yParity?: string;
		r?: string;
		s?: string;
	};
}

/**
 * Optional overrides for signature wrapping.
 */
export interface CaliburSignatureOverrides {
	/** Hook data to append to the signature (default: "0x" = empty) */
	hookData?: string;
	/** Key hash of a registered secondary key. If omitted, the root key hash is used. */
	keyHash?: string;
}
