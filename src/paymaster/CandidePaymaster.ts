import { Paymaster } from "./Paymaster";
import {
    calculateUserOperationMaxGasCost,
    sendJsonRpcRequest
} from "../utils";
import {
	UserOperation,
	SupportedERC20TokensAndMetadata,
	PmUserOperationResult,
	PaymasterMetadata,
	ERC20Token,
} from "../types";
import {
	CandidePaymasterContext,
	PrependTokenPaymasterApproveAccount,
    CreatePaymasterUserOperationOverrides
} from "./types";
import { Bundler } from "src/Bundler";
import { AbstractionKitError, ensureError } from "src/errors";

/**
 * Client for the Candide Paymaster service.
 * Supports both gas sponsorship (sponsor paymaster) and ERC-20 token payment for gas (token paymaster).
 * Auto-initializes on first use by fetching supported tokens and metadata from the paymaster RPC.
 *
 * @example
 * const paymaster = new CandidePaymaster("https://paymaster.example.com/rpc");
 * // Sponsor gas:
 * const sponsoredOp = await paymaster.createSponsorPaymasterUserOperation(userOp, bundlerRpcUrl);
 * // Pay gas with ERC-20:
 * const tokenOp = await paymaster.createTokenPaymasterUserOperation(smartAccount, userOp, tokenAddress, bundlerRpcUrl);
 */
export class CandidePaymaster extends Paymaster {
	/** The paymaster JSON-RPC endpoint URL */
	readonly rpcUrl: string;
	private entrypointAddress: string | undefined;
	private supportedTokens: ERC20Token[] | undefined;
	private paymasterMetadata: PaymasterMetadata | undefined;

	/**
	 * @param rpcUrl - The Candide paymaster JSON-RPC endpoint URL
	 */
	constructor(rpcUrl: string) {
		super();
		this.rpcUrl = rpcUrl;
	}

	/**
	 * Fetch and cache the paymaster's supported tokens, EntryPoint address, and metadata.
	 * Called automatically on first use of other methods, but can be called explicitly to pre-warm.
	 *
	 * @returns null
	 * @throws AbstractionKitError with code "PAYMASTER_ERROR" if initialization fails
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

	/**
	 * Get the paymaster contract metadata (name, address, icons, etc.).
	 * Auto-initializes if not yet initialized.
	 *
	 * @returns The paymaster metadata
	 */
	async getPaymasterMetaData(): Promise<PaymasterMetadata> {
		if (this.paymasterMetadata == null) {
			await this.initialize();
		}
		return this.paymasterMetadata as PaymasterMetadata;
	}

	/**
	 * Get the list of supported ERC-20 tokens and paymaster metadata.
	 * Returns cached data after first call.
	 *
	 * @returns Object containing paymaster metadata and array of supported ERC-20 tokens
	 * @throws AbstractionKitError with code "PAYMASTER_ERROR" if the RPC call fails
	 */
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

	/**
	 * Get the EntryPoint address supported by this paymaster.
	 * Returns cached data after first call.
	 *
	 * @returns The supported EntryPoint contract address
	 * @throws AbstractionKitError with code "PAYMASTER_ERROR" if the RPC call fails
	 */
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
	 * Check if the token paymaster supports a given ERC-20 token for gas payment.
	 *
	 * @param erc20TokenAddress - The ERC-20 token contract address to check
	 * @returns true if the token is supported, false otherwise
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
	 * Get the paymaster's data for a specific ERC-20 token (symbol, exchange rate, fee, etc.).
	 *
	 * @param erc20TokenAddress - The ERC-20 token contract address
	 * @returns The token data, or null if the token is not supported
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
	 * Estimate gas, set paymasterAndData, and return a paymaster-ready UserOperation.
	 * Gas limits will only increase if the bundler estimation exceeds the input values.
	 * Gas overrides and multipliers are applied after estimation.
	 *
	 * @param userOperation - The UserOperation to sponsor
	 * @param bundlerRpc - Bundler RPC URL for gas estimation
	 * @param context - Paymaster context (e.g., `{ token: "0x..." }` for token paymaster)
	 * @param createPaymasterUserOperationOverrides - Override gas limits and multipliers
	 * @returns The UserOperation with paymasterAndData and gas limits set
	 * @throws AbstractionKitError with code "PAYMASTER_ERROR" if sponsorship fails
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

