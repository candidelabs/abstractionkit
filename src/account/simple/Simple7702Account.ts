import { SmartAccount } from "../SmartAccount";
import { BaseUserOperationDummyValues, ENTRYPOINT_V8 } from "src/constants";
import { 
    createCallData, createUserOperationHash, fetchAccountNonce,
    getFunctionSelector, handlefetchGasPrice, sendJsonRpcRequest
} from "../../utils";
import { GasOption, PolygonChain, StateOverrideSet, UserOperationV8, UserOperationV9 } from "src/types";
import { AbstractionKitError } from "src/errors";
import { Authorization7702Hex, bigintToHex } from "src/utils7702";
import { Bundler } from "src/Bundler";
import { Wallet, AbiCoder } from "ethers";
import { SendUseroperationResponse } from "../SendUseroperationResponse";

/**
 * A minimal transaction object for EIP-7702 simple accounts.
 * Represents a single call with a target address, ETH value, and calldata.
 */
export interface SimpleMetaTransaction {
	/** Target contract or EOA address */
	to: string;
	/** Amount of native token (in wei) to send with the call */
	value: bigint;
	/** ABI-encoded calldata, or "0x" for plain ETH transfers */
	data: string;
}

/**
 * Optional overrides for UserOperation fields when calling
 * {@link BaseSimple7702Account.baseCreateUserOperation}.
 * Any field left undefined will be auto-determined (nonce fetched from RPC,
 * gas limits estimated via bundler, gas prices fetched from the network).
 */
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

	/** Override the dummy signature used during gas estimation */
	dummySignature?: string;

	/** Gas price level preference (e.g., slow, medium, fast) */
	gasLevel?: GasOption;
	/** Polygon chain identifier for fetching gas prices from Polygon Gas Station */
	polygonGasStation?: PolygonChain;

	/**
	 * EIP-7702 authorization fields. When provided, the UserOperation
	 * will include an authorization tuple that delegates the EOA to
	 * the account's delegatee contract. If address/nonce are omitted,
	 * defaults are used (delegateeAddress and fetched from RPC respectively).
	 */
    eip7702Auth?:{
        chainId: bigint;
        address?: string;
        nonce?: bigint;
        yParity?: string;
        r?: string;
        s?: string;
    };
}

/**
 * Abstract base class for EIP-7702 simple smart accounts.
 * Provides shared logic for creating, signing, and sending UserOperations
 * using the SimpleAccount execute/executeBatch interface. Subclasses
 * (e.g., {@link Simple7702Account}, {@link Simple7702AccountV09}) bind
 * a specific EntryPoint version and delegatee address.
 */
export class BaseSimple7702Account extends SmartAccount {
	/** Function selector for `execute(address,uint256,bytes)` */
	static readonly executorFunctionSelector = "0xb61d27f6"; //execute
	/** ABI parameter types for the single-call `execute` function */
	static readonly executorFunctionInputAbi: string[] = [
        "address", //dest
        "uint256", //value
        "bytes", //func
    ];
    /** Function selector for `executeBatch((address,uint256,bytes)[])` */
    static readonly batchExecutorFunctionSelector = "0x34fcd5be"; //executeBatch
	/** ABI parameter types for the batch `executeBatch` function */
	static readonly batchExecutorFunctionInputAbi = ["(address,uint256,bytes)[]"];
    /** Dummy ECDSA signature used during gas estimation */
    static readonly dummySignature =
        "0xd2614025fc173b86704caf37b2fb447f7618101a0d31f5f304c777024cef38a060a29ee43fcf0c46f9107d4f670b8a85c2c017a1fe9e4af891f24f0be6ba5d671c";

	/** The EntryPoint contract address this account targets */
	readonly entrypointAddress: string;
	/** The EIP-7702 delegatee (implementation) contract address */
	readonly delegateeAddress: string;

	/**
	 * @param accountAddress - The EOA address that will be delegated via EIP-7702
	 * @param entrypointAddress - The EntryPoint contract address
	 * @param delegateeAddress - The EIP-7702 delegatee (implementation) contract address
	 */
	constructor(
		accountAddress: string,
        entrypointAddress: string,
        delegateeAddress:string,
	) {
		super(accountAddress);
        this.entrypointAddress = entrypointAddress;
        this.delegateeAddress = delegateeAddress;
	}
    
