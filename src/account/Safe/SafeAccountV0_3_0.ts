import { SafeAccount } from "./SafeAccount";
import {
	InitCodeOverrides,
	Signer,
	CreateUserOperationV7Overrides,
    SafeUserOperationTypedDataDomain,
    SafeUserOperationV7TypedMessageValue,
} from "./types";

import { UserOperationV7, MetaTransaction } from "../../types";
import { ENTRYPOINT_V7, ZeroAddress } from "src/constants";
import {
    entryPoint07Abi, entryPoint07Address, toSmartAccount, EntryPointVersion,
    UserOperationRequest, type UserOperation,
} from "viem/account-abstraction"
import { 
    Chain, Hex, LocalAccount, SignableMessage, UnionPartialBy,
    createClient, http 
} from "viem";
import { Call } from "viem/_types/types/calls";
import { fetchAccountNonce } from "src/utils";

export class SafeAccountV0_3_0 extends SafeAccount {
	static readonly DEFAULT_ENTRYPOINT_ADDRESS = ENTRYPOINT_V7;
	static readonly DEFAULT_SAFE_4337_MODULE_ADDRESS =
		"0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226";
	static readonly DEFAULT_SAFE_MODULE_SETUP_ADDRESS =
		"0x2dd68b007B46fBe91B9A7c3EDa5A7a1063cB5b47";

	constructor(
		accountAddress: string,
		overrides: {
			safe4337ModuleAddress?: string;
			entrypointAddress?: string;
		} = {},
	) {
		const safe4337ModuleAddress =
			overrides.safe4337ModuleAddress ??
			SafeAccountV0_3_0.DEFAULT_SAFE_4337_MODULE_ADDRESS;
		const entrypointAddress =
			overrides.entrypointAddress ??
			SafeAccountV0_3_0.DEFAULT_ENTRYPOINT_ADDRESS;

		super(accountAddress, safe4337ModuleAddress, entrypointAddress);
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
		const [accountAddress, ,] =
			SafeAccount.createAccountAddressAndFactoryAddressAndData(
				owners,
				overrides,
				overrides.safe4337ModuleAddress ??
					SafeAccountV0_3_0.DEFAULT_SAFE_4337_MODULE_ADDRESS,
				overrides.safeModuleSetupddress ??
					SafeAccountV0_3_0.DEFAULT_SAFE_MODULE_SETUP_ADDRESS,
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
	): SafeAccountV0_3_0 {
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
			SafeAccountV0_3_0.createAccountAddressAndFactoryAddressAndData(
				owners,
				overrides,
				overrides.safe4337ModuleAddress ??
					SafeAccountV0_3_0.DEFAULT_SAFE_4337_MODULE_ADDRESS,
				overrides.safeModuleSetupddress ??
					SafeAccountV0_3_0.DEFAULT_SAFE_MODULE_SETUP_ADDRESS,
			);

		const safe = new SafeAccountV0_3_0(accountAddress, {
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
	 * defaults to ENTRYPOINT_V7
	 * @param overrides.safe4337ModuleAddress - defaults to DEFAULT_SAFE_4337_MODULE_ADDRESS
	 * @returns useroperation hash
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
			SafeAccountV0_3_0.DEFAULT_SAFE_4337_MODULE_ADDRESS;
		const safeModuleSetupddress =
			overrides.safeModuleSetupddress ??
			SafeAccountV0_3_0.DEFAULT_SAFE_MODULE_SETUP_ADDRESS;

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
				SafeAccountV0_3_0.DEFAULT_SAFE_4337_MODULE_ADDRESS,
			overrides.safeModuleSetupddress ??
				SafeAccountV0_3_0.DEFAULT_SAFE_MODULE_SETUP_ADDRESS,
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

    public async toViemSmartAccount(
		providerRpc: string,
		owners: LocalAccount[],
        chain:Chain,
    ){
        const version: EntryPointVersion = '0.7';
        const entryPoint = {
          abi: entryPoint07Abi,
          address: entryPoint07Address,
          version,
        };
        const client = createClient({
            chain: chain,
            transport: http(providerRpc)
        });
        const getAddress = async () => {
            return this.accountAddress as `0x{string}`;
        };
        const decodeCalls = async(data: Hex) => {
            return [];
        };
        const encodeCalls = async(calls: readonly Call[]) => {
            return SafeAccount.createAccountCallDataBatchTransactions(
                calls.map(
                    call => {
                        return {
                            to: call.to,
                            data: call.data??"0x",
                            value: call.value??0n,
                        }
                    }
                )
            ) as `0x{string}`;
        };
        const getFactoryArgs = async () =>{
            return {
                factory: this.factoryAddress as `0x{string}`,
                factoryData: this.factoryData as `0x{string}`,
            }
        }

        const getNonce = async () =>{
            return fetchAccountNonce(
                providerRpc,
                this.entrypointAddress,
                this.accountAddress,
            );
        };
        
        const getStubSignature = async (
            parameters?: UserOperationRequest | undefined
        ) =>{
          return "0x000000000000000000000000df20afc89f49c78f8615b27f368898788b02eb99665f7426ba097400c5083ff908de6417d21536146e7b54a15be1013c3a209b0047a079ca8e0564435aa438611c" as `0x{string}`;
        };
        
        const signMessage = async (
            parameters: { message: SignableMessage }
        ) =>{
            return "" as `0x{string}`;
        };
        const signTypedData = async (parameters:any) => {
            return "" as `0x{string}`;
        };
        const signUserOperation = async (
            parameters: UnionPartialBy<UserOperation, 'sender'> & {
              chainId?: number | undefined
            },
        ) => {
          const { chainId = client.chain.id, ...userOperation } = parameters
          const userOp: UserOperationV7 = {
            ...userOperation,
            sender: userOperation.sender??ZeroAddress,
            factory: userOperation.factory??null,
            factoryData: userOperation.factoryData??null,
            paymaster: userOperation.paymaster??null,
            paymasterVerificationGasLimit: userOperation.paymasterVerificationGasLimit??null,
            paymasterPostOpGasLimit: userOperation.paymasterVerificationGasLimit??null,
            paymasterData: userOperation.paymasterData??null
          }
          const { domain, types, messageValue } =
            SafeAccountV0_3_0.getUserOperationEip712Data(userOp, BigInt(chainId));
          return SafeAccountV0_3_0.formatEip712SignaturesToUseroperationSignature(
              owners.map(owner => owner.address),
              await Promise.all(owners.map(async owner => { 
                  return owner.signTypedData({  // @ts-ignore
                    domain, types, message: messageValue, primaryType: "SafeOp"});
              })),
          ) as `0x{string}`; 
        };
    
      return toSmartAccount({
        client,
        entryPoint,
        getAddress,
        decodeCalls,
        encodeCalls,
        getFactoryArgs,
        getNonce,
        getStubSignature,
        signMessage,
        signTypedData,
        signUserOperation
      });
    }
}
