import { OnChainIdentifierParamsType } from "src/types";
import { SafeAccountV0_3_0 } from "./SafeAccountV0_3_0";
import { Signer, InitCodeOverrides } from "./types";
import { Safe_L2_V1_5_0 } from "src/constants";

export class SafeAccountV1_5_0_M_0_3_0 extends SafeAccountV0_3_0 {
	constructor(
		accountAddress: string,
		overrides: {
			safe4337ModuleAddress?: string;
			entrypointAddress?: string;
            onChainIdentifierParams?: OnChainIdentifierParamsType;
            onChainIdentifier?: string
		} = {},
	) {
        super(
            accountAddress,
            {
                onChainIdentifierParams: overrides.onChainIdentifierParams,
                onChainIdentifier: overrides.onChainIdentifier,
                safeAccountSingleton: Safe_L2_V1_5_0
            }
        );
	}

	public static createProxyAddress(
		initializerCallData: string,
		overrides: {
			c2Nonce?: bigint;
			safeFactoryAddress?: string;
			singletonInitHash?: string;
		} = {},
	): string {
        const modOverrides = overrides;
        modOverrides.singletonInitHash =
            overrides.singletonInitHash??Safe_L2_V1_5_0.singletonInitHash;
        return SafeAccountV0_3_0.createProxyAddress(
            initializerCallData,
            modOverrides
        );
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
	): SafeAccountV1_5_0_M_0_3_0 {
        const modOverrides = overrides;
        modOverrides.safeAccountSingleton =
            overrides.safeAccountSingleton??Safe_L2_V1_5_0;
        return SafeAccountV0_3_0.initializeNewAccount(
            owners,
            overrides
        );
    }

	/**
	 * calculate account addressfrom initial owners signers
	 * @param owners - list of account owners addresses
	 * @param overrides - override values to change the initialization default values
	 * @returns account address
	 */
	public static createAccountAddress(
		owners: Signer[],
		overrides: InitCodeOverrides = {},
	): string {
        const modOverrides = overrides;
        modOverrides.safeAccountSingleton =
            overrides.safeAccountSingleton??Safe_L2_V1_5_0;
        return SafeAccountV0_3_0.createAccountAddress(
            owners,
            modOverrides
        );
    }

	/**
	 * create account factory address and factory data
	 * @param owners - list of account owners signers
	 * @param overrides - override values to change the initialization default values
	 * @returns factoryAddress and factoryData
	 */
	public static createFactoryAddressAndData(
		owners: Signer[],
		overrides: InitCodeOverrides = {},
	): [string, string] {
     const modOverrides = overrides;
        modOverrides.safeAccountSingleton =
            overrides.safeAccountSingleton??Safe_L2_V1_5_0;
        return SafeAccountV0_3_0.createFactoryAddressAndData(
            owners,
            overrides
        );
    }
}
