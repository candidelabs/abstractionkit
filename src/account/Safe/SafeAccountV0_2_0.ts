import { SafeAccount } from "./SafeAccount";
import {
	InitCodeOverrides,
	Signer,
	CreateUserOperationV6Overrides,
	SafeAccountSingleton,
    SafeUserOperationTypedDataDomain,
    SafeUserOperationV6TypedMessageValue,
} from "./types";

import { UserOperationV6, MetaTransaction } from "../../types";
import { ENTRYPOINT_V6 } from "src/constants";
import { createCallData } from "src/utils";
import { SafeAccountV0_3_0 } from "./SafeAccountV0_3_0";

export class SafeAccountV0_2_0 extends SafeAccount {
	static readonly DEFAULT_ENTRYPOINT_ADDRESS = ENTRYPOINT_V6;
	static readonly DEFAULT_SAFE_4337_MODULE_ADDRESS =
		"0xa581c4A4DB7175302464fF3C06380BC3270b4037";
	static readonly DEFAULT_SAFE_MODULE_SETUP_ADDRESS =
		"0x8EcD4ec46D4D2a6B64fE960B3D64e8B94B2234eb";

	constructor(
		accountAddress: string,
		overrides: {
			safe4337ModuleAddress?: string;
			entrypointAddress?: string;
		} = {},
	) {
		const safe4337ModuleAddress =
			overrides.safe4337ModuleAddress ??
			SafeAccountV0_2_0.DEFAULT_SAFE_4337_MODULE_ADDRESS;
		const entrypointAddress =
			overrides.entrypointAddress ??
			SafeAccountV0_2_0.DEFAULT_ENTRYPOINT_ADDRESS;

		super(accountAddress, safe4337ModuleAddress, entrypointAddress);
	}

	/**
	 * calculate account address from initial owners
	 * @param owners - list of account owners signers
	 * @param overrides - override values to change the initialization default values
	 * @returns account address
	 */
	public static createAccountAddress(
		owners: Signer[],
		overrides: {
			threshold?: number;
			c2Nonce?: bigint;
			safe4337ModuleAddress?: string;
			safeModuleSetupddress?: string;
			safeAccountSingleton?: SafeAccountSingleton;
			safeAccountFactoryAddress?: string;
			multisendContractAddress?: string;
			webAuthnSharedSigner?: string;
			eip7212WebAuthnPrecompileVerifierForSharedSigner?: string;
			eip7212WebAuthnContractVerifierForSharedSigner?: string;
		} = {},
	): string {
		const [accountAddress, ,] =
			SafeAccount.createAccountAddressAndFactoryAddressAndData(
				owners,
				overrides,
				overrides.safe4337ModuleAddress ??
					SafeAccountV0_2_0.DEFAULT_SAFE_4337_MODULE_ADDRESS,
				overrides.safeModuleSetupddress ??
					SafeAccountV0_2_0.DEFAULT_SAFE_MODULE_SETUP_ADDRESS,
			);

		return accountAddress;
	}

