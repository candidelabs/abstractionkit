import { Safe_L2_V1_5_0 } from "src/constants";
import type {
	MetaTransaction,
	OnChainIdentifierParamsType,
	StateOverrideSet,
	UserOperationV7,
} from "src/types";
import { SafeAccount } from "./SafeAccount";
import { SafeAccountV0_3_0 } from "./SafeAccountV0_3_0";
import type {
	CreateUserOperationV7Overrides,
	InitCodeOverrides,
	SafeAccountSingleton,
	Signer,
	SignerSignaturePair,
	WebAuthnSignatureOverrides,
	WebauthnPublicKey,
} from "./types";

/**
 * Safe v1.5.0 smart account implementation with module v0.3.0 for EntryPoint v0.7.
 * Extends {@link SafeAccountV0_3_0} using the Safe L2 v1.5.0 singleton instead of v1.4.1.
 *
 * @example
 * // Create a new account using Safe v1.5.0 singleton
 * const smartAccount = SafeAccountV1_5_0_M_0_3_0.initializeNewAccount([ownerAddress]);
 *
 * // Or connect to an existing deployed account
 * const smartAccount = new SafeAccountV1_5_0_M_0_3_0(existingAccountAddress);
 */
export class SafeAccountV1_5_0_M_0_3_0 extends SafeAccountV0_3_0 {
	static readonly DEFAULT_WEB_AUTHN_PRECOMPILE: string =
		"0x0000000000000000000000000000000000000100"; // EIP-7951
	// Daimo P256 contract verifier paired with module v0.3.0. Same value
	// exposed under both names: DAIMO_VERIFIER for self-documentation and
	// CONTRACT_VERIFIER as the polymorphic slot fromSafeWebauthn reads.
	static readonly DEFAULT_WEB_AUTHN_DAIMO_VERIFIER: string =
		"0xc2b78104907F722DABAc4C69f826a522B2754De4";
	static readonly DEFAULT_WEB_AUTHN_CONTRACT_VERIFIER: string =
		"0xc2b78104907F722DABAc4C69f826a522B2754De4";

	/**
	 * Create a SafeAccountV1_5_0_M_0_3_0 instance for an existing deployed account.
	 * For new (undeployed) accounts, use the static `initializeNewAccount` method instead.
	 *
	 * @param accountAddress - The on-chain address of the Safe account
	 * @param overrides - Override default module and EntryPoint addresses
	 */
	constructor(
		accountAddress: string,
		overrides: {
			safe4337ModuleAddress?: string;
			entrypointAddress?: string;
			onChainIdentifierParams?: OnChainIdentifierParamsType;
			onChainIdentifier?: string;
			safeAccountSingleton?: SafeAccountSingleton;
		} = {},
	) {
		super(accountAddress, {
			safe4337ModuleAddress: overrides.safe4337ModuleAddress,
			entrypointAddress: overrides.entrypointAddress,
			onChainIdentifierParams: overrides.onChainIdentifierParams,
			onChainIdentifier: overrides.onChainIdentifier,
			safeAccountSingleton: overrides.safeAccountSingleton ?? Safe_L2_V1_5_0,
		});
	}

	/**
	 * Calculate the deterministic proxy address from the initializer calldata.
	 * Uses the Safe v1.5.0 singleton init hash by default.
	 *
	 * @param initializerCallData - The encoded initializer calldata for the proxy
	 * @param overrides - Override default nonce, factory address, and singleton init hash
	 * @returns The deterministic proxy address
	 */
	public static createProxyAddress(
		initializerCallData: string,
		overrides: {
			c2Nonce?: bigint;
			safeFactoryAddress?: string;
			singletonInitHash?: string;
		} = {},
	): string {
		const modOverrides = {
			...overrides,
			singletonInitHash: overrides.singletonInitHash ?? Safe_L2_V1_5_0.singletonInitHash,
		};
		return SafeAccountV0_3_0.createProxyAddress(initializerCallData, modOverrides);
	}

