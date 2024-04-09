import { Paymaster } from "./Paymaster";
import { calculateUserOperationMaxGasCost, sendJsonRpcRequest } from "../utils";
import {
	UserOperation,
	SupportedERC20TokensAndMetadata,
	PmUserOperationResult,
	PaymasterMetadata,
	ERC20Token,
	StateOverrideSet,
} from "../types";
import {
	CandidePaymasterContext,
	PrependTokenPaymasterApproveAccount,
    CreatePaymasterUserOperationOverrides
} from "./types";
import { Bundler } from "src/Bundler";
import { AbstractionKitError, ensureError } from "src/errors";

export class CandidePaymaster extends Paymaster {
	readonly rpcUrl: string;
	private entrypointAddress: string | undefined;
	private supportedTokens: ERC20Token[] | undefined;
	private paymasterMetadata: PaymasterMetadata | undefined;

	constructor(rpcUrl: string) {
		super();
		this.rpcUrl = rpcUrl;
	}

	/**
	 * initialize the paymaster object the paymaster supported tokens,
	 * entrypoint and metadata from the bundler url
	 * @returns null
	 */
	async initialize(): Promise<null> {
		try {
			this.entrypointAddress = await this.getSupportedEntrypoint();

			const supportedTokensResult =
				await this.getSupportedERC20TokensAndPaymasterMetadata();

			this.supportedTokens = supportedTokensResult.tokens;
			this.paymasterMetadata = supportedTokensResult.paymasterMetadata;

			return null;
		} catch (err) {
			const error = ensureError(err);

			throw new AbstractionKitError(
				"PAYMASTER_ERROR",
				"failed initializing the paymaster",
				{
					cause: error,
				},
			);
		}
	}

	async getPaymasterMetaData(): Promise<PaymasterMetadata> {
		if (this.paymasterMetadata == null) {
			await this.initialize();
		}
		return this.paymasterMetadata as PaymasterMetadata;
	}

	async getSupportedERC20TokensAndPaymasterMetadata(): Promise<SupportedERC20TokensAndMetadata> {
		if (this.supportedTokens == null || this.paymasterMetadata == null) {
			try {
				const jsonRpcResult = (await sendJsonRpcRequest(
					this.rpcUrl,
					"pm_supportedERC20Tokens",
					[],
				)) as SupportedERC20TokensAndMetadata;

				return {
					tokens: jsonRpcResult.tokens.map((gasToken) => ({
						symbol: gasToken.symbol,
						address: gasToken.address,
						decimal: Number(gasToken.decimal),
						fee: BigInt(gasToken.fee),
						exchangeRate: BigInt(gasToken.exchangeRate),
					})),
					paymasterMetadata: jsonRpcResult.paymasterMetadata,
				};
			} catch (err) {
				const error = ensureError(err);

				throw new AbstractionKitError(
					"PAYMASTER_ERROR",
					"getSupportedERC20TokensAndPaymasterMetadata failed",
					{
						cause: error,
					},
				);
			}
		} else {
			return {
				tokens: this.supportedTokens,
				paymasterMetadata: this.paymasterMetadata,
			};
		}
	}

	async getSupportedEntrypoint(): Promise<string> {
		if (this.entrypointAddress == null) {
			try {
				const supportedEntrypoint = await sendJsonRpcRequest(
					this.rpcUrl,
					"pm_supportedEntryPoint",
					[],
				);

				return supportedEntrypoint as string;
			} catch (err) {
				const error = ensureError(err);

				throw new AbstractionKitError(
					"PAYMASTER_ERROR",
					"getSupportedEntrypoint failed",
					{
						cause: error,
					},
				);
			}
		} else {
			return this.entrypointAddress;
		}
	}

	/**
	 * check if the token paymaster accepts an erc20 token
	 * @param erc20TokenAddress - token address to check if supported
	 */
	async isSupportedERC20Token(erc20TokenAddress: string): Promise<boolean> {
		if (
			this.entrypointAddress == null ||
			this.supportedTokens == null ||
			this.paymasterMetadata == null
		) {
			await this.initialize();
		}
		const supportedTokens = this.supportedTokens as ERC20Token[];
		const gasToken = supportedTokens.find(
			(token) =>
				token.address.toLowerCase() === erc20TokenAddress.toLowerCase(),
		);

		if (!gasToken) {
			return false;
		} else {
			return true;
		}
	}

	/**
	 * get the paymaster token data
	 * @param erc20TokenAddress - token to get data for
	 * @returns ERC20Token or null
	 */
	async getSupportedERC20TokenData(
		erc20TokenAddress: string,
	): Promise<ERC20Token | null> {
		if (
			this.entrypointAddress == null ||
			this.supportedTokens == null ||
			this.paymasterMetadata == null
		) {
			await this.initialize();
		}
		const supportedTokens = this.supportedTokens as ERC20Token[];
		const gasToken = supportedTokens.find(
			(token) =>
				token.address.toLowerCase() === erc20TokenAddress.toLowerCase(),
		);

		if (!gasToken) {
			return null;
		} else {
			return {
				symbol: gasToken.symbol,
				address: gasToken.address,
				decimal: Number(gasToken.decimal),
				fee: BigInt(gasToken.fee),
				exchangeRate: BigInt(gasToken.exchangeRate),
			};
		}
	}

