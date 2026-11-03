import { Safe_L2_V1_5_0 } from "src/constants";
import type { OnChainIdentifierParamsType } from "src/types";
import { SafeAccount } from "./SafeAccount";
import { SafeMultiChainSigAccountV1 } from "./SafeMultiChainSigAccount";
import type { InitCodeOverrides, SafeAccountSingleton, Signer } from "./types";

/**
 * Safe v1.5.0 account on EntryPoint v0.9.
 *
 * Extends {@link SafeMultiChainSigAccountV1}, so it runs the Safe 4337
 * multi-chain signature module on EntryPoint v0.9 and uses the Safe Passkey
 * module v0.2.1 WebAuthn contracts (shared signer, signer factory, RIP-7951
 * precompile with the Daimo P-256 verifier as fallback). The only difference
 * is the Safe singleton: new accounts deploy the Safe L2 v1.5.0 singleton
 * instead of v1.4.1, which changes their counterfactual address.
 *
 * Single-chain use is the common case; the multi-chain signing methods are
 * inherited and optional.
 *
 * @example
 * // Create a new account using the Safe v1.5.0 singleton
 * const smartAccount = SafeAccountV0_4_0.initializeNewAccount([ownerAddress]);
 *
 * // Or connect to an existing deployed account
 * const smartAccount = new SafeAccountV0_4_0(existingAccountAddress);
 */
export class SafeAccountV0_4_0 extends SafeMultiChainSigAccountV1 {
	/**
	 * Create a SafeAccountV0_4_0 instance for an existing deployed account.
	 * For new (undeployed) accounts, use the static `initializeNewAccount` method instead.
	 *
	 * @param accountAddress - The on-chain address of the Safe account
	 * @param overrides - Override default module, EntryPoint and singleton addresses
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
			...overrides,
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
		return SafeAccount.createProxyAddress(initializerCallData, {
			...overrides,
			singletonInitHash: overrides.singletonInitHash ?? Safe_L2_V1_5_0.singletonInitHash,
		});
	}

	/**
	 * Create and initialize a new SafeAccountV0_4_0 from its initial owners.
	 * The account address is deterministically computed but not yet deployed on-chain.
	 * The first UserOperation sent will deploy it automatically via factory data.
	 *
	 * @param owners - Array of owner signers (at least one required)
	 * @param overrides - Override default initialization values
	 * @returns A SafeAccountV0_4_0 instance with factory data set for deployment
	 *
	 * @example
	 * const smartAccount = SafeAccountV0_4_0.initializeNewAccount(["0xOwnerAddress"]);
	 */
	public static initializeNewAccount<T extends typeof SafeMultiChainSigAccountV1>(
		this: T,
		owners: Signer[],
		overrides: InitCodeOverrides = {},
	): InstanceType<T> {
		// `super` keeps `this` bound to the calling class, so the base
		// factory's `new this(...)` constructs an instance of this class
		// (SafeAccountV0_4_0 or a subclass), not SafeMultiChainSigAccountV1.
		// biome-ignore lint/complexity/noThisInStatic: polymorphic factory dispatch through super
		return super.initializeNewAccount(owners, {
			...overrides,
			safeAccountSingleton: overrides.safeAccountSingleton ?? Safe_L2_V1_5_0,
		}) as InstanceType<T>;
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
		return SafeMultiChainSigAccountV1.createAccountAddress(owners, {
			...overrides,
			safeAccountSingleton: overrides.safeAccountSingleton ?? Safe_L2_V1_5_0,
		});
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
		return SafeMultiChainSigAccountV1.createFactoryAddressAndData(owners, {
			...overrides,
			safeAccountSingleton: overrides.safeAccountSingleton ?? Safe_L2_V1_5_0,
		});
	}
}
