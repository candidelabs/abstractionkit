import { SafeAccount } from "./SafeAccount";
import {
	InitCodeOverrides,
	Signer,
	CreateUserOperationV7Overrides,
    SafeUserOperationTypedDataDomain,
    SafeUserOperationV7TypedMessageValue,
    SafeAccountSingleton,
	SignerSignaturePair,
} from "./types";

import { UserOperationV7, MetaTransaction, OnChainIdentifierParamsType, StateOverrideSet } from "../../types";
import { ENTRYPOINT_V7, Safe_L2_V1_4_1 } from "src/constants";

/**
 * Safe smart account implementation for EntryPoint v0.7.
 * Provides methods to create, sign, and send ERC-4337 UserOperations
 * using Safe's modular smart account architecture with the v0.7 EntryPoint.
 *
 * @example
 * // Create a new account (not yet deployed on-chain)
 * const smartAccount = SafeAccountV0_3_0.initializeNewAccount([ownerAddress]);
 *
 * // Or connect to an existing deployed account
 * const smartAccount = new SafeAccountV0_3_0(existingAccountAddress);
 */
export class SafeAccountV0_3_0 extends SafeAccount {
	static readonly DEFAULT_ENTRYPOINT_ADDRESS = ENTRYPOINT_V7;
	static readonly DEFAULT_SAFE_4337_MODULE_ADDRESS =
		"0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226";
	static readonly DEFAULT_SAFE_MODULE_SETUP_ADDRESS =
		"0x2dd68b007B46fBe91B9A7c3EDa5A7a1063cB5b47";

	/**
	 * Create a SafeAccountV0_3_0 instance for an existing deployed account.
	 * For new (undeployed) accounts, use the static `initializeNewAccount` method instead.
	 *
	 * @param accountAddress - The on-chain address of the Safe account
	 * @param overrides - Override default module, EntryPoint, and singleton addresses
	 */
	constructor(
		accountAddress: string,
		overrides: {
			safe4337ModuleAddress?: string;
			entrypointAddress?: string;
            onChainIdentifierParams?: OnChainIdentifierParamsType;
            onChainIdentifier?: string
            safeAccountSingleton?: SafeAccountSingleton;
		} = {},
	) {
		const safe4337ModuleAddress =
			overrides.safe4337ModuleAddress ??
			SafeAccountV0_3_0.DEFAULT_SAFE_4337_MODULE_ADDRESS;
		const entrypointAddress =
			overrides.entrypointAddress ??
			SafeAccountV0_3_0.DEFAULT_ENTRYPOINT_ADDRESS;
    
        super(
            accountAddress, safe4337ModuleAddress, entrypointAddress,
            {
                onChainIdentifierParams: overrides.onChainIdentifierParams,
                onChainIdentifier: overrides.onChainIdentifier,
                safeAccountSingleton: overrides.safeAccountSingleton
            }
        );
	}

	/**
	 * Calculate the counterfactual account address from the initial owner signers.
	 * Does not deploy the account.
	 *
	 * @param owners - Array of owner signers (ECDSA addresses or WebAuthn public keys)
	 * @param overrides - Override default initialization values
	 * @returns The deterministic account address
	 */
	public static createAccountAddress(
		owners: Signer[],
		overrides: InitCodeOverrides = {},
	): string {
		const [accountAddress, ,] =
			SafeAccount.createAccountAddressAndFactoryAddressAndData(
				owners,
				overrides,
				overrides.safe4337ModuleAddress ??
					SafeAccountV0_3_0.DEFAULT_SAFE_4337_MODULE_ADDRESS,
				overrides.safeModuleSetupAddress ??
					SafeAccountV0_3_0.DEFAULT_SAFE_MODULE_SETUP_ADDRESS,
			);

		return accountAddress;
	}