	/**
	 * Create and initialize a new SafeAccountV1_5_0_M_0_3_0 from its initial owners.
	 * The account address is deterministically computed but not yet deployed on-chain.
	 * The first UserOperation sent will deploy it automatically via factory data.
	 *
	 * @param owners - Array of owner signers (at least one required)
	 * @param overrides - Override default initialization values
	 * @returns A SafeAccountV1_5_0_M_0_3_0 instance with factory data set for deployment
	 *
	 * @example
	 * const smartAccount = SafeAccountV1_5_0_M_0_3_0.initializeNewAccount(["0xOwnerAddress"]);
	 */
	public static initializeNewAccount(
		owners: Signer[],
		overrides: InitCodeOverrides = {},
	): SafeAccountV1_5_0_M_0_3_0 {
		const modOverrides = {
			...overrides,
			safeAccountSingleton: overrides.safeAccountSingleton ?? Safe_L2_V1_5_0,
			eip7212WebAuthnPrecompileVerifierForSharedSigner:
				overrides.eip7212WebAuthnPrecompileVerifierForSharedSigner ??
				SafeAccountV1_5_0_M_0_3_0.DEFAULT_WEB_AUTHN_PRECOMPILE,
			eip7212WebAuthnContractVerifierForSharedSigner:
				overrides.eip7212WebAuthnContractVerifierForSharedSigner ??
				SafeAccountV1_5_0_M_0_3_0.DEFAULT_WEB_AUTHN_DAIMO_VERIFIER,
		};
		return SafeAccountV0_3_0.initializeNewAccount(owners, modOverrides);
	}

	/**
	 * Calculate the counterfactual account address from the initial owner signers.
	 * Does not deploy the account. Uses the Safe v1.5.0 singleton by default.
	 *
	 * @param owners - Array of owner signers (ECDSA addresses or WebAuthn public keys)
	 * @param overrides - Override default initialization values
	 * @returns The deterministic account address
	 */
	public static createAccountAddress(owners: Signer[], overrides: InitCodeOverrides = {}): string {
		const modOverrides = {
			...overrides,
			safeAccountSingleton: overrides.safeAccountSingleton ?? Safe_L2_V1_5_0,
			eip7212WebAuthnPrecompileVerifierForSharedSigner:
				overrides.eip7212WebAuthnPrecompileVerifierForSharedSigner ??
				SafeAccountV1_5_0_M_0_3_0.DEFAULT_WEB_AUTHN_PRECOMPILE,
			eip7212WebAuthnContractVerifierForSharedSigner:
				overrides.eip7212WebAuthnContractVerifierForSharedSigner ??
				SafeAccountV1_5_0_M_0_3_0.DEFAULT_WEB_AUTHN_DAIMO_VERIFIER,
		};
		return SafeAccountV0_3_0.createAccountAddress(owners, modOverrides);
	}

	/**
	 * Create the factory address and encoded factory data for deploying a new Safe account.
	 * Uses the Safe v1.5.0 singleton by default.
	 *
	 * @param owners - Array of owner signers (ECDSA addresses or WebAuthn public keys)
	 * @param overrides - Override default initialization values
	 * @returns A tuple of [factoryAddress, factoryData]
	 */
	public static createFactoryAddressAndData(
		owners: Signer[],
		overrides: InitCodeOverrides = {},
	): [string, string] {
		const modOverrides = {
			...overrides,
			safeAccountSingleton: overrides.safeAccountSingleton ?? Safe_L2_V1_5_0,
			eip7212WebAuthnPrecompileVerifierForSharedSigner:
				overrides.eip7212WebAuthnPrecompileVerifierForSharedSigner ??
				SafeAccountV1_5_0_M_0_3_0.DEFAULT_WEB_AUTHN_PRECOMPILE,
			eip7212WebAuthnContractVerifierForSharedSigner:
				overrides.eip7212WebAuthnContractVerifierForSharedSigner ??
				SafeAccountV1_5_0_M_0_3_0.DEFAULT_WEB_AUTHN_DAIMO_VERIFIER,
		};
		return SafeAccountV0_3_0.createFactoryAddressAndData(owners, modOverrides);
	}

