import { SmartAccount } from "../SmartAccount";
import { BaseUserOperationDummyValues, ENTRYPOINT_V7 } from "src/constants";
import { createCallData, createUserOperationHash, fetchAccountNonce, handlefetchGasPrice, sendJsonRpcRequest } from "../../utils";
import { GasOption, PolygonChain, StateOverrideSet, UserOperationV7 } from "src/types";
import { AbstractionKitError } from "src/errors";
import { Authorization7702Hex, bigintToHex } from "src/utils7702";
import { Bundler } from "src/Bundler";
import { Wallet } from "ethers";
import { SendUseroperationResponse } from "../SendUseroperationResponse";

/**
 * Wrapper for a SimpleMetatransaction
 */
export interface SimpleMetaTransaction {
	to: string;
	value: bigint;
	data: string;
}

export interface CreateUserOperationOverrides {
	/** set the nonce instead of quering the current nonce from the rpc node */
	nonce?: bigint;
	/** set the callData instead of using the encoding of the provided Metatransactions*/
	callData?: string;
	/** set the callGasLimit instead of estimating gas using the bundler*/
	callGasLimit?: bigint;
	/** set the verificationGasLimit instead of estimating gas using the bundler*/
	verificationGasLimit?: bigint;
	/** set the preVerificationGas instead of estimating gas using the bundler*/
	preVerificationGas?: bigint;
	/** set the maxFeePerGas instead of quering the current gas price from the rpc node */
	maxFeePerGas?: bigint;
	/** set the maxPriorityFeePerGas instead of quering the current gas price from the rpc node */
	maxPriorityFeePerGas?: bigint;

	/** set the callGasLimitPercentageMultiplier instead of estimating gas using the bundler*/
	callGasLimitPercentageMultiplier?: number;
	/** set the verificationGasLimitPercentageMultiplier instead of estimating gas using the bundler*/
	verificationGasLimitPercentageMultiplier?: number;
	/** set the preVerificationGasPercentageMultiplier instead of estimating gas using the bundler*/
	preVerificationGasPercentageMultiplier?: number;
	/** set the maxFeePerGasPercentageMultiplier instead of quering the current gas price from the rpc node */
	maxFeePerGasPercentageMultiplier?: number;
	/** set the maxPriorityFeePerGasPercentageMultiplier instead of quering the current gas price from the rpc node */
	maxPriorityFeePerGasPercentageMultiplier?: number;

	/** pass some state overrides for gas estimation"*/
	state_override_set?: StateOverrideSet;

	dummySignature?: string;

	gasLevel?: GasOption;
	polygonGasStation?: PolygonChain;

    eip7702auth?:{
        chainId: bigint;
        address?: string;
        nonce?: bigint;
        yParity?: string;
        r?: string;
        s?: string;
    };
}


export class Simple7702Account extends SmartAccount {
	static readonly DEFAULT_DELEGATEE_ADDRESS =
        "0x6C193e88c2C6ACB0897d162E9496156BfFF73C0F";
	static readonly DEFAULT_ENTRYPOINT_ADDRESS = ENTRYPOINT_V7;

	static readonly executorFunctionSelector = "0xb61d27f6"; //execute
	static readonly executorFunctionInputAbi: string[] = [
        "address", //dest
        "uint256", //value
        "bytes", //func
    ];
    static readonly batchExecutorFunctionSelector = "0x34fcd5be"; //executeBatch
	static readonly batchExecutorFunctionInputAbi = ["(address,uint256,bytes)[]"];
    static readonly dummySignature =
        "0xd2614025fc173b86704caf37b2fb447f7618101a0d31f5f304c777024cef38a060a29ee43fcf0c46f9107d4f670b8a85c2c017a1fe9e4af891f24f0be6ba5d671c";

	readonly entrypointAddress: string;

