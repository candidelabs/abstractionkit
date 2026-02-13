import { OnChainIdentifierParamsType } from "src/types";
import { SafeAccountV0_3_0 } from "./SafeAccountV0_3_0";
import { Signer, InitCodeOverrides } from "./types";
import { Safe_L2_V1_5_0 } from "src/constants";

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
        const modOverrides = overrides;
        modOverrides.singletonInitHash =
            overrides.singletonInitHash??Safe_L2_V1_5_0.singletonInitHash;
        return SafeAccountV0_3_0.createProxyAddress(
            initializerCallData,
            modOverrides
        );
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
        const modOverrides = overrides;
        modOverrides.safeAccountSingleton =
            overrides.safeAccountSingleton??Safe_L2_V1_5_0;
        return SafeAccountV0_3_0.initializeNewAccount(
            owners,
            overrides
        );
    }

	/**
	 * Calculate the counterfactual account address from the initial owner signers.
	 * Does not deploy the account. Uses the Safe v1.5.0 singleton by default.
	 *
	 * @param owners - Array of owner signers (ECDSA addresses or WebAuthn public keys)
	 * @param overrides - Override default initialization values
	 * @returns The deterministic account address
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
     const modOverrides = overrides;
        modOverrides.safeAccountSingleton =
            overrides.safeAccountSingleton??Safe_L2_V1_5_0;
        return SafeAccountV0_3_0.createFactoryAddressAndData(
            owners,
            overrides
        );
    }
}