	/**
	 * createPaymasterUserOperation will estimate gas and set
	 * paymasterAndData
	 * @param useroperation - useroperation to add paymaster support for
	 * @param bundlerRpc - bundler rpc for gas estimation
	 * @param context - paymaster context data
	 * @param state_override_set - state override values to set during gs estimation
	 * @returns promise with UserOperation
	 */
	async createPaymasterUserOperation(
		userOperation: UserOperation,
		bundlerRpc: string,
		context: CandidePaymasterContext = {},
        createPaymasterUserOperationOverrides:CreatePaymasterUserOperationOverrides = {}
	): Promise<UserOperation> {
		if (
			this.entrypointAddress == null ||
			this.supportedTokens == null ||
			this.paymasterMetadata == null
		) {
			await this.initialize();
		}
		try {

			const paymasterMetadata = this.paymasterMetadata as PaymasterMetadata;
			userOperation.paymasterAndData = paymasterMetadata.dummyPaymasterAndData;

            let preVerificationGas = userOperation.preVerificationGas;
            let verificationGasLimit = userOperation.verificationGasLimit;
            let callGasLimit = userOperation.callGasLimit;

            //call the bundler to estimate gas if one of the gas overrides
            //is not provided
            if (
                createPaymasterUserOperationOverrides.preVerificationGas == null ||
                createPaymasterUserOperationOverrides.verificationGasLimit == null ||
                createPaymasterUserOperationOverrides.callGasLimit == null
            ) {

				if (bundlerRpc != null) {
                    const bundler = new Bundler(bundlerRpc);

                    const estimation =
                        await bundler.estimateUserOperationGas(
                            userOperation,
                            this.entrypointAddress as string,
                            createPaymasterUserOperationOverrides.state_override_set,
                        );

						preVerificationGas = estimation.preVerificationGas;
                    verificationGasLimit = estimation.verificationGasLimit;
                    callGasLimit = estimation.callGasLimit;
                } else {
                    throw new AbstractionKitError(
                        "BAD_DATA",
                        "bundlerRpc cant't be null if preVerificationGas,verificationGasLimit and callGasLimit are not overriden",
                    );
                }
            }

			//check gas overrides type and range
            if (
                typeof createPaymasterUserOperationOverrides.preVerificationGas === "bigint" &&
                createPaymasterUserOperationOverrides.preVerificationGas < 0n
            ) {
                throw RangeError("preVerificationGas overrid can't be negative");
            }

            if (
                typeof createPaymasterUserOperationOverrides.verificationGasLimit === "bigint" &&
                createPaymasterUserOperationOverrides.verificationGasLimit < 0n
            ) {
                throw RangeError("verificationGasLimit overrid can't be negative");
            }

            if (
                typeof createPaymasterUserOperationOverrides.callGasLimit === "bigint" &&
                createPaymasterUserOperationOverrides.callGasLimit < 0n
            ) {
                throw RangeError("callGasLimit overrid can't be negative");
            }

			//apply gas overrides
            userOperation.preVerificationGas =
                createPaymasterUserOperationOverrides.preVerificationGas ??
                (
					preVerificationGas *
                    BigInt(                       
                            ((createPaymasterUserOperationOverrides.preVerificationGasPercentageMultiplier ?? 0) + 100)
                    )
				)/100n;

				userOperation.verificationGasLimit =
                createPaymasterUserOperationOverrides.verificationGasLimit ??
                (
					verificationGasLimit *
                    BigInt(                       
                            ((createPaymasterUserOperationOverrides.verificationGasLimitPercentageMultiplier ?? 0) + 100)
                    )
				)/100n;

			userOperation.callGasLimit =
			createPaymasterUserOperationOverrides.callGasLimit ??
			(
				callGasLimit *
				BigInt(                       
						((createPaymasterUserOperationOverrides.callGasLimitPercentageMultiplier ?? 0) + 100)
				)
			)/100n;
            
            //add small buffer to preVerification gas
			userOperation.preVerificationGas = userOperation.preVerificationGas + 100n;
            //add gas to compensate for paymasterAndData verification overhead
			userOperation.verificationGasLimit =
				userOperation.verificationGasLimit + 10000n;

            //call the paymaster rpc to sponsor the useroperation
			const jsonRpcResult = await sendJsonRpcRequest(
				this.rpcUrl,
				"pm_sponsorUserOperation",
				[userOperation, this.entrypointAddress, context],
	        );

			const result = jsonRpcResult as PmUserOperationResult;
			const resultMod = {
				paymasterAndData: result.paymasterAndData,
                //the paymaster may decide to override the gas prices and gas limits
				callGasLimit:
					result.callGasLimit == null ? undefined : BigInt(result.callGasLimit),
				preVerificationGas:
					result.preVerificationGas == null
						? undefined
						: BigInt(result.preVerificationGas),
				verificationGasLimit:
					result.verificationGasLimit == null
						? undefined
						: BigInt(result.verificationGasLimit),
				maxFeePerGas:
					result.maxFeePerGas == null ? undefined : BigInt(result.maxFeePerGas),
				maxPriorityFeePerGas:
					result.maxPriorityFeePerGas == null
						? undefined
						: BigInt(result.maxPriorityFeePerGas),
			};
    
            //override gas limits and gas prices if the paymaster modified them
            //needed in case the paymaster modifies the useroperation before
            //generating the paymasterAndData 
			userOperation.paymasterAndData = resultMod.paymasterAndData;
			userOperation.callGasLimit =
				resultMod.callGasLimit ?? userOperation.callGasLimit;
			userOperation.preVerificationGas =
				resultMod.preVerificationGas ?? userOperation.preVerificationGas;
			userOperation.verificationGasLimit =
				resultMod.verificationGasLimit ?? userOperation.verificationGasLimit;
			userOperation.maxFeePerGas =
				resultMod.maxFeePerGas ?? userOperation.maxFeePerGas;
			userOperation.maxPriorityFeePerGas =
				resultMod.maxPriorityFeePerGas ?? userOperation.maxPriorityFeePerGas;

			return userOperation;
		} catch (err) {
			const error = ensureError(err);

			throw new AbstractionKitError(
				"PAYMASTER_ERROR",
				"pm_sponsorUserOperation failed",
				{
					cause: error,
				},
			);
		}
	}

