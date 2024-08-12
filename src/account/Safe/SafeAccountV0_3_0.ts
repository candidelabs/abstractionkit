import { SafeAccount } from "./SafeAccount";
import {
	InitCodeOverrides,
	Signer,
    CreateUserOperationV7Overrides,
} from "./types";

import { UserOperationV7, MetaTransaction } from "../../types";
import { ENTRYPOINT_V7 } from "src/constants";

export class SafeAccountV0_3_0 extends SafeAccount {
    static readonly DEFAULT_ENTRYPOINT_ADDRESS = ENTRYPOINT_V7;
	static readonly DEFAULT_SAFE_4337_MODULE_ADDRESS =
		"0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226";
    static readonly DEFAULT_SAFE_MODULE_SETUP_ADDRESS =
		"0x2dd68b007B46fBe91B9A7c3EDa5A7a1063cB5b47";

    constructor(
		accountAddress: string,
		safe4337ModuleAddress: string = SafeAccountV0_3_0.DEFAULT_SAFE_4337_MODULE_ADDRESS,
		entrypointAddress: string = SafeAccountV0_3_0.DEFAULT_ENTRYPOINT_ADDRESS,
	) {
		super(accountAddress, safe4337ModuleAddress, entrypointAddress);
	}
    
    /**
	 * calculate account addressfrom initial owners
	 * @param owners - list of account owners addresses
	 * @param overrides - override values to change the initialization default values
	 * @returns account address
	 */
	public static createAccountAddress(
		owners: Signer[],
		overrides: InitCodeOverrides = {},
	): string {
        const [accountAddress, , ] =
		SafeAccount.createAccountAddressAndFactoryAddressAndData(
            owners,
            overrides, 
            overrides.safe4337ModuleAddress ?? SafeAccountV0_3_0.DEFAULT_SAFE_4337_MODULE_ADDRESS,
            overrides.safeModuleSetupddress ?? SafeAccountV0_3_0.DEFAULT_SAFE_MODULE_SETUP_ADDRESS,
        );

        return accountAddress;
    }

    /**
	 * To create and initialize a SafeAccount object from its
	 * initial owners
	 * @remarks
	 * initializeNewAccount only needed when the smart account
	 * have not been deployed yet and the account address is unknown.
	 * @param owners - list of account owners addresses
	 * @param overrides - override values to change the initialization default values
	 * @returns a SafeAccount object
	 */
	public static initializeNewAccount(
		owners: Signer[],
		overrides: InitCodeOverrides = {},
	): SafeAccountV0_3_0 {
		let isInitWebAuthn = false;
		let x = 0n;
		let y = 0n;
		for(const owner of owners){
			if(typeof(owner) != "string"){
                if (isInitWebAuthn) {
                    throw RangeError(
                        "Only one Webauth signer is allowed during initialization"
                    );
                }
				isInitWebAuthn = true;
				x = owner.x;
				y = owner.y;
			}
		}
        const [accountAddress, factoryAddress, factoryData] =
		SafeAccountV0_3_0.createAccountAddressAndFactoryAddressAndData(
            owners,
            overrides, 
            overrides.safe4337ModuleAddress ?? SafeAccountV0_3_0.DEFAULT_SAFE_4337_MODULE_ADDRESS,
            overrides.safeModuleSetupddress ?? SafeAccountV0_3_0.DEFAULT_SAFE_MODULE_SETUP_ADDRESS,
        );

        const safe = new SafeAccountV0_3_0(
            accountAddress,
            overrides.safe4337ModuleAddress ?? SafeAccountV0_3_0.DEFAULT_SAFE_4337_MODULE_ADDRESS,
            overrides.entrypointAddress ?? SafeAccountV0_3_0.DEFAULT_ENTRYPOINT_ADDRESS,
        );
		safe.factoryAddress = factoryAddress;
		safe.factoryData = factoryData;
        if(isInitWebAuthn){
		    safe.isInitWebAuthn = isInitWebAuthn;
		    safe.x = x;
		    safe.y = y;
        }
		
		return safe;
	}

    public static getUserOperationEip712Hash(
		useroperation: UserOperationV7,
		chainId:bigint,
		validAfter: bigint = 0n,
		validUntil: bigint = 0n,
		entrypointAddress: string = SafeAccountV0_3_0.DEFAULT_ENTRYPOINT_ADDRESS,
        safe4337ModuleAddress: string =
            SafeAccountV0_3_0.DEFAULT_SAFE_4337_MODULE_ADDRESS,
    ): string{
        return SafeAccount.getUserOperationEip712Hash(
            useroperation,
            chainId,
            validAfter,
            validUntil,
            entrypointAddress,
            safe4337ModuleAddress
        )
    }

    
    public static createInitializerCallData(
		owners: Signer[],
		threshold: number,
		safe4337ModuleAddress: string =
            SafeAccountV0_3_0.DEFAULT_SAFE_4337_MODULE_ADDRESS,
		safeModuleSetupddress: string =
            SafeAccountV0_3_0.DEFAULT_SAFE_MODULE_SETUP_ADDRESS,
	): string {
        return SafeAccount.createInitializerCallData(
            owners,
            threshold,
            safe4337ModuleAddress,
            safeModuleSetupddress,
        );
    }
    
    /**
	 * create account factory address and factory data
	 * @param owners - list of account owners addresses
	 * @param overrides - override values to change the initialization default values
	 * @returns factoryAddress and factoryData
	 */
	public static createFactoryAddressAndData(
		owners: Signer[],
		overrides: InitCodeOverrides,
    ): [string, string] {
        return SafeAccount.createFactoryAddressAndData(
            owners,
            overrides,
            overrides.safe4337ModuleAddress ?? SafeAccountV0_3_0.DEFAULT_SAFE_4337_MODULE_ADDRESS,
            overrides.safeModuleSetupddress ?? SafeAccountV0_3_0.DEFAULT_SAFE_MODULE_SETUP_ADDRESS,
        );
    }

    /**
	 * createUserOperation will determine the nonce, fetch the gas prices,
	 * estimate gas limits and return a useroperation to be signed.
	 * you can override all these values using the overrides parameter.
	 * @param transactions - metatransaction list to be encoded
	 * @param providerRpc - node rpc to fetch account nonce and gas prices
	 * @param bundlerRpc - bundler rpc for gas estimation
	 * @param overrides - overrides values to change default values
	 * @returns promise with useroperation
	 */
	public async createUserOperation(
		transactions: MetaTransaction[],
		providerRpc?: string,
		bundlerRpc?: string,
		overrides: CreateUserOperationV7Overrides = {},
	): Promise<UserOperationV7> {
        let [
            userOperation,
            factoryAddress,
            factoryData
        ] = await this.createBaseUserOperationAndFactoryAddressAndFactoryData(
            transactions,
            false,
            providerRpc,
            bundlerRpc,
            overrides
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
}