    /**
	 * Encode calldata for a single `execute(address,uint256,bytes)` call.
	 * @param to - Target contract or EOA address
	 * @param value - Amount of native token (in wei) to transfer
	 * @param data - ABI-encoded calldata for the target
	 * @returns Encoded calldata for the execute function
	 */
    public static createAccountCallData(
		to: string,
		value: bigint,
		data: string,
	): string {
		const executorFunctionInputParameters = [to, value, data];
		const callData = createCallData(
			BaseSimple7702Account.executorFunctionSelector,
			BaseSimple7702Account.executorFunctionInputAbi,
			executorFunctionInputParameters,
		);
		return callData;
    }
    
    /**
	 * Encode calldata for a single {@link SimpleMetaTransaction} using `execute`.
	 * @param metaTransaction - The transaction to encode
	 * @returns Encoded calldata for the execute function
	 */
    public static createAccountCallDataSingleTransaction(
		metaTransaction: SimpleMetaTransaction,
	): string {
		const value = metaTransaction.value ?? 0;
		const data = metaTransaction.data ?? "0x";
		const executorFunctionCallData = BaseSimple7702Account.createAccountCallData(
			metaTransaction.to,
			value,
			data,
		);
		return executorFunctionCallData;
	}

    /**
	 * Encode calldata for a batch of {@link SimpleMetaTransaction}s using `executeBatch`.
	 * @param transactions - Array of transactions to batch
	 * @returns Encoded calldata for the executeBatch function
	 */
	public static createAccountCallDataBatchTransactions(
        transactions: SimpleMetaTransaction[]
    ): string {
        const encodedTransactions = [transactions.map(
            transaction => [transaction.to, transaction.value, transaction.data]
        )];
        const callData = createCallData(
			BaseSimple7702Account.batchExecutorFunctionSelector,
			BaseSimple7702Account.batchExecutorFunctionInputAbi,
			encodedTransactions,
		);
		return callData;
	}
    
