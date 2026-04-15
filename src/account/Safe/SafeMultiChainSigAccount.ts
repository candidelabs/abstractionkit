import { SafeAccount } from "./SafeAccount";
import {
	InitCodeOverrides,
	Signer,
	CreateUserOperationV9Overrides,
    SafeUserOperationTypedDataDomain,
    SafeUserOperationV9TypedMessageValue,
    SafeAccountSingleton,
    UserOperationToSign,
    MultiChainSignatureMerkleTreeRootTypedDataDomain,
    MultiChainSignatureMerkleTreeRootTypedMessageValue,
    SignerSignaturePair,
    WebAuthnSignatureOverrides,
    WebauthnPublicKey,
    UserOperationToSignWithOverrides,
} from "./types";

import { UserOperationV9, MetaTransaction, OnChainIdentifierParamsType } from "../../types";
import { EIP712_MULTI_CHAIN_OPERATIONS_TYPE, ENTRYPOINT_V9 } from "src/constants";
import { generateMerkleProofs } from "./MerkleTree";
import { TypedDataEncoder, Wallet } from "ethers";
import {
	DEFAULT_WEB_AUTHN_DAIMO_VERIFIER_V_0_2_1,
	DEFAULT_WEB_AUTHN_PRECOMPILE_RIP_7951,
	DEFAULT_WEB_AUTHN_SHARED_SIGNER_V_0_2_1,
	DEFAULT_WEB_AUTHN_SIGNER_SINGLETON_V_0_2_1,
	DEFAULT_WEB_AUTHN_SIGNER_FACTORY_V_0_2_1,
	DEFAULT_WEB_AUTHN_SIGNER_PROXY_CREATION_CODE_V_0_2_1,
} from "./constants";

/**
 * @class
 * Safe account variant that supports multi-chain signatures via Merkle trees.
 * Allows signing UserOperations for multiple chains with a single signature,
 * using EntryPoint v0.9 and EIP-712 typed data with Merkle proofs.
 *
 * Uses Safe Passkey module v0.2.1 WebAuthn verifiers by default,
 * with the Daimo P256 verifier instead of the FCL P256 verifier
 * used by the base SafeAccount class.
 * @see {@link https://github.com/safe-fndn/safe-modules/blob/04e65efbce634e776cc8c1fbe90061f09e09a71b/modules/passkey/CHANGELOG.md?plain=1#L23}
 */
export class SafeMultiChainSigAccountV1 extends SafeAccount {
	static readonly DEFAULT_ENTRYPOINT_ADDRESS = ENTRYPOINT_V9;
	static readonly DEFAULT_SAFE_4337_MODULE_ADDRESS =
        "0x22939E839e3c0F479B713eAF95e0df128554AEAd";
	static readonly DEFAULT_SAFE_MODULE_SETUP_ADDRESS =
		"0x2dd68b007B46fBe91B9A7c3EDa5A7a1063cB5b47";

	// Safe Passkey module v0.2.1 WebAuthn verifier defaults
	static readonly DEFAULT_WEB_AUTHN_SHARED_SIGNER: string = DEFAULT_WEB_AUTHN_SHARED_SIGNER_V_0_2_1;
	static readonly DEFAULT_WEB_AUTHN_SIGNER_SINGLETON: string = DEFAULT_WEB_AUTHN_SIGNER_SINGLETON_V_0_2_1;
	static readonly DEFAULT_WEB_AUTHN_SIGNER_FACTORY: string = DEFAULT_WEB_AUTHN_SIGNER_FACTORY_V_0_2_1;
	static readonly DEFAULT_WEB_AUTHN_SIGNER_PROXY_CREATION_CODE = DEFAULT_WEB_AUTHN_SIGNER_PROXY_CREATION_CODE_V_0_2_1;
	static readonly DEFAULT_WEB_AUTHN_PRECOMPILE: string = DEFAULT_WEB_AUTHN_PRECOMPILE_RIP_7951;
	static readonly DEFAULT_WEB_AUTHN_DAIMO_VERIFIER: string = DEFAULT_WEB_AUTHN_DAIMO_VERIFIER_V_0_2_1;