	/**
	 * Create a UserOperation with v1.5.0 defaults applied for WebAuthn verification
	 * (RIP-7951 precompile + Daimo fallback). See {@link SafeAccountV0_3_0.createUserOperation}.
	 *
	 * @param transactions - Array of MetaTransactions to execute
	 * @param providerRpc - Ethereum JSON-RPC node URL (for nonce and gas prices)
	 * @param bundlerRpc - Bundler RPC URL (for gas estimation)
	 * @param overrides - Override any auto-determined values
	 * @returns The unsigned UserOperation (UserOperationV7) ready to be signed
	 */
	public async createUserOperation(
		transactions: MetaTransaction[],
		providerRpc?: string,
		bundlerRpc?: string,
		overrides: CreateUserOperationV7Overrides = {},
	): Promise<UserOperationV7> {
		return super.createUserOperation(transactions, providerRpc, bundlerRpc, {
			...overrides,
			eip7212WebAuthnPrecompileVerifier:
				overrides.eip7212WebAuthnPrecompileVerifier ??
				SafeAccountV1_5_0_M_0_3_0.DEFAULT_WEB_AUTHN_PRECOMPILE,
			eip7212WebAuthnContractVerifier:
				overrides.eip7212WebAuthnContractVerifier ??
				SafeAccountV1_5_0_M_0_3_0.DEFAULT_WEB_AUTHN_DAIMO_VERIFIER,
		});
	}

	/**
	 * Estimate gas limits for a UserOperation with v1.5.0 WebAuthn defaults applied.
	 *
	 * @param userOperation - The UserOperation to estimate gas for
	 * @param bundlerRpc - Bundler RPC URL
	 * @param overrides - State overrides, dummy signatures, and WebAuthn configuration
	 * @returns A tuple of [preVerificationGas, verificationGasLimit, callGasLimit]
	 */
	public async estimateUserOperationGas(
		userOperation: UserOperationV7,
		bundlerRpc: string,
		overrides: {
			stateOverrideSet?: StateOverrideSet;
			dummySignerSignaturePairs?: SignerSignaturePair[];
			expectedSigners?: Signer[];
			webAuthnSharedSigner?: string;
			webAuthnSignerFactory?: string;
			webAuthnSignerSingleton?: string;
			webAuthnSignerProxyCreationCode?: string;
			eip7212WebAuthnPrecompileVerifier?: string;
			eip7212WebAuthnContractVerifier?: string;
		} = {},
	): Promise<[bigint, bigint, bigint]> {
		return super.estimateUserOperationGas(userOperation, bundlerRpc, {
			...overrides,
			eip7212WebAuthnPrecompileVerifier:
				overrides.eip7212WebAuthnPrecompileVerifier ??
				SafeAccountV1_5_0_M_0_3_0.DEFAULT_WEB_AUTHN_PRECOMPILE,
			eip7212WebAuthnContractVerifier:
				overrides.eip7212WebAuthnContractVerifier ??
				SafeAccountV1_5_0_M_0_3_0.DEFAULT_WEB_AUTHN_DAIMO_VERIFIER,
		});
	}

	/**
	 * Compute the counterfactual address of the WebAuthn signer proxy for the given public key.
	 * Applies v1.5.0 defaults for precompile + Daimo verifier.
	 *
	 * @param x - X coordinate of the WebAuthn P-256 public key
	 * @param y - Y coordinate of the WebAuthn P-256 public key
	 * @param overrides - Override WebAuthn verifier, factory, singleton, and proxy-code addresses
	 * @returns The counterfactual verifier/proxy address
	 */
	public static createWebAuthnSignerVerifierAddress(
		x: bigint,
		y: bigint,
		overrides: {
			eip7212WebAuthnPrecompileVerifier?: string;
			eip7212WebAuthnContractVerifier?: string;
			webAuthnSignerFactory?: string;
			webAuthnSignerSingleton?: string;
			webAuthnSignerProxyCreationCode?: string;
		} = {},
	): string {
		return SafeAccount.createWebAuthnSignerVerifierAddress(x, y, {
			...overrides,
			eip7212WebAuthnPrecompileVerifier:
				overrides.eip7212WebAuthnPrecompileVerifier ??
				SafeAccountV1_5_0_M_0_3_0.DEFAULT_WEB_AUTHN_PRECOMPILE,
			eip7212WebAuthnContractVerifier:
				overrides.eip7212WebAuthnContractVerifier ??
				SafeAccountV1_5_0_M_0_3_0.DEFAULT_WEB_AUTHN_DAIMO_VERIFIER,
		});
	}