	constructor(
		accountAddress: string,
        overrides: {
			entrypointAddress?: string;
		} = {},
	) {
		super(accountAddress);
        this.entrypointAddress = overrides.entrypointAddress ??
			Simple7702Account.DEFAULT_ENTRYPOINT_ADDRESS;
	}
    
    /**
	 * encode calldata to be executed
	 * @param to - target address
	 * @param value - amount of natic token to transafer to target address
	 * @param data - calldata
	 * @returns callData
	 */
    public static createAccountCallData(
		to: string,
		value: bigint,
		data: string,
	): string {
		const executorFunctionInputParameters = [to, value, data];
		const callData = createCallData(
			Simple7702Account.executorFunctionSelector,
			Simple7702Account.executorFunctionInputAbi,
			executorFunctionInputParameters,
		);
		return callData;
    }
    
    /**
	 * encode calldata for a single SimpleMetaTransaction to be executed
	 * @param metaTransaction - metaTransaction to create calldata for
	 * @returns calldata
	 */
    public static createAccountCallDataSingleTransaction(
		metaTransaction: SimpleMetaTransaction,
	): string {
		const value = metaTransaction.value ?? 0;
		const data = metaTransaction.data ?? "0x";
		const executorFunctionCallData = Simple7702Account.createAccountCallData(
			metaTransaction.to,
			value,
			data,
		);
		return executorFunctionCallData;
	}