	/**
	 * Create a SafeMultiChainSigAccount instance for an existing or new account.
	 * @param accountAddress - the Safe account address
	 * @param overrides - optional overrides for module, entrypoint, and singleton addresses
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
			SafeMultiChainSigAccountV1.DEFAULT_SAFE_4337_MODULE_ADDRESS;
		const entrypointAddress =
			overrides.entrypointAddress ??
			SafeMultiChainSigAccountV1.DEFAULT_ENTRYPOINT_ADDRESS;
    
        super(
            accountAddress, safe4337ModuleAddress, entrypointAddress,
            {
                onChainIdentifierParams: overrides.onChainIdentifierParams,
                onChainIdentifier: overrides.onChainIdentifier,
                safeAccountSingleton: overrides.safeAccountSingleton,
            }
        );
	}

	/**
	 * calculate account address from initial owners signers
	 * @param owners - list of account owners addresses
	 * @param overrides - override values to change the initialization default values
	 * @returns account address
	 */
	public static createAccountAddress(
		owners: Signer[],
		overrides: InitCodeOverrides = {},
	): string {
       // webAuthnSignerFactory, webAuthnSignerSingleton, and webAuthnSignerProxyCreationCode
       // are not defaulted here — the init code path only configures the shared signer
       // and its verifier. Deploying the deterministic verifier proxy and swapping it
       // for the shared signer happens later in createUserOperation (nonce == 0),
       // which defaults those fields.
       const modOverrides = { ...overrides,
			webAuthnSharedSigner: overrides.webAuthnSharedSigner??SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_SHARED_SIGNER,
			eip7212WebAuthnPrecompileVerifierForSharedSigner: overrides.eip7212WebAuthnPrecompileVerifierForSharedSigner??SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_PRECOMPILE,
			eip7212WebAuthnContractVerifierForSharedSigner: overrides.eip7212WebAuthnContractVerifierForSharedSigner??SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_DAIMO_VERIFIER,
       };
		const [accountAddress, ,] =
			SafeAccount.createAccountAddressAndFactoryAddressAndData(
				owners,
				modOverrides,
				overrides.safe4337ModuleAddress ??
					SafeMultiChainSigAccountV1.DEFAULT_SAFE_4337_MODULE_ADDRESS,
				overrides.safeModuleSetupAddress ??
					SafeMultiChainSigAccountV1.DEFAULT_SAFE_MODULE_SETUP_ADDRESS,
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
	): SafeMultiChainSigAccountV1 {
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
        // webAuthnSignerFactory, webAuthnSignerSingleton, and webAuthnSignerProxyCreationCode
        // are not defaulted here — the init code path only configures the shared signer
        // and its verifier. Deploying the deterministic verifier proxy and swapping it
        // for the shared signer happens later in createUserOperation (nonce == 0),
        // which defaults those fields.
        const modOverrides = { ...overrides,
			webAuthnSharedSigner: overrides.webAuthnSharedSigner??SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_SHARED_SIGNER,
			eip7212WebAuthnPrecompileVerifierForSharedSigner: overrides.eip7212WebAuthnPrecompileVerifierForSharedSigner??SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_PRECOMPILE,
			eip7212WebAuthnContractVerifierForSharedSigner: overrides.eip7212WebAuthnContractVerifierForSharedSigner??SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_DAIMO_VERIFIER,
        };
		const [accountAddress, factoryAddress, factoryData] =
			SafeAccount.createAccountAddressAndFactoryAddressAndData(
				owners,
				modOverrides,
				overrides.safe4337ModuleAddress ??
					SafeMultiChainSigAccountV1.DEFAULT_SAFE_4337_MODULE_ADDRESS,
				overrides.safeModuleSetupAddress ??
					SafeMultiChainSigAccountV1.DEFAULT_SAFE_MODULE_SETUP_ADDRESS,
			);

		const safe = new SafeMultiChainSigAccountV1(accountAddress, {
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
	 * create a useroperation eip712 hash
	 * @param useroperation - useroperation to hash
	 * @param chainId - target chain id
	 * @param overrides - overrides for the default values
	 * @param overrides.validAfter - timestamp the signature will be valid after
	 * @param overrides.validUntil - timestamp the signature will be valid until
	 * @param overrides.entrypoint - target entrypoint
	 * defaults to ENTRYPOINT_V9
	 * @param overrides.safe4337ModuleAddress - defaults to DEFAULT_SAFE_4337_MODULE_ADDRESS
	 * @returns useroperation hash
	 */
	public static getUserOperationEip712Hash(
		useroperation: UserOperationV9,
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
			SafeMultiChainSigAccountV1.DEFAULT_ENTRYPOINT_ADDRESS;
		const safe4337ModuleAddress =
			overrides.safe4337ModuleAddress ??
			SafeMultiChainSigAccountV1.DEFAULT_SAFE_4337_MODULE_ADDRESS;

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
		useroperation: UserOperationV9,
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
        messageValue: SafeUserOperationV9TypedMessageValue
    } 
     {
		const validAfter = overrides.validAfter ?? 0n;
		const validUntil = overrides.validUntil ?? 0n;
		const entrypointAddress =
			overrides.entrypointAddress ??
			SafeMultiChainSigAccountV1.DEFAULT_ENTRYPOINT_ADDRESS;
		const safe4337ModuleAddress =
			overrides.safe4337ModuleAddress ??
			SafeMultiChainSigAccountV1.DEFAULT_SAFE_4337_MODULE_ADDRESS;

		return SafeAccount.getUserOperationEip712Data(useroperation, chainId, {
			validAfter,
			validUntil,
			entrypointAddress,
			safe4337ModuleAddress,
		});
	}

	/**
	 * Create the initializer callData for setting up a new Safe account.
	 * @param owners - list of account owner signers
	 * @param threshold - number of required signatures for execution
	 * @param overrides - optional overrides for module and contract addresses
	 * @returns hex-encoded initializer callData
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
			SafeMultiChainSigAccountV1.DEFAULT_SAFE_4337_MODULE_ADDRESS;
		const safeModuleSetupAddress =
			overrides.safeModuleSetupAddress ??
			SafeMultiChainSigAccountV1.DEFAULT_SAFE_MODULE_SETUP_ADDRESS;

		return SafeAccount.createBaseInitializerCallData(
			owners,
			threshold,
			safe4337ModuleAddress,
			safeModuleSetupAddress,
			overrides.multisendContractAddress,
			overrides.webAuthnSharedSigner ??
				SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_SHARED_SIGNER,
			overrides.eip7212WebAuthnPrecompileVerifierForSharedSigner ??
				SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_PRECOMPILE,
			overrides.eip7212WebAuthnContractVerifierForSharedSigner ??
				SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_DAIMO_VERIFIER,
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
     	// webAuthnSignerFactory, webAuthnSignerSingleton, and webAuthnSignerProxyCreationCode
		// are not defaulted here — the init code path only configures the shared signer
		// and its verifier. Deploying the deterministic verifier proxy and swapping it
		// for the shared signer happens later in createUserOperation (nonce == 0),
		// which defaults those fields.
		const modOverrides = { ...overrides,
			webAuthnSharedSigner: overrides.webAuthnSharedSigner??SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_SHARED_SIGNER,
			eip7212WebAuthnPrecompileVerifierForSharedSigner: overrides.eip7212WebAuthnPrecompileVerifierForSharedSigner??SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_PRECOMPILE,
			eip7212WebAuthnContractVerifierForSharedSigner: overrides.eip7212WebAuthnContractVerifierForSharedSigner??SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_DAIMO_VERIFIER,
        };
		return SafeAccount.createFactoryAddressAndData(
			owners,
			modOverrides,
			overrides.safe4337ModuleAddress ??
				SafeMultiChainSigAccountV1.DEFAULT_SAFE_4337_MODULE_ADDRESS,
			overrides.safeModuleSetupAddress ??
				SafeMultiChainSigAccountV1.DEFAULT_SAFE_MODULE_SETUP_ADDRESS,
		);
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
		overrides: CreateUserOperationV9Overrides = {},
	): Promise<UserOperationV9> {
		const parallelPaymasterInitValues = overrides.parallelPaymasterInitValues;
		if(
      parallelPaymasterInitValues != null &&
			!parallelPaymasterInitValues.paymasterData.toLowerCase().endsWith("22e325a297439656")
    ){
      throw new RangeError(
          "Invalid paymasterData override, it must end with the PAYMASTER_SIG_MAGIC '22e325a297439656'"
      );
		}		
        const [userOperation, factoryAddress, factoryData] =
			await this.createBaseUserOperationAndFactoryAddressAndFactoryData(
				transactions,
				false,
				providerRpc,
				bundlerRpc,
				{
					...overrides,
					isMultiChainSignature: true,
					webAuthnSharedSigner: overrides.webAuthnSharedSigner??SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_SHARED_SIGNER,
					eip7212WebAuthnPrecompileVerifier: overrides.eip7212WebAuthnPrecompileVerifier??SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_PRECOMPILE,
					eip7212WebAuthnContractVerifier: overrides.eip7212WebAuthnContractVerifier??SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_DAIMO_VERIFIER,
					webAuthnSignerFactory: overrides.webAuthnSignerFactory??SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_SIGNER_FACTORY,
					webAuthnSignerSingleton: overrides.webAuthnSignerSingleton??SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_SIGNER_SINGLETON,
					webAuthnSignerProxyCreationCode: overrides.webAuthnSignerProxyCreationCode??SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_SIGNER_PROXY_CREATION_CODE,
				}
			);
		if(parallelPaymasterInitValues != null){
			return {
				...userOperation,
				factory: factoryAddress,
				factoryData,
                ...parallelPaymasterInitValues,
				eip7702Auth: null
			};
		}else{
			return {
				...userOperation,
				factory: factoryAddress,
				factoryData,
				paymaster: null,
				paymasterVerificationGasLimit: null,
				paymasterPostOpGasLimit: null,
				paymasterData: null,
				eip7702Auth: null
			};
		}
	}

	/**
	 * create a useroperation signature
	 * @param useroperation - useroperation to sign
	 * @param privateKeys - for the signers
	 * @param chainId - target chain id
	 * @param overrides - overrides for the default values
	 * @param overrides.validAfter - timestamp the signature will be valid after
	 * @param overrides.validUntil - timestamp the signature will be valid until
	 * @returns signature
	 */
	public signUserOperation(
		userOperation: UserOperationV9,
		privateKeys: string[],
		chainId: bigint,
		overrides: {
			validAfter?: bigint;
			validUntil?: bigint;
		} = {},
	): string {
		return SafeAccount.baseSignSingleUserOperation(
			userOperation,
			privateKeys,
			chainId,
			this.entrypointAddress,
			this.safe4337ModuleAddress,
			{
				...overrides,
				isMultiChainSignature: true
			}
		)
	}

	/**
	 * sign a list of useroperations - multi chain signature
	 * @param useroperation - useroperation to sign
	 * @param privateKeys - for the signers
	 * @param chainId - target chain id
	 * @param overrides - overrides for the default values
	 * @param overrides.validAfter - timestamp the signature will be valid after
	 * @param overrides.validUntil - timestamp the signature will be valid until
	 * @returns signature
	 */
	public signUserOperations(
		userOperationsToSign: UserOperationToSign[],
		privateKeys: string[],
	): string[] {
		if (userOperationsToSign.length < 1) {
			throw new RangeError("There should be at least one userOperationsToSign");
		}
		if (privateKeys.length < 1) {
			throw new RangeError("There should be at least one privateKey");
		}
        if(userOperationsToSign.length > 1){
            const userOperationsHashes: string[] = [];
            userOperationsToSign.forEach(
                (userOperationsToSign, _index) => {
                    const userOperationHash = SafeAccount.getUserOperationEip712Hash_V9(
                        userOperationsToSign.userOperation,
                        userOperationsToSign.chainId,
                        {
                            validAfter: userOperationsToSign.validAfter,
                            validUntil: userOperationsToSign.validUntil,
                            safe4337ModuleAddress: this.safe4337ModuleAddress,
                            entrypointAddress: this.entrypointAddress,
                        },
                    );
                    userOperationsHashes.push(userOperationHash);
            });
            const [root, proofs] = generateMerkleProofs(userOperationsHashes);

            const merkleTreeRootHash = TypedDataEncoder.hash(
                {verifyingContract: this.safe4337ModuleAddress},
			    EIP712_MULTI_CHAIN_OPERATIONS_TYPE,
                {merkleTreeRoot: root},
            )

            const signerSignaturePairs: SignerSignaturePair[] = [];
            for (const privateKey of privateKeys) {
                const wallet = new Wallet(privateKey);
                const signature = wallet.signingKey.sign(
                    merkleTreeRootHash
                ).serialized;
                signerSignaturePairs.push({
                    signer: wallet.address,
                    signature
                });
            }

            const userOpSignatures: string[] = [];
            userOperationsToSign.forEach(
                (userOperationsToSign, index) => {
                    userOpSignatures.push(
                        SafeAccount.formatSignaturesToUseroperationSignature(
                            signerSignaturePairs,
                            {
                                validAfter: userOperationsToSign.validAfter,
                                validUntil: userOperationsToSign.validUntil,
                                isMultiChainSignature:true,
                                multiChainMerkleProof: proofs[index]
                            },
                        )
                    );
            });
            return userOpSignatures;
        }else{
            return [this.signUserOperation(
                userOperationsToSign[0].userOperation,
                privateKeys,
                userOperationsToSign[0].chainId,
                {
                    validUntil: userOperationsToSign[0].validUntil,
                    validAfter: userOperationsToSign[0].validAfter
                }
            )];
        }
	}

	/**
	 * Compute the EIP-712 hash of a multi-chain Merkle tree root for a set of UserOperations.
	 * This hash is what signers sign to approve multiple cross-chain operations at once.
	 * @param userOperationsToSignsToSign - list of UserOperations with their target chain IDs
	 * @param overrides - optional overrides for the Safe 4337 module address
	 * @returns the EIP-712 hash as a hex string
	 */
	public static getMultiChainSingleSignatureUserOperationsEip712Hash(
		userOperationsToSignsToSign: UserOperationToSign[],
		overrides: {
			safe4337ModuleAddress?: string;
		} = {},
    ): string{
        const data = SafeMultiChainSigAccountV1.getMultiChainSingleSignatureUserOperationsEip712Data(
            userOperationsToSignsToSign, overrides)	;
		return TypedDataEncoder.hash(
			data.domain,
			data.types,
			data.messageValue,
		);
    }

	/**
	 * Get the EIP-712 typed data components for a multi-chain Merkle tree root.
	 * Returns the domain, types, and message value needed for signing or hashing.
	 * @param userOperationsToSignsToSign - list of UserOperations with their target chain IDs
	 * @param overrides - optional overrides for the Safe 4337 module address
	 * @returns an object with domain, types, and messageValue for EIP-712 signing
	 */
	public static getMultiChainSingleSignatureUserOperationsEip712Data(
		userOperationsToSign: UserOperationToSign[],
		overrides: {
			safe4337ModuleAddress?: string;
			entrypointAddress?: string;
		} = {},
    ): {
        domain: MultiChainSignatureMerkleTreeRootTypedDataDomain,
        types:Record<string, {name: string;type: string;}[]>,
        messageValue: MultiChainSignatureMerkleTreeRootTypedMessageValue
    } {
		if (userOperationsToSign.length < 1) {
			throw new RangeError("There should be at least one userOperationsToSign");
		}
		const safe4337ModuleAddress =
			overrides.safe4337ModuleAddress ??
            SafeMultiChainSigAccountV1.DEFAULT_SAFE_4337_MODULE_ADDRESS;	

        const userOperationsHashes: string[] = [];

        userOperationsToSign.forEach(
            (userOperationsToSign, _index) => {
                const userOperationHash = SafeAccount.getUserOperationEip712Hash_V9(
                    userOperationsToSign.userOperation,
                    userOperationsToSign.chainId,
                    {
                        validAfter: userOperationsToSign.validAfter,
                        validUntil: userOperationsToSign.validUntil,
                        safe4337ModuleAddress,
                        entrypointAddress: overrides.entrypointAddress,
                    },
                );
                userOperationsHashes.push(userOperationHash);
        });
        const [root, _proofs] = generateMerkleProofs(userOperationsHashes);
		return {
            domain: {verifyingContract: safe4337ModuleAddress},
			types: EIP712_MULTI_CHAIN_OPERATIONS_TYPE,
			messageValue: {merkleTreeRoot: root},
        };
    }

	/**
	 * formate a list of eip712 signatures to a list of multi chain useroperations signatures
	 * @param signerSignaturePairs - a list of a pair of a signer and it's signature
	 * @param overrides - overrides for the default values
	 * @returns signature
	 */
	public static formatSignaturesToUseroperationsSignatures(
		userOperationsToSign: UserOperationToSignWithOverrides[],
		signerSignaturePairs: SignerSignaturePair[],
	): string[] {
		if (userOperationsToSign.length < 1) {
			throw new RangeError("There should be at least one userOperationsToSign");
		}
		const defaultOverrides: WebAuthnSignatureOverrides = {
			eip7212WebAuthnPrecompileVerifier:
				SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_PRECOMPILE,
			eip7212WebAuthnContractVerifier:
				SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_DAIMO_VERIFIER,
			webAuthnSignerFactory:
				SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_SIGNER_FACTORY,
			webAuthnSignerSingleton:
				SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_SIGNER_SINGLETON,
			webAuthnSignerProxyCreationCode:
				SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_SIGNER_PROXY_CREATION_CODE,
			safe4337ModuleAddress:
				SafeMultiChainSigAccountV1.DEFAULT_SAFE_4337_MODULE_ADDRESS,
			webAuthnSharedSigner:
				SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_SHARED_SIGNER,
		};
		if (userOperationsToSign.length === 1) {
			return [
				SafeAccount.formatSignaturesToUseroperationSignature(
					signerSignaturePairs,
					{
						...defaultOverrides,
						...userOperationsToSign[0].overrides,
						validAfter: userOperationsToSign[0].validAfter,
						validUntil: userOperationsToSign[0].validUntil,
						isMultiChainSignature: true,
					},
				),
			];
		}
		const userOperationsHashes: string[] = [];
		userOperationsToSign.forEach(
			(userOperationToSign, _index) => {
				const userOperationHash = SafeAccount.getUserOperationEip712Hash_V9(
					userOperationToSign.userOperation,
					userOperationToSign.chainId,
					{
						validAfter: userOperationToSign.validAfter,
						validUntil: userOperationToSign.validUntil,
						safe4337ModuleAddress:
							userOperationToSign.overrides?.safe4337ModuleAddress ??
							defaultOverrides.safe4337ModuleAddress,
					},
				);
				userOperationsHashes.push(userOperationHash);
			},
		);
		const [_root, proofs] = generateMerkleProofs(userOperationsHashes);
		const userOpSignatures: string[] = [];
		userOperationsToSign.forEach(
			(userOperationToSign, index) => {
				userOpSignatures.push(
					SafeAccount.formatSignaturesToUseroperationSignature(
						signerSignaturePairs,
						{
							...defaultOverrides,
							...userOperationToSign.overrides,
							isMultiChainSignature: true,
							multiChainMerkleProof: proofs[index],
						},
					),
				);
			},
		);
		return userOpSignatures;
	}

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
			eip7212WebAuthnPrecompileVerifier: overrides.eip7212WebAuthnPrecompileVerifier??SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_PRECOMPILE,
			eip7212WebAuthnContractVerifier: overrides.eip7212WebAuthnContractVerifier??SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_DAIMO_VERIFIER,
			webAuthnSignerFactory: overrides.webAuthnSignerFactory??SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_SIGNER_FACTORY,
			webAuthnSignerSingleton: overrides.webAuthnSignerSingleton??SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_SIGNER_SINGLETON,
			webAuthnSignerProxyCreationCode: overrides.webAuthnSignerProxyCreationCode??SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_SIGNER_PROXY_CREATION_CODE,
		});
	}

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
			eip7212WebAuthnPrecompileVerifier: overrides.eip7212WebAuthnPrecompileVerifier??SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_PRECOMPILE,
			eip7212WebAuthnContractVerifier: overrides.eip7212WebAuthnContractVerifier??SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_DAIMO_VERIFIER,
			webAuthnSignerFactory: overrides.webAuthnSignerFactory??SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_SIGNER_FACTORY,
		});
	}

	public static createDummySignerSignaturePairForExpectedSigners(
		expectedSigners: Signer[],
		webAuthnSignatureOverrides: WebAuthnSignatureOverrides = {},
	): SignerSignaturePair[] {
		return SafeAccount.createDummySignerSignaturePairForExpectedSigners(expectedSigners, {
			...webAuthnSignatureOverrides,
			eip7212WebAuthnPrecompileVerifier: webAuthnSignatureOverrides.eip7212WebAuthnPrecompileVerifier??SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_PRECOMPILE,
			eip7212WebAuthnContractVerifier: webAuthnSignatureOverrides.eip7212WebAuthnContractVerifier??SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_DAIMO_VERIFIER,
			webAuthnSignerFactory: webAuthnSignatureOverrides.webAuthnSignerFactory??SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_SIGNER_FACTORY,
			webAuthnSignerSingleton: webAuthnSignatureOverrides.webAuthnSignerSingleton??SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_SIGNER_SINGLETON,
			webAuthnSignerProxyCreationCode: webAuthnSignatureOverrides.webAuthnSignerProxyCreationCode??SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_SIGNER_PROXY_CREATION_CODE,
			webAuthnSharedSigner: webAuthnSignatureOverrides.webAuthnSharedSigner??SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_SHARED_SIGNER,
		});
	}

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
		return SafeAccount.verifyWebAuthnSignatureForMessageHash(nodeRpcUrl, signer, messageHash, signature, {
			...overrides,
			eip7212WebAuthnPrecompileVerifier: overrides.eip7212WebAuthnPrecompileVerifier??SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_PRECOMPILE,
			eip7212WebAuthnContractVerifier: overrides.eip7212WebAuthnContractVerifier??SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_DAIMO_VERIFIER,
			webAuthnSignerSingleton: overrides.webAuthnSignerSingleton??SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_SIGNER_SINGLETON,
		});
	}
}