	/**
	 * Create a MetaTransaction that deploys the WebAuthn verifier/proxy for the given public key.
	 * Applies v1.5.0 defaults for precompile + Daimo verifier.
	 *
	 * @param x - X coordinate of the WebAuthn P-256 public key
	 * @param y - Y coordinate of the WebAuthn P-256 public key
	 * @param overrides - Override WebAuthn verifier and factory addresses
	 * @returns A MetaTransaction that deploys the verifier
	 */
	public static createDeployWebAuthnVerifierMetaTransaction(
		x: bigint,
		y: bigint,
		overrides: {
			eip7212WebAuthnPrecompileVerifier?: string;
			eip7212WebAuthnContractVerifier?: string;
			webAuthnSignerFactory?: string;
		} = {},
	): MetaTransaction {
		return SafeAccount.createDeployWebAuthnVerifierMetaTransaction(x, y, {
			...overrides,
			eip7212WebAuthnPrecompileVerifier:
				overrides.eip7212WebAuthnPrecompileVerifier ??
				SafeAccountV1_5_0_M_0_3_0.DEFAULT_WEB_AUTHN_PRECOMPILE,
			eip7212WebAuthnContractVerifier:
				overrides.eip7212WebAuthnContractVerifier ??
				SafeAccountV1_5_0_M_0_3_0.DEFAULT_WEB_AUTHN_DAIMO_VERIFIER,
		});
	}

	/**
	 * Build dummy signer/signature pairs for gas estimation, with v1.5.0 WebAuthn defaults.
	 *
	 * @param expectedSigners - Signers whose signatures will be produced at sign time
	 * @param webAuthnSignatureOverrides - Override WebAuthn verifier/module configuration
	 * @returns An array of dummy SignerSignaturePair entries, one per expected signer
	 */
	public static createDummySignerSignaturePairForExpectedSigners(
		expectedSigners: Signer[],
		webAuthnSignatureOverrides: WebAuthnSignatureOverrides = {},
	): SignerSignaturePair[] {
		return SafeAccount.createDummySignerSignaturePairForExpectedSigners(expectedSigners, {
			...webAuthnSignatureOverrides,
			eip7212WebAuthnPrecompileVerifier:
				webAuthnSignatureOverrides.eip7212WebAuthnPrecompileVerifier ??
				SafeAccountV1_5_0_M_0_3_0.DEFAULT_WEB_AUTHN_PRECOMPILE,
			eip7212WebAuthnContractVerifier:
				webAuthnSignatureOverrides.eip7212WebAuthnContractVerifier ??
				SafeAccountV1_5_0_M_0_3_0.DEFAULT_WEB_AUTHN_DAIMO_VERIFIER,
		});
	}

	/**
	 * Verify a WebAuthn signature over a message hash on-chain via the P-256 verifier.
	 * Applies v1.5.0 defaults for precompile + Daimo verifier.
	 *
	 * @param nodeRpcUrl - Ethereum JSON-RPC node URL
	 * @param signer - WebAuthn public key that purportedly produced the signature
	 * @param messageHash - The hash that was signed
	 * @param signature - The WebAuthn signature bytes
	 * @param overrides - Override WebAuthn verifier and singleton addresses
	 * @returns Promise of `true` if the signature verifies, otherwise `false`
	 */
	public static async verifyWebAuthnSignatureForMessageHash(
		nodeRpcUrl: string,
		signer: WebauthnPublicKey,
		messageHash: string,
		signature: string,
		overrides: {
			eip7212WebAuthnPrecompileVerifier?: string;
			eip7212WebAuthnContractVerifier?: string;
			webAuthnSignerSingleton?: string;
		} = {},
	): Promise<boolean> {
		return SafeAccount.verifyWebAuthnSignatureForMessageHash(
			nodeRpcUrl,
			signer,
			messageHash,
			signature,
			{
				...overrides,
				eip7212WebAuthnPrecompileVerifier:
					overrides.eip7212WebAuthnPrecompileVerifier ??
					SafeAccountV1_5_0_M_0_3_0.DEFAULT_WEB_AUTHN_PRECOMPILE,
				eip7212WebAuthnContractVerifier:
					overrides.eip7212WebAuthnContractVerifier ??
					SafeAccountV1_5_0_M_0_3_0.DEFAULT_WEB_AUTHN_DAIMO_VERIFIER,
			},
		);
	}
}