    /**
	 * encode calldata for a list of SimpleMetaTransactions to be executed
	 * @param metaTransaction - metaTransaction to create calldata for
	 * @returns calldata
	 */
	public static createAccountCallDataBatchTransactions(
        transactions: SimpleMetaTransaction[]
    ): string {
        const encodedTransactions = [transactions.map(
            transaction => [transaction.to, transaction.value, transaction.data]
        )];
        const callData = createCallData(
			Simple7702Account.batchExecutorFunctionSelector,
			Simple7702Account.batchExecutorFunctionInputAbi,
			encodedTransactions,
		);
		return callData;
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
		transactions: SimpleMetaTransaction[],
		providerRpc?: string,
		bundlerRpc?: string,
		overrides: CreateUserOperationOverrides = {},
	): Promise<UserOperationV7> {
        if (transactions.length < 1) {
			throw RangeError("There should be at least one transaction");
		}
        let nonce:bigint | null = null;
		let nonceOp:Promise<bigint> | null = null;

        if (overrides.nonce == null) {
			if (providerRpc != null) {
				nonceOp = fetchAccountNonce(
					providerRpc,
					this.entrypointAddress,
					this.accountAddress,
				);
			} else {
				throw new AbstractionKitError(
					"BAD_DATA",
					"providerRpc cant't be null if nonce is not overriden",
				);
			}
		} else {
			nonce = overrides.nonce;
		}

        if (
			typeof overrides.maxFeePerGas === "bigint" &&
			overrides.maxFeePerGas < 0n
		) {
			throw RangeError("maxFeePerGas overrid can't be negative");
		}

		if (
			typeof overrides.maxPriorityFeePerGas === "bigint" &&
			overrides.maxPriorityFeePerGas < 0n
		) {
			throw RangeError("maxPriorityFeePerGas overrid can't be negative");
		}
        let maxFeePerGas = BaseUserOperationDummyValues.maxFeePerGas;
		let maxPriorityFeePerGas =
			BaseUserOperationDummyValues.maxPriorityFeePerGas;

        let gasPriceOp:Promise<[bigint, bigint]> | null = null;
        if (
			overrides.maxFeePerGas == null ||
			overrides.maxPriorityFeePerGas == null
		) {
            gasPriceOp = handlefetchGasPrice(
                providerRpc, overrides.polygonGasStation, overrides.gasLevel
            )
        }
        
        let eip7702AuthChainId:bigint|null = null; 
        let eip7702AuthAddress:string|null = null; 
        let eip7702AuthNonce:bigint|null = null; 

        if(overrides.eip7702auth != null){
            eip7702AuthChainId = overrides.eip7702auth.chainId;
            eip7702AuthAddress = overrides.eip7702auth.address??
                Simple7702Account.DEFAULT_DELEGATEE_ADDRESS;
            eip7702AuthNonce = overrides.eip7702auth.nonce??null;
        }
        if(overrides.eip7702auth != null && eip7702AuthNonce == null){
            //check for eip7702AuthNonce
            let eip7702AuthNonceOp;
            if (providerRpc != null) {
                eip7702AuthNonceOp = sendJsonRpcRequest(
                    providerRpc,
                    "eth_getTransactionCount",
                    [this.accountAddress, "latest"]
                );
            } else {
                throw new AbstractionKitError(
                    "BAD_DATA",
                    "providerRpc cant't be null if eoaDelegatorNonce " +
                    "is not overriden",
                );
            }

            if(gasPriceOp != null && nonceOp != null){
                await Promise.all(
                    [eip7702AuthNonceOp, nonceOp, gasPriceOp]
                ).then((values) => {
                    eip7702AuthNonce = BigInt(values[0] as string);
                    nonce = values[1];
                    [maxFeePerGas, maxPriorityFeePerGas] = values[2]; 
                });
            }else if(gasPriceOp != null){
                await Promise.all(
                    [eip7702AuthNonceOp, gasPriceOp]
                ).then((values) => {
                    eip7702AuthNonce = BigInt(values[0] as string);
                    [maxFeePerGas, maxPriorityFeePerGas] = values[1]; 
                });
            }else if(nonceOp != null){
                await Promise.all(
                    [eip7702AuthNonceOp, gasPriceOp]
                ).then((values) => {
                    eip7702AuthNonce = BigInt(values[0] as string);
                    nonce = values[1];
                });
            }else{
                eip7702AuthNonce = BigInt(await eip7702AuthNonceOp as string);
            }
        }else{
            //don't check for eip7702AuthNonce
            if(gasPriceOp != null && nonceOp != null){
                await Promise.all([nonceOp, gasPriceOp]).then((values) => {
                    nonce = values[0];
                    [maxFeePerGas, maxPriorityFeePerGas] = values[1]; 
                });
            }else if(gasPriceOp != null){
                [maxFeePerGas, maxPriorityFeePerGas] = await gasPriceOp; 
            }else if(nonceOp != null){
                nonce = await nonceOp;
            }
        }
		maxFeePerGas =
			overrides.maxFeePerGas ??
			maxFeePerGas *
				BigInt(
					Math.floor(
						((overrides.maxFeePerGasPercentageMultiplier ?? 0) + 100) / 100,
					),
				);
		maxPriorityFeePerGas =
			overrides.maxPriorityFeePerGas ??
			maxPriorityFeePerGas *
				BigInt(
					Math.floor(
						((overrides.maxPriorityFeePerGasPercentageMultiplier ?? 0) + 100) /
							100,
					),
				);
        if(nonce == null){
			throw RangeError("failed to determine nonce");
        }
        else if (nonce < 0n) {
			throw RangeError("nonce can't be negative");
		}
        
        let callData = "0x" as string;
		if (overrides.callData == null) {
			if (transactions.length == 1) {
				callData = Simple7702Account.createAccountCallDataSingleTransaction(
					transactions[0],
				);
			} else {
				callData = Simple7702Account.createAccountCallDataBatchTransactions(
					transactions,
				);
			}
		} else {
			callData = overrides.callData;
		}
        
		let userOperation:UserOperationV7;
        if(overrides.eip7702auth != null){
            const yParity = overrides.eip7702auth.yParity?? "0x0";
            if(
                yParity != "0x0" && yParity != "0x00" &&
                yParity != "0x1" && yParity != "0x01"
            ){
                throw new AbstractionKitError(
                    "BAD_DATA",
                    "invalide yParity value for eoaDelegatorSignature. " +
                    "must be '0x0' or '0x1'"
                );
            }

            const authorization:Authorization7702Hex= {
                chainId: bigintToHex(eip7702AuthChainId as bigint),
                address: eip7702AuthAddress as string,
                nonce: bigintToHex(eip7702AuthNonce as bigint),
                yParity: yParity,
                r: overrides.eip7702auth.r??
                    "0x4277ba564d2c138823415df0ec8e8f97f30825056d54ec5128a8b29ec2dd81b2",
                s: overrides.eip7702auth.s??
                    "0x1075a1bec7f59848cca899ece93075199cd2aabceb0654b9ae00b881a30044cd",
            } 
            userOperation = {
                ...BaseUserOperationDummyValues,
                sender: this.accountAddress,
                nonce: nonce,
                callData: callData,
                maxFeePerGas: maxFeePerGas,
                maxPriorityFeePerGas: maxPriorityFeePerGas,
                factory: null,
                factoryData: null,
                paymaster: null,
                paymasterVerificationGasLimit: null,
                paymasterPostOpGasLimit: null,
                paymasterData: null,
                eip7702auth: authorization,
            };
        }else{
            userOperation = {
                ...BaseUserOperationDummyValues,
                sender: this.accountAddress,
                nonce: nonce,
                callData: callData,
                maxFeePerGas: maxFeePerGas,
                maxPriorityFeePerGas: maxPriorityFeePerGas,
                factory: null,
                factoryData: null,
                paymaster: null,
                paymasterVerificationGasLimit: null,
                paymasterPostOpGasLimit: null,
                paymasterData: null,
            };
        }
        let preVerificationGas = BaseUserOperationDummyValues.preVerificationGas;
		let verificationGasLimit =
			BaseUserOperationDummyValues.verificationGasLimit;
		let callGasLimit = BaseUserOperationDummyValues.callGasLimit;

		if (
			overrides.preVerificationGas == null ||
			overrides.verificationGasLimit == null ||
			overrides.callGasLimit == null
		) {
			if (bundlerRpc != null) {
				userOperation.callGasLimit = 0n;
				userOperation.verificationGasLimit = 0n;
				userOperation.preVerificationGas = 0n;
				const inputMaxFeePerGas = userOperation.maxFeePerGas;
				const inputMaxPriorityFeePerGas = userOperation.maxPriorityFeePerGas;
				userOperation.maxFeePerGas = 0n;
				userOperation.maxPriorityFeePerGas = 0n;

				let userOperationToEstimate: UserOperationV7;
                userOperationToEstimate = {
                    ...userOperation,
                    factory: null,
                    factoryData: null,
                    paymaster: null,
                    paymasterVerificationGasLimit: null,
                    paymasterPostOpGasLimit: null,
                    paymasterData: null,
                };

				userOperation.signature = overrides.dummySignature??
                    Simple7702Account.dummySignature;;
				[preVerificationGas, verificationGasLimit, callGasLimit] =
					await this.estimateUserOperationGas(
						userOperationToEstimate,
						bundlerRpc,
						{
							stateOverrideSet: overrides.state_override_set,
						},
					);
				verificationGasLimit += 55_000n;

				userOperation.maxFeePerGas = inputMaxFeePerGas;
				userOperation.maxPriorityFeePerGas = inputMaxPriorityFeePerGas;
			} else {
				throw new AbstractionKitError(
					"BAD_DATA",
					"bundlerRpc cant't be null if preVerificationGas," +
						"verificationGasLimit and callGasLimit are not overriden",
				);
			}
		}
		if (
			typeof overrides.preVerificationGas === "bigint" &&
			overrides.preVerificationGas < 0n
		) {
			throw RangeError("preVerificationGas overrid can't be negative");
		}

		if (
			typeof overrides.verificationGasLimit === "bigint" &&
			overrides.verificationGasLimit < 0n
		) {
			throw RangeError("verificationGasLimit overrid can't be negative");
		}

		if (
			typeof overrides.callGasLimit === "bigint" &&
			overrides.callGasLimit < 0n
		) {
			throw RangeError("callGasLimit overrid can't be negative");
		}

		userOperation.preVerificationGas =
			overrides.preVerificationGas ??
			preVerificationGas *
				BigInt(
					Math.floor(
						((overrides.preVerificationGasPercentageMultiplier ?? 0) + 100) /
							100,
					),
				);

		userOperation.verificationGasLimit =
			overrides.verificationGasLimit ??
			verificationGasLimit *
				BigInt(
					Math.floor(
						((overrides.verificationGasLimitPercentageMultiplier ?? 0) + 100) /
							100,
					),
				);

		userOperation.callGasLimit =
			overrides.callGasLimit ??
			callGasLimit *
				BigInt(
					Math.floor(
						((overrides.callGasLimitPercentageMultiplier ?? 0) + 100) / 100,
					),
				);

		return userOperation;
    }
    
