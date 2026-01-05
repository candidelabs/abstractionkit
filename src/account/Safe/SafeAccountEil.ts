import { SafeAccount } from "./SafeAccount";
import {
	InitCodeOverrides,
	Signer,
	CreateUserOperationV9Overrides,
    SafeUserOperationTypedDataDomain,
    SafeUserOperationV9TypedMessageValue,
    SafeAccountSingleton,
    PerChainBatchTransaction,
    UserOperationToSign,
    CreatePaymasterUserOperationOverrides,
    CrossChainSignatureMerkleTreeRootTypedDataDomain,
    CrossChainSignatureMerkleTreeRootTypedMessageValue,
    SignerSignaturePair,
    WebAuthnSignatureOverrides,
    PerChainBatchTransactionWithPaymaster,
} from "./types";

import { UserOperationV9, MetaTransaction, OnChainIdentifierParamsType, PaymasterFieldsInitValues } from "../../types";
import { EIP712_MULTI_SAFE_OPERATIONS_TYPE, ENTRYPOINT_V9 } from "src/constants";
import { generateMerkleProofs } from "./MerkleTree";
import { TypedDataEncoder, Wallet } from "ethers";
import { SendUseroperationResponse } from "../SendUseroperationResponse";

export class SafeAccountEil extends SafeAccount {
	static readonly DEFAULT_ENTRYPOINT_ADDRESS = ENTRYPOINT_V9;
	static readonly DEFAULT_SAFE_4337_MODULE_ADDRESS =
        "0xf998536d89f3e483087da37eabb016faa694b641";
	static readonly DEFAULT_SAFE_MODULE_SETUP_ADDRESS =
		"0x2dd68b007B46fBe91B9A7c3EDa5A7a1063cB5b47";

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
			SafeAccountEil.DEFAULT_SAFE_4337_MODULE_ADDRESS;
		const entrypointAddress =
			overrides.entrypointAddress ??
			SafeAccountEil.DEFAULT_ENTRYPOINT_ADDRESS;
    
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
	 * calculate account address from initial owners signers
	 * @param owners - list of account owners addresses
	 * @param overrides - override values to change the initialization default values
	 * @returns account address
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
					SafeAccountEil.DEFAULT_SAFE_4337_MODULE_ADDRESS,
				overrides.safeModuleSetupddress ??
					SafeAccountEil.DEFAULT_SAFE_MODULE_SETUP_ADDRESS,
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
	): SafeAccountEil {
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
			SafeAccount.createAccountAddressAndFactoryAddressAndData(
				owners,
				overrides,
				overrides.safe4337ModuleAddress ??
					SafeAccountEil.DEFAULT_SAFE_4337_MODULE_ADDRESS,
				overrides.safeModuleSetupddress ??
					SafeAccountEil.DEFAULT_SAFE_MODULE_SETUP_ADDRESS,
			);

		const safe = new SafeAccountEil(accountAddress, {
			safe4337ModuleAddress: overrides.safe4337ModuleAddress,
			entrypointAddress: overrides.entrypointAddress,
            onChainIdentifierParams: overrides.onChainIdentifierParams,
            onChainIdentifier: overrides.onChainIdentifier
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
			SafeAccountEil.DEFAULT_ENTRYPOINT_ADDRESS;
		const safe4337ModuleAddress =
			overrides.safe4337ModuleAddress ??
			SafeAccountEil.DEFAULT_SAFE_4337_MODULE_ADDRESS;

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
			SafeAccountEil.DEFAULT_ENTRYPOINT_ADDRESS;
		const safe4337ModuleAddress =
			overrides.safe4337ModuleAddress ??
			SafeAccountEil.DEFAULT_SAFE_4337_MODULE_ADDRESS;

		return SafeAccount.getUserOperationEip712Data(useroperation, chainId, {
			validAfter,
			validUntil,
			entrypointAddress,
			safe4337ModuleAddress,
		});
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
			SafeAccountEil.DEFAULT_SAFE_4337_MODULE_ADDRESS;
		const safeModuleSetupddress =
			overrides.safeModuleSetupddress ??
			SafeAccountEil.DEFAULT_SAFE_MODULE_SETUP_ADDRESS;

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
	 * create account factory address and factory data
	 * @param owners - list of account owners signers
	 * @param overrides - override values to change the initialization default values
	 * @returns factoryAddress and factoryData
	 */
	public static createFactoryAddressAndData(
		owners: Signer[],
		overrides: InitCodeOverrides = {},
	): [string, string] {
		return SafeAccount.createFactoryAddressAndData(
			owners,
			overrides,
			overrides.safe4337ModuleAddress ??
				SafeAccountEil.DEFAULT_SAFE_4337_MODULE_ADDRESS,
			overrides.safeModuleSetupddress ??
				SafeAccountEil.DEFAULT_SAFE_MODULE_SETUP_ADDRESS,
		);
	}

	/**
	 * createPaymasterUserOperation will determine the nonce, fetch the gas prices,
	 * estimate gas limits, set paymaster fields and return a useroperation to be signed.
	 * you can override all these values using the overrides parameter.
	 * @param transactions - metatransaction list to be encoded
	 * @param paymasterFieldsInitValues -paymaster fields init values
	 * @param providerRpc - node rpc to fetch account nonce and gas prices
	 * @param bundlerRpc - bundler rpc for gas estimation
	 * @param overrides - overrides for the default values
	 * @returns promise with useroperation
	 */
	public async createPaymasterUserOperation(
		transactions: MetaTransaction[],
		paymasterFieldsInitValues: PaymasterFieldsInitValues,
		providerRpc?: string,
		bundlerRpc?: string,
		overrides: CreatePaymasterUserOperationOverrides = {},
	): Promise<UserOperationV9> {
        return await this.createUserOperation(
            transactions,
            providerRpc,
            bundlerRpc,
            {
                ...overrides,
                paymaster: paymasterFieldsInitValues.paymaster,
                paymasterVerificationGasLimit: paymasterFieldsInitValues.paymasterVerificationGasLimit,
                paymasterPostOpGasLimit: paymasterFieldsInitValues.paymasterPostOpGasLimit,
                paymasterData: paymasterFieldsInitValues.paymasterData,
            }
        )
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
		const [userOperation, factoryAddress, factoryData] =
			await this.createBaseUserOperationAndFactoryAddressAndFactoryData(
				transactions,
				false,
				providerRpc,
				bundlerRpc,
				{
					...overrides,
					isCrossChainSignature: true
				}
			);

		const userOperationV9: UserOperationV9 = {
			...userOperation,
			factory: factoryAddress,
			factoryData,
			paymaster: overrides.paymaster??null,
			paymasterVerificationGasLimit: overrides.paymasterVerificationGasLimit??null,
			paymasterPostOpGasLimit: overrides.paymasterPostOpGasLimit??null,
			paymasterData: overrides.paymasterData??null,
            eip7702Auth: null
		};

		return userOperationV9;
	}

	/**
	 * createUserOperations will determine the nonce, fetch the gas prices,
	 * estimate gas limits and return a list of useroperations to be signed.
	 * you can override all these values using the overrides parameter.
	 * @param perChainBatchTransactions - list of batch transactions per chain
	 * @returns promise with useroperation
	 */
	public async createUserOperations(
		perChainBatchTransactions: PerChainBatchTransaction[],
	): Promise<{results: UserOperationV9[], errors: Error[]}> {
        const perChainBatchTransactionsWithPaymaster:PerChainBatchTransactionWithPaymaster[] = [];
        perChainBatchTransactions.forEach(
            (batch, _index) => {
                perChainBatchTransactionsWithPaymaster.push(
                    {
                        ...batch,
                        paymasterFieldsInitValues: {
                            paymaster:undefined,
                            paymasterVerificationGasLimit:undefined,
                            paymasterPostOpGasLimit:undefined,
                            paymasterData:undefined,
                        },
                    }
                );
            }
        );

        return this.createPaymasterUserOperations(perChainBatchTransactionsWithPaymaster);
    }

	/**
	 * createPaymasterUserOperations will determine the nonce, fetch the gas prices,
	 * estimate gas limits, set paymaster fields and return a list of useroperations to be signed.
	 * you can override all these values using the overrides parameter.
	 * @param perChainBatchTransactionsWithPaymaster - list of batch transactions per chain
	 * @returns promise with useroperation
	 */
	public async createPaymasterUserOperations(
		perChainBatchTransactionsWithPaymaster: PerChainBatchTransactionWithPaymaster[],
	): Promise<{results: UserOperationV9[], errors: Error[]}> {
        const userOperationsPromises: Promise<UserOperationV9>[] = [];
        
        let chainIdMap = new Map<bigint, boolean>();
        
		perChainBatchTransactionsWithPaymaster.forEach(
            (batch, _index) => {
                if(chainIdMap.get(batch.chainId)){
				    throw RangeError(
                        "Only one useroperation per chainid is allowed for createUserOperations."
                    );
                }
                userOperationsPromises.push(
                    this.createUserOperation(
                        batch.metaTransactions,
                        batch.providerRpc,
                        batch.bundlerRpc,
                        {
                            ...batch.overrides,
                            paymaster: batch.paymasterFieldsInitValues.paymaster,
                            paymasterVerificationGasLimit:
                                batch.paymasterFieldsInitValues.paymasterVerificationGasLimit,
                            paymasterPostOpGasLimit:
                                batch.paymasterFieldsInitValues.paymasterPostOpGasLimit,
                            paymasterData: batch.paymasterFieldsInitValues.paymasterData,
                        }
                    )
                );
                chainIdMap.set(batch.chainId, true);
		    }
        );

        let userOperations: UserOperationV9[] = [];
        let userOperationsErrors:Error[] = [];
        await Promise.allSettled(userOperationsPromises).then((results) => {
            results.forEach((result, index) => {
              if (result.status === 'fulfilled') {
                userOperations.push(result.value);
              } else {
                  result.reason.message =
                      `userOp no-${(index+1).toString()}: ${result.reason.message}`;
                  userOperationsErrors.push(result.reason);
              }
            });
          });

		return {results: userOperations, errors: userOperationsErrors};
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
		useroperation: UserOperationV9,
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
			{
				...overrides,
				isCrossChainSignature: true
			}
		)
	}

	/**
	 * sign a list of useroperations - cross chain signature
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
			throw RangeError("There should be at least one userOperationsToSignsToSign");
		}
		if (privateKeys.length < 1) {
			throw RangeError("There should be at least one privateKey");
		}
        if(userOperationsToSign.length > 1){
            const userOperationsHashes: string[] = [];
            userOperationsToSign.forEach(
                (userOperationsToSignToSign, _index) => {
                    const userOperationHash = SafeAccount.getUserOperationEip712Hash_V9(
                        userOperationsToSignToSign.useroperation,
                        userOperationsToSignToSign.chainId,
                    );
                    userOperationsHashes.push(userOperationHash);
            });
            const [root, proofs] = generateMerkleProofs(userOperationsHashes);

            const merkleTreeRootHash = TypedDataEncoder.hash(
                {verifyingContract: this.safe4337ModuleAddress},
			    EIP712_MULTI_SAFE_OPERATIONS_TYPE,
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
                (userOperationsToSignToSign, index) => {
                    userOpSignatures.push(
                        SafeAccount.formatSignaturesToUseroperationSignature(
                            signerSignaturePairs,
                            {
                                validAfter: userOperationsToSignToSign.validAfter,
                                validUntil: userOperationsToSignToSign.validUntil,
                                isCrossChainSignature:true,
                                crossChainMerkleProof: proofs[index]
                            },
                        )
                    );
            });
            return userOpSignatures;
        }else{
            return [this.signUserOperation(
                userOperationsToSign[0].useroperation,
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
	 * sends useroperations to bundlers RPCs concurrently with no order
	 * @param userOperation - useroperation to send
	 * @param bundlerRpc - bundler rpc to send useroperation
	 * @returns promise with SendUseroperationResponse
	 */
	public async sendUserOperationsNoOrder(
        userOperationBundlerPair: {
            userOperation: UserOperationV9,
            bundlerRpc: string,
        }[]
	): Promise<{results: SendUseroperationResponse[], errors: Error[]}> {
        const sendUserOperationsPromises: Promise<SendUseroperationResponse>[] = [];
        
		userOperationBundlerPair.forEach(
            (pair, _index) => {
                sendUserOperationsPromises.push(
                    this.sendUserOperation(pair.userOperation, pair.bundlerRpc
                    )
                );
		    }
        );

        let sendUserOperationsResonses: SendUseroperationResponse[] = [];
        let sendUserOperationsErrors:Error[] = [];
        await Promise.allSettled(sendUserOperationsPromises).then((results) => {
            results.forEach((result, index) => {
              if (result.status === 'fulfilled') {
                sendUserOperationsResonses.push(result.value);
              } else {
                  result.reason.message =
                      `userOp no-${(index+1).toString()}: ${result.reason.message}`;
                  sendUserOperationsErrors.push(result.reason);
              }
            });
          });
        return {results:sendUserOperationsResonses, errors:sendUserOperationsErrors};
	}

	public static getCrossChainSingleSignatureUserOperationsEip712Hash(
		userOperationsToSignsToSign: UserOperationToSign[],
		overrides: {
			safe4337ModuleAddress?: string;
		} = {},
    ): string{
        const data = SafeAccountEil.getCrossChainSingleSignatureUserOperationsEip712Data(
            userOperationsToSignsToSign, overrides)	;
		return TypedDataEncoder.hash(
			data.domain,
			data.types,
			data.messageValue,
		);
    }

	public static getCrossChainSingleSignatureUserOperationsEip712Data(
		userOperationsToSignsToSign: UserOperationToSign[],
		overrides: {
			safe4337ModuleAddress?: string;
		} = {},
    ): {
        domain: CrossChainSignatureMerkleTreeRootTypedDataDomain,
        types:Record<string, {name: string;type: string;}[]>,
        messageValue: CrossChainSignatureMerkleTreeRootTypedMessageValue
    } {
		const safe4337ModuleAddress =
			overrides.safe4337ModuleAddress ??
            SafeAccountEil.DEFAULT_SAFE_4337_MODULE_ADDRESS;	

        const userOperationsHashes: string[] = [];

        userOperationsToSignsToSign.forEach(
            (userOperationsToSignToSign, _index) => {
                const userOperationHash = SafeAccount.getUserOperationEip712Hash_V9(
                    userOperationsToSignToSign.useroperation,
                    userOperationsToSignToSign.chainId,
                );
                userOperationsHashes.push(userOperationHash);
        });
        const [root, _proofs] = generateMerkleProofs(userOperationsHashes);
		return {
            domain: {verifyingContract: safe4337ModuleAddress},
			types: EIP712_MULTI_SAFE_OPERATIONS_TYPE,
			messageValue: {merkleTreeRoot: root},
        };
    }

	/**
	 * formate a list of eip712 signatures to a list of cross chain useroperations signatures
	 * @param signerSignaturePairs - a list of a pair of a signer and it's signature
	 * @param overrides - overrides for the default values
	 * @returns signature
	 */
	public static formatSignaturesToUseroperationsSignatures(
		userOperationsToSignsToSign: UserOperationToSign[],
		signerSignaturePairs: SignerSignaturePair[],
		overrides: WebAuthnSignatureOverrides = {},
	): string[] {
        const userOperationsHashes: string[] = [];
        userOperationsToSignsToSign.forEach(
            (userOperationsToSignToSign, _index) => {
                const userOperationHash = SafeAccount.getUserOperationEip712Hash_V9(
                    userOperationsToSignToSign.useroperation,
                    userOperationsToSignToSign.chainId,
                );
                userOperationsHashes.push(userOperationHash);
        });
        const [_root, proofs] = generateMerkleProofs(userOperationsHashes);
        const userOpSignatures: string[] = [];
        userOperationsToSignsToSign.forEach(
            (_userOperationsToSignToSign, index) => {
                userOpSignatures.push(
                    SafeAccount.formatSignaturesToUseroperationSignature(
                        signerSignaturePairs,
                        {
                            validAfter: overrides.validAfter,
                            validUntil: overrides.validUntil,
                            isCrossChainSignature:true,
                            crossChainMerkleProof: proofs[index]
                        },
                    )
                );
        });
        return userOpSignatures;
    }
}