    /**
	 * Build an unsigned UserOperation from one or more transactions.
	 * Determines nonce, fetches gas prices, estimates gas limits, and
	 * optionally includes EIP-7702 authorization. All auto-determined
	 * values can be overridden.
	 * @param transactions - One or more transactions to encode into callData
	 * @param providerRpc - JSON-RPC endpoint for nonce and gas price queries
	 * @param bundlerRpc - Bundler RPC endpoint for gas estimation
	 * @param overrides - Optional overrides for gas, nonce, and EIP-7702 auth fields
	 * @returns A promise resolving to an unsigned UserOperation (v8 or v9)
	 */
    protected async baseCreateUserOperation(
		transactions: SimpleMetaTransaction[],
		providerRpc?: string,
		bundlerRpc?: string,
		overrides: CreateUserOperationOverrides = {},
	): Promise<UserOperationV8 | UserOperationV9> {
        if (transactions.length < 1) {
			throw new RangeError("There should be at least one transaction");
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
			throw new RangeError("maxFeePerGas override can't be negative");
		}

		if (
			typeof overrides.maxPriorityFeePerGas === "bigint" &&
			overrides.maxPriorityFeePerGas < 0n
		) {
			throw new RangeError("maxPriorityFeePerGas override can't be negative");
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

        if(overrides.eip7702Auth != null){
            eip7702AuthChainId = overrides.eip7702Auth.chainId;
            eip7702AuthAddress = overrides.eip7702Auth.address??
                this.delegateeAddress;
            eip7702AuthNonce = overrides.eip7702Auth.nonce??null;
        }
        if(overrides.eip7702Auth != null && eip7702AuthNonce == null){
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
                    [eip7702AuthNonceOp, nonceOp]
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
		maxFeePerGas = overrides.maxFeePerGas ??
            BigInt(
                Math.floor(
                    Number(maxFeePerGas) *
                    (((overrides.maxFeePerGasPercentageMultiplier ?? 0) + 100) / 100)
				)
            );
		maxPriorityFeePerGas = overrides.maxPriorityFeePerGas ??
			BigInt(
				Math.floor(
					Number(maxPriorityFeePerGas) *
					(((overrides.maxPriorityFeePerGasPercentageMultiplier ?? 0) + 100) / 100)
				)
			);
        if(nonce == null){
			throw new RangeError("failed to determine nonce");
        }
        else if (nonce < 0n) {
			throw new RangeError("nonce can't be negative");
		}
        
        let callData = "0x" as string;
		if (overrides.callData == null) {
			if (transactions.length == 1) {
				callData = BaseSimple7702Account.createAccountCallDataSingleTransaction(
					transactions[0],
				);
			} else {
				callData = BaseSimple7702Account.createAccountCallDataBatchTransactions(
					transactions,
				);
			}
		} else {
			callData = overrides.callData;
		}
        
		let userOperation:UserOperationV8 | UserOperationV9;
        if(overrides.eip7702Auth != null){
            const yParity = overrides.eip7702Auth.yParity?? "0x0";
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
                r: overrides.eip7702Auth.r??
                    "0x4277ba564d2c138823415df0ec8e8f97f30825056d54ec5128a8b29ec2dd81b2",
                s: overrides.eip7702Auth.s??
                    "0x1075a1bec7f59848cca899ece93075199cd2aabceb0654b9ae00b881a30044cd",
            } 
            userOperation = {
                ...BaseUserOperationDummyValues,
                sender: this.accountAddress,
                nonce: nonce,
                callData: callData,
                maxFeePerGas: maxFeePerGas,
                maxPriorityFeePerGas: maxPriorityFeePerGas,
                factory: "0x7702",
                factoryData: null,
                paymaster: null,
                paymasterVerificationGasLimit: null,
                paymasterPostOpGasLimit: null,
                paymasterData: null,
                eip7702Auth: authorization,
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
                eip7702Auth: null,
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

				let userOperationToEstimate: UserOperationV8 | UserOperationV9;
                userOperationToEstimate = { ...userOperation };

				userOperation.signature = overrides.dummySignature??
                    BaseSimple7702Account.dummySignature;;
				[preVerificationGas, verificationGasLimit, callGasLimit] =
					await this.baseEstimateUserOperationGas(
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
			throw new RangeError("preVerificationGas override can't be negative");
		}

		if (
			typeof overrides.verificationGasLimit === "bigint" &&
			overrides.verificationGasLimit < 0n
		) {
			throw new RangeError("verificationGasLimit override can't be negative");
		}

		if (
			typeof overrides.callGasLimit === "bigint" &&
			overrides.callGasLimit < 0n
		) {
			throw new RangeError("callGasLimit override can't be negative");
		}

		userOperation.preVerificationGas = overrides.preVerificationGas ??
            BigInt(
                Math.floor(
                    Number(preVerificationGas) *
                    (((overrides.preVerificationGasPercentageMultiplier ?? 0) + 100) / 100)
                ),
            );

		userOperation.verificationGasLimit = overrides.verificationGasLimit ??
            BigInt(
                Math.floor(
                    Number(verificationGasLimit) *
                    (((overrides.verificationGasLimitPercentageMultiplier ?? 0) + 100) / 100)
                ),
            );

		userOperation.callGasLimit = overrides.callGasLimit ??
            BigInt(
                Math.floor(
                    Number(callGasLimit) *
                    (((overrides.callGasLimitPercentageMultiplier ?? 0) + 100) / 100)
                ),
            );

		return userOperation;
    }
    
    /**
	 * Estimate gas limits for a UserOperation via the bundler.
	 * @param userOperation - The UserOperation to estimate gas for
	 * @param bundlerRpc - Bundler RPC endpoint for gas estimation
	 * @param overrides - Optional overrides
	 * @param overrides.stateOverrideSet - State overrides to apply during estimation
	 * @param overrides.dummySignature - Custom dummy ECDSA signature for estimation
	 * @returns A promise resolving to `[preVerificationGas, verificationGasLimit, callGasLimit]`
	 */
    protected async baseEstimateUserOperationGas(
		userOperation: UserOperationV8 | UserOperationV9,
		bundlerRpc: string,
		overrides: {
			stateOverrideSet?: StateOverrideSet;
	        dummySignature?: string;
		} = {},
	): Promise<[bigint, bigint, bigint]> {
		userOperation.signature = overrides.dummySignature??
                    BaseSimple7702Account.dummySignature;
		        
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
	 * Sign a UserOperation with an EOA private key.
	 * Computes the UserOperation hash and produces an ECDSA signature.
	 * @param useroperation - The UserOperation to sign
	 * @param privateKey - Hex-encoded private key of the EOA signer
	 * @param chainId - Target chain ID
	 * @returns Hex-encoded ECDSA signature
	 */
    protected baseSignUserOperation(
		useroperation: UserOperationV8 | UserOperationV9,
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
	 * Submit a signed UserOperation to a bundler for on-chain inclusion.
	 * @param userOperation - The signed UserOperation to submit
	 * @param bundlerRpc - Bundler RPC endpoint
	 * @returns A {@link SendUseroperationResponse} that can be used to wait for inclusion
	 */
	protected async baseSendUserOperation(
		userOperation: UserOperationV8 | UserOperationV9,
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

    /**
	 * Prepend a token `approve` call to existing calldata for a token paymaster.
	 * Instance wrapper for {@link BaseSimple7702Account.prependTokenPaymasterApproveToCallDataStatic}.
	 * @param callData - Existing encoded calldata (execute or executeBatch)
	 * @param tokenAddress - ERC-20 token contract to approve
	 * @param paymasterAddress - Paymaster address to approve as spender
	 * @param approveAmount - Token amount to approve
	 * @returns Re-encoded calldata with the approve transaction prepended as a batch
	 */
	public prependTokenPaymasterApproveToCallData(
		callData: string,
		tokenAddress: string,
		paymasterAddress: string,
		approveAmount: bigint,
	): string {
		return BaseSimple7702Account.prependTokenPaymasterApproveToCallDataStatic(
			callData,
			tokenAddress,
			paymasterAddress,
			approveAmount,
		);
	}

    /**
	 * Prepend a token `approve` call to existing calldata for a token paymaster.
	 * Decodes the existing calldata, prepends an ERC-20 approve transaction,
	 * and re-encodes as a batch via `executeBatch`.
	 * @param callData - Existing encoded calldata (execute or executeBatch)
	 * @param tokenAddress - ERC-20 token contract to approve
	 * @param paymasterAddress - Paymaster address to approve as spender
	 * @param approveAmount - Token amount to approve
	 * @returns Re-encoded calldata with the approve transaction prepended as a batch
	 */
	public static prependTokenPaymasterApproveToCallDataStatic(
		callData: string,
		tokenAddress: string,
		paymasterAddress: string,
		approveAmount: bigint,
	): string {
		const approveFunctionSignature = "approve(address,uint256)";
		const approveFunctionSelector = getFunctionSelector(
			approveFunctionSignature,
		);
		const approveCallData = createCallData(
			approveFunctionSelector,
			["address", "uint256"],
			[paymasterAddress, approveAmount],
		);
		const approveMetatransaction: SimpleMetaTransaction = {
			to: tokenAddress,
			value: 0n,
			data: approveCallData,
		};

        const abiCoder = AbiCoder.defaultAbiCoder();
        let decodedMetaTransactions:SimpleMetaTransaction[];
		if (callData.startsWith(BaseSimple7702Account.batchExecutorFunctionSelector)) {
            const decodedParamsArray = abiCoder.decode(
                BaseSimple7702Account.batchExecutorFunctionInputAbi,
                "0x" + callData.slice(10)
            )[0] as [];
            decodedMetaTransactions = decodedParamsArray.map(decodedParams =>({
                to: decodedParams[0] as string,
                value: BigInt(decodedParams[1] as string),
                data: typeof decodedParams[2] !== "string"?
                    new TextDecoder().decode(decodedParams[2]):decodedParams[2]
            }));
        } else if(callData.startsWith(BaseSimple7702Account.executorFunctionSelector)) {
            const decodedParams = abiCoder.decode(
                BaseSimple7702Account.executorFunctionInputAbi,
                "0x" + callData.slice(10)
            );
            decodedMetaTransactions = [{
                to: decodedParams[0] as string,
                value: BigInt(decodedParams[1] as string),
                data: typeof decodedParams[2] !== "string"?
                    new TextDecoder().decode(decodedParams[2]):decodedParams[2]
            }];
        }else{
            throw new AbstractionKitError(
				"BAD_DATA",
				"Invalid calldata, should start with " +
					BaseSimple7702Account.batchExecutorFunctionSelector +
					" or " +
					BaseSimple7702Account.executorFunctionSelector,
				{
					context: {
						callData: callData,
					},
				},
			);
        }
        decodedMetaTransactions.unshift(approveMetatransaction);
        return BaseSimple7702Account.createAccountCallDataBatchTransactions(
            decodedMetaTransactions
        )
    }
}

/**
 * EIP-7702 simple smart account targeting EntryPoint v0.8
 * (`0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108`).
 * Wraps {@link BaseSimple7702Account} with concrete types for
 * {@link UserOperationV8} and sensible defaults for the delegatee address.
 */
export class Simple7702Account extends BaseSimple7702Account {
	static readonly DEFAULT_DELEGATEE_ADDRESS = "0xe6Cae83BdE06E4c305530e199D7217f42808555B";

	/**
	 * @param accountAddress - The EOA address that will be delegated via EIP-7702
	 * @param overrides - Optional overrides for entrypoint and delegatee addresses
	 * @param overrides.entrypointAddress - Custom EntryPoint address (defaults to EntryPoint v0.8)
	 * @param overrides.delegateeAddress - Custom delegatee contract address
	 */
	constructor(
		accountAddress: string,
        overrides: {
			entrypointAddress?: string;
            delegateeAddress?:string;
		} = {},
	) {
		super(
            accountAddress,
            overrides.entrypointAddress ?? ENTRYPOINT_V8,
            overrides.delegateeAddress ?? Simple7702Account.DEFAULT_DELEGATEE_ADDRESS
        );
	}

    /**
	 * Create a {@link UserOperationV8} for EntryPoint v0.8.
	 * Determines nonce, fetches gas prices, estimates gas limits, and returns
	 * an unsigned UserOperation. All auto-determined values can be overridden.
	 * @param transactions - One or more transactions to encode into callData
	 * @param providerRpc - JSON-RPC endpoint for nonce and gas price queries
	 * @param bundlerRpc - Bundler RPC endpoint for gas estimation
	 * @param overrides - Optional overrides for gas, nonce, and EIP-7702 auth fields
	 * @returns A promise resolving to an unsigned {@link UserOperationV8}
	 */
    public async createUserOperation(
		transactions: SimpleMetaTransaction[],
		providerRpc?: string,
		bundlerRpc?: string,
		overrides: CreateUserOperationOverrides = {},
	): Promise<UserOperationV8> {
        return this.baseCreateUserOperation(
            transactions,
            providerRpc,
            bundlerRpc,
            overrides,
        );
    }

    /**
	 * Estimate gas limits for a {@link UserOperationV8}.
	 * @param userOperation - The UserOperation to estimate gas for
	 * @param bundlerRpc - Bundler RPC endpoint for gas estimation
	 * @param overrides - Optional overrides
	 * @param overrides.stateOverrideSet - State overrides to apply during estimation
	 * @param overrides.dummySignature - Custom dummy signature for estimation
	 * @returns A promise resolving to `[preVerificationGas, verificationGasLimit, callGasLimit]`
	 */
    public async estimateUserOperationGas(
		userOperation: UserOperationV8,
		bundlerRpc: string,
		overrides: {
			stateOverrideSet?: StateOverrideSet;
	        dummySignature?: string;
		} = {},
	): Promise<[bigint, bigint, bigint]> {
        return this.baseEstimateUserOperationGas(
            userOperation,
            bundlerRpc,
            overrides
        );
    }

    /**
	 * Sign a {@link UserOperationV8} with an EOA private key.
	 * Computes the UserOperation hash and produces an ECDSA signature.
	 * @param useroperation - The UserOperation to sign
	 * @param privateKey - Hex-encoded private key of the EOA signer
	 * @param chainId - Target chain ID
	 * @returns Hex-encoded ECDSA signature
	 */
    public signUserOperation(
		useroperation: UserOperationV8,
		privateKey: string,
		chainId: bigint,
    ): string {
        return this.baseSignUserOperation(useroperation, privateKey, chainId);
    }

    /**
	 * Send a signed {@link UserOperationV8} to a bundler for on-chain inclusion.
	 * @param userOperation - The signed UserOperation to submit
	 * @param bundlerRpc - Bundler RPC endpoint
	 * @returns A {@link SendUseroperationResponse} that can be used to wait for inclusion
	 */
	public async sendUserOperation(
		userOperation: UserOperationV8,
		bundlerRpc: string,
	): Promise<SendUseroperationResponse> {
        return this.baseSendUserOperation(userOperation, bundlerRpc);
    }
}
