import { ENTRYPOINT_V6 } from "src/constants";
import type { Signer as AkSigner, SignContext } from "src/signer/types";
import { createCallData } from "src/utils";
import type {
	MetaTransaction,
	OnChainIdentifierParamsType,
	StateOverrideSet,
	UserOperationV6,
} from "../../types";
import { SafeAccount } from "./SafeAccount";
import { SafeAccountV0_3_0 } from "./SafeAccountV0_3_0";
import type {
	CreateUserOperationV6Overrides,
	InitCodeOverrides,
	SafeAccountSingleton,
	SafeSignatureOptions,
	SafeUserOperationTypedDataDomain,
	SafeUserOperationV6TypedMessageValue,
	Signer,
	SignerSignaturePair,
} from "./types";

/**
 * Safe smart account implementation for EntryPoint v0.6.
 * Provides methods to create, sign, and send ERC-4337 UserOperations
 * using Safe's modular smart account architecture.
 *
 * @example
 * // Create a new account (not yet deployed on-chain)
 * const smartAccount = SafeAccountV0_2_0.initializeNewAccount([ownerAddress]);
 *
 * // Or connect to an existing deployed account
 * const smartAccount = new SafeAccountV0_2_0(existingAccountAddress);
 */
export class SafeAccountV0_2_0 extends SafeAccount {
	static readonly DEFAULT_ENTRYPOINT_ADDRESS = ENTRYPOINT_V6;
	static readonly DEFAULT_SAFE_4337_MODULE_ADDRESS = "0xa581c4A4DB7175302464fF3C06380BC3270b4037";
	static readonly DEFAULT_SAFE_MODULE_SETUP_ADDRESS = "0x8EcD4ec46D4D2a6B64fE960B3D64e8B94B2234eb";