	/**
	 * Create and initialize a new SafeAccountV0_3_0 from its initial owners.
	 * The account address is deterministically computed but not yet deployed on-chain.
	 * The first UserOperation sent will deploy it automatically via factory data.
	 *
	 * @param owners - Array of owner signers (at least one required)
	 * @param overrides - Override default initialization values
	 * @returns A SafeAccountV0_3_0 instance with factory data set for deployment
	 *
	 * @example
	 * const smartAccount = SafeAccountV0_3_0.initializeNewAccount(["0xOwnerAddress"]);
	 */
	public static initializeNewAccount(
		owners: Signer[],
		overrides: InitCodeOverrides = {},
	): SafeAccountV0_3_0 {
		let isInitWebAuthn = false;
		let x = 0n;
		let y = 0n;
		for (const owner of owners) {
			if (typeof owner != "string") {
				if (isInitWebAuthn) {
					throw new RangeError(
						"Only one Webauthn signer is allowed during initialization",
					);
				}
                if(owners.indexOf(owner) != 0){
                    throw new RangeError(
						"Webauthn owner has to be the first owner for an init transaction.",
					);
                }
				isInitWebAuthn = true;
				x = owner.x;
				y = owner.y;
			}
		}
		const [accountAddress, factoryAddress, factoryData] =
			SafeAccount.createAccountAddressAndFactoryAddressAndData(
				owners,
				overrides,
				overrides.safe4337ModuleAddress ??
					SafeAccountV0_3_0.DEFAULT_SAFE_4337_MODULE_ADDRESS,
				overrides.safeModuleSetupAddress ??
					SafeAccountV0_3_0.DEFAULT_SAFE_MODULE_SETUP_ADDRESS,
			);

		const safe = new SafeAccountV0_3_0(accountAddress, {
			safe4337ModuleAddress: overrides.safe4337ModuleAddress,
			entrypointAddress: overrides.entrypointAddress,
            onChainIdentifierParams: overrides.onChainIdentifierParams,
            onChainIdentifier: overrides.onChainIdentifier,
			safeAccountSingleton: overrides.safeAccountSingleton,
		});
		safe.factoryAddress = factoryAddress;
		safe.factoryData = factoryData;
		if (isInitWebAuthn) {
			safe.isInitWebAuthn = true;
			safe.x = x;
			safe.y = y;
		}

		return safe;
	}

	/**
	 * Compute the EIP-712 hash of a UserOperation for Safe signature verification.
	 *
	 * @param useroperation - UserOperation to hash
	 * @param chainId - Target chain ID
	 * @param overrides - Override validAfter, validUntil, entrypoint, and module addresses
	 * @returns The EIP-712 hash as a hex string
	 */
	public static getUserOperationEip712Hash(
		useroperation: UserOperationV7,
		chainId: bigint,
		overrides: {
			validAfter?: bigint;
			validUntil?: bigint;
			entrypointAddress?: string;
			safe4337ModuleAddress?: string;
		} = {},
	): string {
		const validAfter = overrides.validAfter ?? 0n;
		const validUntil = overrides.validUntil ?? 0n;
		const entrypointAddress =
			overrides.entrypointAddress ??
			SafeAccountV0_3_0.DEFAULT_ENTRYPOINT_ADDRESS;
		const safe4337ModuleAddress =
			overrides.safe4337ModuleAddress ??
			SafeAccountV0_3_0.DEFAULT_SAFE_4337_MODULE_ADDRESS;

		return SafeAccount.getUserOperationEip712Hash(useroperation, chainId, {
			validAfter,
			validUntil,
			entrypointAddress,
			safe4337ModuleAddress,
		});
	}
    
    /**
	 * Get the EIP-712 typed data components for a UserOperation.
	 * Useful for signing with external signers that need domain, types, and message separately.
	 *
	 * @param useroperation - UserOperation to get typed data for
	 * @param chainId - Target chain ID
	 * @param overrides - Override validAfter, validUntil, entrypoint, and module addresses
	 * @returns Object with domain, types, and messageValue for EIP-712 signing
	 */
	public static getUserOperationEip712Data(
		useroperation: UserOperationV7,
		chainId: bigint,
		overrides: {
			validAfter?: bigint;
			validUntil?: bigint;
			entrypointAddress?: string;
			safe4337ModuleAddress?: string;
		} = {},
	): {
        domain: SafeUserOperationTypedDataDomain,
        types:Record<string, {name: string;type: string;}[]>,
        messageValue: SafeUserOperationV7TypedMessageValue
    } 
     {
		const validAfter = overrides.validAfter ?? 0n;
		const validUntil = overrides.validUntil ?? 0n;
		const entrypointAddress =
			overrides.entrypointAddress ??
			SafeAccountV0_3_0.DEFAULT_ENTRYPOINT_ADDRESS;
		const safe4337ModuleAddress =
			overrides.safe4337ModuleAddress ??
			SafeAccountV0_3_0.DEFAULT_SAFE_4337_MODULE_ADDRESS;

		return SafeAccount.getUserOperationEip712Data(useroperation, chainId, {
			validAfter,
			validUntil,
			entrypointAddress,
			safe4337ModuleAddress,
		});
	}