	/**
	 * To create and initialize a SafeAccount object from its
	 * initial owners
	 * @remarks
	 * initializeNewAccount only needed when the smart account
	 * have not been deployed yet and the account address is unknown.
	 * @param owners - list of account owners signers
	 * @param overrides - override values to change the initialization default values
	 * @returns a SafeAccount object
	 */
	public static initializeNewAccount(
		owners: Signer[],
		overrides: InitCodeOverrides = {},
	): SafeAccountV0_2_0 {
		let isInitWebAuthn = false;
		let x = 0n;
		let y = 0n;
		for (const owner of owners) {
			if (typeof owner != "string") {
				if (isInitWebAuthn) {
					throw RangeError(
						"Only one Webauthn signer is allowed during initialization",
					);
				}
                if(owners.indexOf(owner) != 0){
                    throw RangeError(
						"Webauthn owner has to be the first owner for an init transaction.",
					);
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
				overrides.safe4337ModuleAddress ??
					SafeAccountV0_2_0.DEFAULT_SAFE_4337_MODULE_ADDRESS,
				overrides.safeModuleSetupddress ??
					SafeAccountV0_2_0.DEFAULT_SAFE_MODULE_SETUP_ADDRESS,
			);

		const safe = new SafeAccountV0_2_0(accountAddress, {
			safe4337ModuleAddress: overrides.safe4337ModuleAddress,
			entrypointAddress: overrides.entrypointAddress,
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
	 * create a useroperation eip712 hash
	 * @param useroperation - useroperation to hash
	 * @param chainId - target chain id
	 * @param overrides - overrides for the default values
	 * @param overrides.validAfter - timestamp the signature will be valid after
	 * @param overrides.validUntil - timestamp the signature will be valid until
	 * @param overrides.entrypoint - target entrypoint
	 * defaults to ENTRYPOINT_V6
	 * @param overrides.safe4337ModuleAddress - defaults to DEFAULT_SAFE_4337_MODULE_ADDRESS
	 * @returns useroperation hash
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
			overrides.entrypointAddress ??
			SafeAccountV0_2_0.DEFAULT_ENTRYPOINT_ADDRESS;
		const safe4337ModuleAddress =
			overrides.safe4337ModuleAddress ??
			SafeAccountV0_2_0.DEFAULT_SAFE_4337_MODULE_ADDRESS;

		return SafeAccount.getUserOperationEip712Hash(useroperation, chainId, {
			validAfter,
			validUntil,
			entrypointAddress,
			safe4337ModuleAddress,
		});
	}

    /**
	 * create a useroperation eip712 data
	 * @param useroperation - useroperation to hash
	 * @param chainId - target chain id
	 * @param overrides - overrides for the default values
	 * @param overrides.validAfter - timestamp the signature will be valid after
	 * @param overrides.validUntil - timestamp the signature will be valid until
	 * @param overrides.entrypoint - target entrypoint
	 * @param overrides.safe4337ModuleAddress - target module address 
	 * @returns an object containing the typed data domain, type and typed data vales
     * object needed for hashing and signing
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
        domain: SafeUserOperationTypedDataDomain,
        types:Record<string, {name: string;type: string;}[]>,
        messageValue: SafeUserOperationV6TypedMessageValue
    } 
     {
		const validAfter = overrides.validAfter ?? 0n;
		const validUntil = overrides.validUntil ?? 0n;
		const entrypointAddress =
			overrides.entrypointAddress ??
			SafeAccountV0_2_0.DEFAULT_ENTRYPOINT_ADDRESS;
		const safe4337ModuleAddress =
			overrides.safe4337ModuleAddress ??
			SafeAccountV0_2_0.DEFAULT_SAFE_4337_MODULE_ADDRESS;

		return SafeAccount.getUserOperationEip712Data(useroperation, chainId, {
			validAfter,
			validUntil,
			entrypointAddress,
			safe4337ModuleAddress,
		});
	}

	/**
	 * calculate account address and initcode from owners
	 * @param owners - list of account owners signers
	 * @param overrides - override values to change the initialization default values
	 * @returns account address and initcode
	 */
	public static createAccountAddressAndInitCode(
		owners: Signer[],
		overrides: InitCodeOverrides = {},
	): [string, string] {
		const [sender, safeAccountFactoryAddress, factoryData] =
			SafeAccount.createAccountAddressAndFactoryAddressAndData(
				owners,
				overrides,
				overrides.safe4337ModuleAddress ??
					SafeAccountV0_2_0.DEFAULT_SAFE_4337_MODULE_ADDRESS,
				overrides.safeModuleSetupddress ??
					SafeAccountV0_2_0.DEFAULT_SAFE_MODULE_SETUP_ADDRESS,
			);

		const initCode = safeAccountFactoryAddress + factoryData.slice(2);
		return [sender, initCode];
	}

	public static createInitializerCallData(
		owners: Signer[],
		threshold: number,
		overrides: {
			safe4337ModuleAddress?: string;
			safeModuleSetupddress?: string;
			multisendContractAddress?: string;
			webAuthnSharedSigner?: string;
			eip7212WebAuthnPrecompileVerifierForSharedSigner?: string;
			eip7212WebAuthnContractVerifierForSharedSigner?: string;
		} = {},
	): string {
		const safe4337ModuleAddress =
			overrides.safe4337ModuleAddress ??
			SafeAccountV0_2_0.DEFAULT_SAFE_4337_MODULE_ADDRESS;
		const safeModuleSetupddress =
			overrides.safeModuleSetupddress ??
			SafeAccountV0_2_0.DEFAULT_SAFE_MODULE_SETUP_ADDRESS;

		return SafeAccount.createBaseInitializerCallData(
			owners,
			threshold,
			safe4337ModuleAddress,
			safeModuleSetupddress,
			overrides.multisendContractAddress,
			overrides.webAuthnSharedSigner,
			overrides.eip7212WebAuthnPrecompileVerifierForSharedSigner,
			overrides.eip7212WebAuthnContractVerifierForSharedSigner,
		);
	}

	/**
	 * create account initcode
	 * @param owners - list of account owners addresses
	 * @param overrides - overrides for the default values
	 * @returns initcode
	 */
	public static createInitCode(
		owners: Signer[],
		overrides: InitCodeOverrides = {},
	): string {
		const [safeAccountFactoryAddress, factoryData] =
			SafeAccount.createFactoryAddressAndData(
				owners,
				overrides,
				overrides.safe4337ModuleAddress ??
					SafeAccountV0_2_0.DEFAULT_SAFE_4337_MODULE_ADDRESS,
				overrides.safeModuleSetupddress ??
					SafeAccountV0_2_0.DEFAULT_SAFE_MODULE_SETUP_ADDRESS,
			);
		return safeAccountFactoryAddress + factoryData.slice(2);
	}

	/**
	 * createUserOperation will determine the nonce, fetch the gas prices,
	 * estimate gas limits and return a useroperation to be signed.
	 * you can override all these values using the overrides parameter.
	 * @param transactions - metatransaction list to be encoded
	 * @param providerRpc - node rpc to fetch account nonce and gas prices
	 * @param bundlerRpc - bundler rpc for gas estimation
	 * @param overrides - overrides for the default values
	 * @returns promise with useroperation
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
	 * create a list of metatransactions to migrateaccount from entrypoint v0.06
     * (module version 0.2.0) to entrypoint v0.07 (module version 0.3.0)
	 * @param nodeRpcUrl - The JSON-RPC API url for the target chain
	 * @param overrides - overrides for the default values
     * @returns a promise of a list of MetaTransactions
	 */
    public async createMigrateToSafeAccountV0_3_0MetaTransactions(
		nodeRpcUrl: string,
        overrides:{
			safeV06ModuleAddress?: string;
			safeV07ModuleAddress?: string;
            safeV06PrevModuleAddress?: string;
            pageSize?: bigint;
			modulesStart?: string;
        } = {}
    ):Promise<MetaTransaction[]> {
		const moduleV06Address =
			overrides.safeV06ModuleAddress ??
			SafeAccountV0_2_0.DEFAULT_SAFE_4337_MODULE_ADDRESS;

		const moduleV07Address =
			overrides.safeV07ModuleAddress ??
            SafeAccountV0_3_0.DEFAULT_SAFE_4337_MODULE_ADDRESS;
        
        const disableModuleMetaTransaction = 
            await this.createDisableModuleMetaTransaction(
                nodeRpcUrl, moduleV06Address, this.accountAddress,
                {
                    prevModuleAddress:overrides.safeV06ModuleAddress,
                    modulesPageSize: overrides.pageSize,
                    modulesStart: overrides.modulesStart
                }
            );
        
        const enableModuleMetaTransaction = 
            SafeAccount.createEnableModuleMetaTransaction(
                moduleV07Address, this.accountAddress);

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
            setFallbackHandlerMetaTransaction
        ];
    }
}