	/**
	 * Create a SafeAccountV0_2_0 instance for an existing deployed account.
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
		} = {},
	) {
		const safe4337ModuleAddress =
			overrides.safe4337ModuleAddress ?? SafeAccountV0_2_0.DEFAULT_SAFE_4337_MODULE_ADDRESS;
		const entrypointAddress =
			overrides.entrypointAddress ?? SafeAccountV0_2_0.DEFAULT_ENTRYPOINT_ADDRESS;

		super(accountAddress, safe4337ModuleAddress, entrypointAddress, {
			onChainIdentifierParams: overrides.onChainIdentifierParams,
			onChainIdentifier: overrides.onChainIdentifier,
		});
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
		overrides: {
			threshold?: number;
			c2Nonce?: bigint;
			safe4337ModuleAddress?: string;
			safeModuleSetupAddress?: string;
			safeAccountSingleton?: SafeAccountSingleton;
			safeAccountFactoryAddress?: string;
			multisendContractAddress?: string;
			webAuthnSharedSigner?: string;
			eip7212WebAuthnPrecompileVerifierForSharedSigner?: string;
			eip7212WebAuthnContractVerifierForSharedSigner?: string;
		} = {},
	): string {
		const [accountAddress, ,] = SafeAccount.createAccountAddressAndFactoryAddressAndData(
			owners,
			overrides,
			overrides.safe4337ModuleAddress ?? SafeAccountV0_2_0.DEFAULT_SAFE_4337_MODULE_ADDRESS,
			overrides.safeModuleSetupAddress ?? SafeAccountV0_2_0.DEFAULT_SAFE_MODULE_SETUP_ADDRESS,
		);

		return accountAddress;
	}

	/**
	 * Create and initialize a new SafeAccountV0_2_0 from its initial owners.
	 * The account address is deterministically computed but not yet deployed on-chain.
	 * The first UserOperation sent will deploy it automatically via initCode.
	 *
	 * @param owners - Array of owner signers (at least one required)
	 * @param overrides - Override default initialization values
	 * @returns A SafeAccountV0_2_0 instance with factory data set for deployment
	 *
	 * @example
	 * const smartAccount = SafeAccountV0_2_0.initializeNewAccount(["0xOwnerAddress"]);
	 */
	public static initializeNewAccount(
		owners: Signer[],
		overrides: InitCodeOverrides = {},
	): SafeAccountV0_2_0 {
		let isInitWebAuthn = false;
		let x = 0n;
		let y = 0n;
		for (const owner of owners) {
			if (typeof owner !== "string") {
				if (isInitWebAuthn) {
					throw new RangeError("Only one Webauthn signer is allowed during initialization");
				}
				if (owners.indexOf(owner) !== 0) {
					throw new RangeError("Webauthn owner has to be the first owner for an init transaction.");
				}

				isInitWebAuthn = true;
				x = owner.x;
				y = owner.y;
			}
		}
		const [accountAddress, factoryAddress, factoryData] =
			SafeAccountV0_2_0.createAccountAddressAndFactoryAddressAndData(
				owners,
				overrides,
				overrides.safe4337ModuleAddress ?? SafeAccountV0_2_0.DEFAULT_SAFE_4337_MODULE_ADDRESS,
				overrides.safeModuleSetupAddress ?? SafeAccountV0_2_0.DEFAULT_SAFE_MODULE_SETUP_ADDRESS,
			);

		const safe = new SafeAccountV0_2_0(accountAddress, {
			safe4337ModuleAddress: overrides.safe4337ModuleAddress,
			entrypointAddress: overrides.entrypointAddress,
			onChainIdentifierParams: overrides.onChainIdentifierParams,
			onChainIdentifier: overrides.onChainIdentifier,
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
		useroperation: UserOperationV6,
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
			overrides.entrypointAddress ?? SafeAccountV0_2_0.DEFAULT_ENTRYPOINT_ADDRESS;
		const safe4337ModuleAddress =
			overrides.safe4337ModuleAddress ?? SafeAccountV0_2_0.DEFAULT_SAFE_4337_MODULE_ADDRESS;

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
		useroperation: UserOperationV6,
		chainId: bigint,
		overrides: {
			validAfter?: bigint;
			validUntil?: bigint;
			entrypointAddress?: string;
			safe4337ModuleAddress?: string;
		} = {},
	): {
		domain: SafeUserOperationTypedDataDomain;
		types: Record<string, { name: string; type: string }[]>;
		messageValue: SafeUserOperationV6TypedMessageValue;
	} {
		const validAfter = overrides.validAfter ?? 0n;
		const validUntil = overrides.validUntil ?? 0n;
		const entrypointAddress =
			overrides.entrypointAddress ?? SafeAccountV0_2_0.DEFAULT_ENTRYPOINT_ADDRESS;
		const safe4337ModuleAddress =
			overrides.safe4337ModuleAddress ?? SafeAccountV0_2_0.DEFAULT_SAFE_4337_MODULE_ADDRESS;

		return SafeAccount.getUserOperationEip712Data(useroperation, chainId, {
			validAfter,
			validUntil,
			entrypointAddress,
			safe4337ModuleAddress,
		});
	}

	/**
	 * Calculate both the counterfactual account address and the initCode from owner signers.
	 *
	 * @param owners - Array of owner signers
	 * @param overrides - Override default initialization values
	 * @returns A tuple of [accountAddress, initCode]
	 */
	public static createAccountAddressAndInitCode(
		owners: Signer[],
		overrides: InitCodeOverrides = {},
	): [string, string] {
		const [sender, safeAccountFactoryAddress, factoryData] =
			SafeAccount.createAccountAddressAndFactoryAddressAndData(
				owners,
				overrides,
				overrides.safe4337ModuleAddress ?? SafeAccountV0_2_0.DEFAULT_SAFE_4337_MODULE_ADDRESS,
				overrides.safeModuleSetupAddress ?? SafeAccountV0_2_0.DEFAULT_SAFE_MODULE_SETUP_ADDRESS,
			);

		const initCode = safeAccountFactoryAddress + factoryData.slice(2);
		return [sender, initCode];
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
			overrides.safe4337ModuleAddress ?? SafeAccountV0_2_0.DEFAULT_SAFE_4337_MODULE_ADDRESS;
		const safeModuleSetupAddress =
			overrides.safeModuleSetupAddress ?? SafeAccountV0_2_0.DEFAULT_SAFE_MODULE_SETUP_ADDRESS;

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
	 * Create the initCode for deploying a new Safe account via the factory.
	 *
	 * @param owners - Array of owner signers
	 * @param overrides - Override default initialization values
	 * @returns The initCode string (factory address + encoded calldata)
	 */
	public static createInitCode(owners: Signer[], overrides: InitCodeOverrides = {}): string {
		const [safeAccountFactoryAddress, factoryData] = SafeAccount.createFactoryAddressAndData(
			owners,
			overrides,
			overrides.safe4337ModuleAddress ?? SafeAccountV0_2_0.DEFAULT_SAFE_4337_MODULE_ADDRESS,
			overrides.safeModuleSetupAddress ?? SafeAccountV0_2_0.DEFAULT_SAFE_MODULE_SETUP_ADDRESS,
		);
		return safeAccountFactoryAddress + factoryData.slice(2);
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
	 * @returns The unsigned UserOperation (UserOperationV6) ready to be signed
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
		overrides: CreateUserOperationV6Overrides = {},
	): Promise<UserOperationV6> {
		const [userOperation, factoryAddress, factoryData] =
			await this.createBaseUserOperationAndFactoryAddressAndFactoryData(
				transactions,
				true,
				providerRpc,
				bundlerRpc,
				overrides,
			);

		let initCode = "0x";

		if (overrides.initCode == null) {
			if (factoryAddress != null) {
				let factoryDataStr = "0x";
				if (factoryData != null) {
					factoryDataStr = factoryData;
				}
				initCode = factoryAddress + factoryDataStr.slice(2);
			}
		} else {
			initCode = overrides.initCode;
		}

		const userOperationV6: UserOperationV6 = {
			...userOperation,
			initCode,
			paymasterAndData: "0x",
		};

		return userOperationV6;
	}

	/**
	 * Create MetaTransactions to migrate this account from EntryPoint v0.6 (module v0.2.0)
	 * to EntryPoint v0.7 (module v0.3.0).
	 *
	 * @param nodeRpcUrl - Ethereum JSON-RPC node URL
	 * @param overrides - Override module addresses and pagination
	 * @returns Array of MetaTransactions for the migration
	 */
	public async createMigrateToSafeAccountV0_3_0MetaTransactions(
		nodeRpcUrl: string,
		overrides: {
			safeV06ModuleAddress?: string;
			safeV07ModuleAddress?: string;
			pageSize?: bigint;
			modulesStart?: string;
		} = {},
	): Promise<MetaTransaction[]> {
		const moduleV06Address =
			overrides.safeV06ModuleAddress ?? SafeAccountV0_2_0.DEFAULT_SAFE_4337_MODULE_ADDRESS;

		const moduleV07Address =
			overrides.safeV07ModuleAddress ?? SafeAccountV0_3_0.DEFAULT_SAFE_4337_MODULE_ADDRESS;

		const disableModuleMetaTransaction = await this.createDisableModuleMetaTransaction(
			nodeRpcUrl,
			moduleV06Address,
			this.accountAddress,
			{
				prevModuleAddress: overrides.safeV06ModuleAddress,
				modulesPageSize: overrides.pageSize,
				modulesStart: overrides.modulesStart,
			},
		);

		const enableModuleMetaTransaction = SafeAccount.createEnableModuleMetaTransaction(
			moduleV07Address,
			this.accountAddress,
		);

		const setFallbackHandlerCallData = createCallData(
			"0xf08a0323", //setFallbackHandler(address)
			["address"],
			[moduleV07Address],
		);
		const setFallbackHandlerMetaTransaction: MetaTransaction = {
			to: this.accountAddress,
			value: 0n,
			data: setFallbackHandlerCallData,
		};

		return [
			disableModuleMetaTransaction,
			enableModuleMetaTransaction,
			setFallbackHandlerMetaTransaction,
		];
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
		userOperation: UserOperationV6,
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
		return this.baseEstimateUserOperationGas(userOperation, bundlerRpc, overrides);
	}

	/**
	 * Sign a UserOperation using one or more private keys via EIP-712 typed data signing.
	 *
	 * @param useroperation - The UserOperation to sign
	 * @param privateKeys - Array of private keys for the signers
	 * @param chainId - The target chain ID
	 * @param options - {@link SafeSignatureOptions} — timing, multi-chain encoding, module address
	 * @returns The formatted signature string ready to set on the UserOperation
	 *
	 * @example
	 * const signature = smartAccount.signUserOperation(userOp, [privateKey], 1n);
	 * userOp.signature = signature;
	 */
	public signUserOperation(
		useroperation: UserOperationV6,
		privateKeys: string[],
		chainId: bigint,
		options: SafeSignatureOptions = {},
	): string {
		return SafeAccount.baseSignSingleUserOperation(
			useroperation,
			privateKeys,
			chainId,
			this.entrypointAddress,
			this.safe4337ModuleAddress,
			options,
		);
	}

	/**
	 * Sign a UserOperation using one or more {@link AkSigner} instances.
	 * See {@link SafeAccountV0_3_0.signUserOperationWithSigners} for full
	 * design rationale and examples.
	 *
	 * @param useroperation - The UserOperation to sign
	 * @param signers - one ExternalSigner per owner (any order)
	 * @param chainId - The target chain ID
	 * @param options - {@link SafeSignatureOptions} — timing, multi-chain encoding, module address
	 * @returns Promise resolving to the formatted signature string
	 */
	public signUserOperationWithSigners(
		useroperation: UserOperationV6,
		signers: ReadonlyArray<AkSigner>,
		chainId: bigint,
		options: SafeSignatureOptions = {},
	): Promise<string> {
		const context: SignContext<UserOperationV6> = {
			userOperation: useroperation,
			chainId,
			entryPoint: this.entrypointAddress,
		};
		return SafeAccount.baseSignUserOperationWithSigners(useroperation, signers, chainId, {
			entrypointAddress: this.entrypointAddress,
			safe4337ModuleAddress: this.safe4337ModuleAddress,
			context,
			options,
		});
	}
}