                    userOperation.callGasLimit = 0n
                    userOperation.verificationGasLimit = 0n
                    userOperation.preVerificationGas = 0n
                    const inputMaxFeePerGas = userOperation.maxFeePerGas
                    const inputMaxPriorityFeePerGas = userOperation.maxPriorityFeePerGas
                    userOperation.maxFeePerGas = 0n
                    userOperation.maxPriorityFeePerGas = 0n
                    const estimation =
                        await bundler.estimateUserOperationGas(
                            userOperation,
                            this.entrypointAddress as string,
                            createPaymasterUserOperationOverrides.state_override_set,
                        );

                    // only change gas limits if the esitmated limits is higher than
                    // the supplied
                    if(preVerificationGas < estimation.preVerificationGas){
                        preVerificationGas = estimation.preVerificationGas;
                    }
                    if(verificationGasLimit < estimation.verificationGasLimit){
                        verificationGasLimit = estimation.verificationGasLimit;
                    }
                    if(callGasLimit < estimation.callGasLimit){
                        callGasLimit = estimation.callGasLimit;
                    }

                    userOperation.maxFeePerGas = inputMaxFeePerGas
                    userOperation.maxPriorityFeePerGas = inputMaxPriorityFeePerGas
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
	 * Create a gas-sponsored UserOperation (no token payment required).
	 * Convenience wrapper around createPaymasterUserOperation with an empty context.
	 *
	 * @param userOperation - The UserOperation to sponsor
	 * @param bundlerRpc - Bundler RPC URL for gas estimation
	 * @param createPaymasterUserOperationOverrides - Override gas limits and multipliers
	 * @returns The UserOperation with paymasterAndData and gas limits set
	 * @throws AbstractionKitError with code "PAYMASTER_ERROR" if sponsorship fails
	 *
	 * @example
	 * const paymaster = new CandidePaymaster(paymasterRpcUrl);
	 * const sponsoredOp = await paymaster.createSponsorPaymasterUserOperation(userOp, bundlerRpcUrl);
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
	 * Create a UserOperation that pays for gas with an ERC-20 token.
	 * Automatically prepends a token approval to the calldata and sets paymasterAndData.
	 *
	 * @param smartAccount - The smart account instance (must implement prependTokenPaymasterApproveToCallData)
	 * @param userOperation - The UserOperation to modify for token payment
	 * @param tokenAddress - The ERC-20 token contract address to pay gas with
	 * @param bundlerRpc - Bundler RPC URL for gas estimation
	 * @param createPaymasterUserOperationOverrides - Override gas limits and multipliers
	 * @returns The UserOperation with token approval prepended and paymasterAndData set
	 * @throws AbstractionKitError with code "PAYMASTER_ERROR" if the token is not supported or the operation fails
	 *
	 * @example
	 * const paymaster = new CandidePaymaster(paymasterRpcUrl);
	 * const tokenOp = await paymaster.createTokenPaymasterUserOperation(
	 *   smartAccount, userOp, "0xTokenAddress", bundlerRpcUrl,
	 * );
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

	/**
	 * Calculate the maximum ERC-20 token cost for a UserOperation's gas.
	 * Uses the token's exchange rate from the paymaster to convert from wei.
	 *
	 * @param userOperation - The UserOperation to calculate the cost for
	 * @param erc20TokenAddress - The ERC-20 token contract address
	 * @returns Maximum token cost as a bigint (in token's smallest unit)
	 * @throws AbstractionKitError with code "PAYMASTER_ERROR" if the token is not supported
	 */
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
								(_key, value) =>
									typeof value === "bigint" ? "0x" + value.toString(16) : value
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