    /**
	 * estimate gas limits for a useroperation
	 * @param userOperation - useroperation to estimate gas for
	 * @param bundlerRpc - bundler rpc for gas estimation
	 * @param overrides - overrides for the default values
	 * @param overrides.stateOverrideSet - state override values to set during gs estimation
	 * @param overrides.dummySignature - a single eoa dummy signature
	 * @returns promise with [preVerificationGas, verificationGasLimit, callGasLimit]
	 */
    public async estimateUserOperationGas(
		userOperation: UserOperationV7,
		bundlerRpc: string,
		overrides: {
			stateOverrideSet?: StateOverrideSet;
	        dummySignature?: string;
		} = {},
	): Promise<[bigint, bigint, bigint]> {
		userOperation.signature = overrides.dummySignature??
                    Simple7702Account.dummySignature;
		        
		const bundler = new Bundler(bundlerRpc);

		const inputMaxFeePerGas = userOperation.maxFeePerGas;
		const inputMaxPriorityFeePerGas = userOperation.maxPriorityFeePerGas;
		userOperation.maxFeePerGas = 0n;
		userOperation.maxPriorityFeePerGas = 0n;
		const estimation = await bundler.estimateUserOperationGas(
			userOperation,
			this.entrypointAddress,
			overrides.stateOverrideSet,
		);
		userOperation.maxFeePerGas = inputMaxFeePerGas;
		userOperation.maxPriorityFeePerGas = inputMaxPriorityFeePerGas;

		const preVerificationGas = BigInt(estimation.preVerificationGas);

		const verificationGasLimit = BigInt(estimation.verificationGasLimit);

		const callGasLimit = BigInt(estimation.callGasLimit);

		return [preVerificationGas, verificationGasLimit, callGasLimit];
	}
    
    /**
	 * create a useroperation signature
	 * @param useroperation - useroperation to sign
	 * @param privateKeys - for the signers
	 * @param chainId - target chain id
	 * @returns signature
	 */
    public signUserOperation(
		useroperation: UserOperationV7,
		privateKey: string,
		chainId: bigint,
    ): string {
		const userOperationHash = createUserOperationHash(
			useroperation,
            this.entrypointAddress,
			chainId,
        );

		const wallet = new Wallet(privateKey);
        return wallet.signingKey.sign(userOperationHash).serialized;
	}
    
    /**
	 * sends a useroperation to a bundler rpc
	 * @param userOperation - useroperation to send
	 * @param bundlerRpc - bundler rpc to send useroperation
	 * @returns promise with SendUseroperationResponse
	 */
	public async sendUserOperation(
		userOperation: UserOperationV7,
		bundlerRpc: string,
	): Promise<SendUseroperationResponse> {
		const bundler = new Bundler(bundlerRpc);
		const sendUserOperationRes = await bundler.sendUserOperation(
			userOperation,
			this.entrypointAddress,
		);

		return new SendUseroperationResponse(
			sendUserOperationRes,
			bundler,
			this.entrypointAddress,
		);
	}
}