	/**
	 * Build the Safe initializer calldata for the account setup transaction.
	 * Encodes the owners, threshold, module setup, and optional WebAuthn configuration.
	 *
	 * @param owners - Array of owner signers (ECDSA addresses or WebAuthn public keys)
	 * @param threshold - Number of required signatures for transaction approval
	 * @param overrides - Override default module, multisend, and WebAuthn addresses
	 * @returns The encoded initializer calldata hex string
	 */
	public static createInitializerCallData(
		owners: Signer[],
		threshold: number,
		overrides: {
			safe4337ModuleAddress?: string;
			safeModuleSetupAddress?: string;
			multisendContractAddress?: string;
			webAuthnSharedSigner?: string;
			eip7212WebAuthnPrecompileVerifierForSharedSigner?: string;
			eip7212WebAuthnContractVerifierForSharedSigner?: string;
		} = {},
	): string {
		const safe4337ModuleAddress =
			overrides.safe4337ModuleAddress ??
			SafeAccountV0_3_0.DEFAULT_SAFE_4337_MODULE_ADDRESS;
		const safeModuleSetupAddress =
			overrides.safeModuleSetupAddress ??
			SafeAccountV0_3_0.DEFAULT_SAFE_MODULE_SETUP_ADDRESS;

		return SafeAccount.createBaseInitializerCallData(
			owners,
			threshold,
			safe4337ModuleAddress,
			safeModuleSetupAddress,
			overrides.multisendContractAddress,
			overrides.webAuthnSharedSigner,
			overrides.eip7212WebAuthnPrecompileVerifierForSharedSigner,
			overrides.eip7212WebAuthnContractVerifierForSharedSigner,
		);
	}

	/**
	 * Create the factory address and encoded factory data for deploying a new Safe account.
	 *
	 * @param owners - Array of owner signers (ECDSA addresses or WebAuthn public keys)
	 * @param overrides - Override default initialization values
	 * @returns A tuple of [factoryAddress, factoryData]
	 */
	public static createFactoryAddressAndData(
		owners: Signer[],
		overrides: InitCodeOverrides = {},
	): [string, string] {
		return SafeAccount.createFactoryAddressAndData(
			owners,
			overrides,
			overrides.safe4337ModuleAddress ??
				SafeAccountV0_3_0.DEFAULT_SAFE_4337_MODULE_ADDRESS,
			overrides.safeModuleSetupAddress ??
				SafeAccountV0_3_0.DEFAULT_SAFE_MODULE_SETUP_ADDRESS,
		);
	}

	/**
	 * Create a complete UserOperation ready for signing.
	 * Automatically determines the nonce, fetches gas prices, estimates gas limits,
	 * and encodes the transactions into calldata. All values can be overridden.
	 *
	 * @param transactions - Array of MetaTransactions to execute
	 * @param providerRpc - Ethereum JSON-RPC node URL (for nonce and gas prices)
	 * @param bundlerRpc - Bundler RPC URL (for gas estimation)
	 * @param overrides - Override any auto-determined values
	 * @returns The unsigned UserOperation (UserOperationV7) ready to be signed
	 *
	 * @example
	 * const userOp = await smartAccount.createUserOperation(
	 *   [{ to: recipientAddress, value: 1000000000000000n, data: "0x" }],
	 *   nodeRpcUrl,
	 *   bundlerRpcUrl,
	 * );
	 */
	public async createUserOperation(
		transactions: MetaTransaction[],
		providerRpc?: string,
		bundlerRpc?: string,
		overrides: CreateUserOperationV7Overrides = {},
	): Promise<UserOperationV7> {
		const [userOperation, factoryAddress, factoryData] =
			await this.createBaseUserOperationAndFactoryAddressAndFactoryData(
				transactions,
				false,
				providerRpc,
				bundlerRpc,
				overrides,
			);

		const userOperationV7: UserOperationV7 = {
			...userOperation,
			factory: factoryAddress,
			factoryData,
			paymaster: null,
			paymasterVerificationGasLimit: null,
			paymasterPostOpGasLimit: null,
			paymasterData: null,
		};

		return userOperationV7;
	}

	/**
	 * Estimate gas limits for a UserOperation using the bundler.
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
		return this.baseEstimateUserOperationGas(
			userOperation,
			bundlerRpc,
			overrides
		);
	}

	/**
	 * Sign a UserOperation using one or more private keys via EIP-712 typed data signing.
	 *
	 * @param useroperation - The UserOperation to sign
	 * @param privateKeys - Array of private keys for the signers
	 * @param chainId - The target chain ID
	 * @param overrides - Override validAfter and validUntil timestamps
	 * @returns The formatted signature string ready to set on the UserOperation
	 *
	 * @example
	 * const signature = smartAccount.signUserOperation(userOp, [privateKey], 1n);
	 * userOp.signature = signature;
	 */
	public signUserOperation(
		useroperation: UserOperationV7,
		privateKeys: string[],
		chainId: bigint,
		overrides: {
			validAfter?: bigint;
			validUntil?: bigint;
		} = {},
	): string {
		return SafeAccount.baseSignSingleUserOperation(
			useroperation,
			privateKeys,
			chainId,
			this.entrypointAddress,
			this.safe4337ModuleAddress,
			overrides
		)
	}
}

/**
 * Alias for {@link SafeAccountV0_3_0} representing Safe v1.4.1 singleton with module v0.3.0.
 * Uses the same defaults and behavior as SafeAccountV0_3_0.
 */
export class SafeAccountV1_4_1_M_0_3_0 extends SafeAccountV0_3_0 {
}