	/**
	 * createSponsorPaymasterUserOperation will estimate gas and set
	 * paymasterAndData for a sponsor paymaster operation
	 * @param useroperation - useroperation to add paymaster support for
	 * @param bundlerRpc - bundler rpc for gas estimation
	 * @param state_override_set - state override values to set during gs estimation
	 * @returns promise with UserOperation
	 */
	async createSponsorPaymasterUserOperation(
		userOperation: UserOperation,
		bundlerRpc: string,
        createPaymasterUserOperationOverrides:CreatePaymasterUserOperationOverrides = {}
	): Promise<UserOperation> {
		return await this.createPaymasterUserOperation(
			userOperation,
			bundlerRpc,
			{},
			createPaymasterUserOperationOverrides,
		);
	}

	/**
	 * createPaymasterUserOperation will estimate gas and set
	 * paymasterAndData
	 * @param smartAccount - the SmartAccount object that created the target useroperation
	 * @param useroperation - useroperation to add paymaster support for
	 * @param tokenAddress - target token to pay gas with
	 * @param bundlerRpc - bundler rpc for gas estimation
	 * @param state_override_set - state override values to set during gs estimation
	 * @returns promise with UserOperation
	 */
	async createTokenPaymasterUserOperation(
		smartAccount: PrependTokenPaymasterApproveAccount,
		userOperation: UserOperation,
		tokenAddress: string,
		bundlerRpc: string,
        createPaymasterUserOperationOverrides:CreatePaymasterUserOperationOverrides = {}
	): Promise<UserOperation> {
		try {
			const maxErc20Cost =
				await this.calculateUserOperationErc20TokenMaxGasCost(
					userOperation,
					tokenAddress,
				);

			const approveAmount = maxErc20Cost * 2n; //for the extra cost of the paymasterAndData

			let metadata = await this.getPaymasterMetaData();

			metadata = metadata as PaymasterMetadata;
			const paymasterAddress = metadata.address;

			const callDataWithApprove =
				smartAccount.prependTokenPaymasterApproveToCallData(
					userOperation.callData,
					tokenAddress,
					paymasterAddress,
					approveAmount,
				);
			userOperation.callData = callDataWithApprove;

			return await this.createPaymasterUserOperation(
				userOperation,
				bundlerRpc,
				{
					token: tokenAddress,
				},
				createPaymasterUserOperationOverrides,
			);
		} catch (err) {
			const error = ensureError(err);

			throw new AbstractionKitError(
				"PAYMASTER_ERROR",
				"createTokenPaymasterUserOperation failed",
				{
					cause: error,
				},
			);
		}
	}

	async calculateUserOperationErc20TokenMaxGasCost(
		userOperation: UserOperation,
		erc20TokenAddress: string,
	): Promise<bigint> {
		try {
			const supportedERC20TokensData = await this.getSupportedERC20TokenData(
				erc20TokenAddress,
			);
			if (supportedERC20TokensData == null) {
				throw new AbstractionKitError(
					"PAYMASTER_ERROR",
					erc20TokenAddress + " token is not supported by the paymaster.",
					{
						context: {
							supportedERC20TokensAndPaymasterMetadata: JSON.stringify(
								await this.getSupportedERC20TokensAndPaymasterMetadata(),
							),
						},
					},
				);
			} else {
				const cost = calculateUserOperationMaxGasCost(userOperation);
				const tokenCost =
					(supportedERC20TokensData.exchangeRate * cost) / BigInt(10 ** 18);
				return tokenCost;
			}
		} catch (err) {
			const error = ensureError(err);

			throw new AbstractionKitError(
				"PAYMASTER_ERROR",
				"calculateUserOperationErc20TokenMaxGasCost failed",
				{
					cause: error,
				},
			);
		}
	}
}
