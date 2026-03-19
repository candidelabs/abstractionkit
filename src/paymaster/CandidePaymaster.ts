import { Paymaster } from "./Paymaster";
import { calculateUserOperationMaxGasCost, sendJsonRpcRequest } from "../utils";
import {
	UserOperationV6,
	UserOperationV7,
	UserOperationV8,
	UserOperationV9,
	SupportedERC20TokensAndMetadataV8,
	SupportedERC20TokensAndMetadataV7,
	SupportedERC20TokensAndMetadataV6,
	PmUserOperationV8Result,
	PmUserOperationV7Result,
	PmUserOperationV6Result,
	PaymasterMetadataV8,
	PaymasterMetadataV7,
	PaymasterMetadataV6,
	ERC20Token,
	SponsorMetadata,
	SupportedERC20TokensAndMetadataV8WithExchangeRate,
	SupportedERC20TokensAndMetadataV7WithExchangeRate,
	SupportedERC20TokensAndMetadataV6WithExchangeRate,
    SupportedERC20TokensAndMetadataV9,
} from "../types";
import {
	CandidePaymasterContext,
	PrependTokenPaymasterApproveAccount,
	PaymasterUserOperationOverrides,
} from "./types";
import { Bundler } from "src/Bundler";
import { AbstractionKitError, ensureError } from "src/errors";
import { ENTRYPOINT_V8, ENTRYPOINT_V7, ENTRYPOINT_V6, ENTRYPOINT_V9 } from "src/constants";

/**
 * Client for the Candide Paymaster service.
 * Supports both gas sponsorship (sponsor paymaster) and ERC-20 token payment for gas (token paymaster).
 * Auto-initializes on first use by fetching supported tokens and metadata from the paymaster RPC.
 *
 * Candide's paymaster endpoint follows the format:
 * - `https://api.candide.dev/api/v3/{chainId}/{apiKey}` (authenticated)
 * - `https://api.candide.dev/public/v3/{chainId}` (public, no key required)
 *
 * @example
 * const paymaster = new CandidePaymaster("https://api.candide.dev/public/v3/11155111");
 * const [sponsoredOp] = await paymaster.createSponsorPaymasterUserOperation(userOp, bundlerRpcUrl);
 */
export class CandidePaymaster extends Paymaster {
	/** The paymaster JSON-RPC endpoint URL */
	readonly rpcUrl: string;
	private version: "v3" | "v2" | undefined;
	private entrypointDataV9: SupportedERC20TokensAndMetadataV9 | undefined;
	private entrypointDataV8: SupportedERC20TokensAndMetadataV8 | undefined;
	private entrypointDataV7: SupportedERC20TokensAndMetadataV7 | undefined;
	private entrypointDataV6: SupportedERC20TokensAndMetadataV6 | undefined;
	private initialized = false;

	/** @param rpcUrl - The Candide paymaster JSON-RPC endpoint URL */
	constructor(rpcUrl: string) {
		super();
		this.rpcUrl = rpcUrl;
	}

	/**
	 * Fetch and cache the paymaster's supported tokens, EntryPoint addresses, and metadata.
	 * Called automatically on first use of other methods.
	 *
	 * @returns null
	 * @throws AbstractionKitError with code "PAYMASTER_ERROR" if initialization fails
	 */
	private async initialize(): Promise<null> {
		try {
			const paymasterVersionJsonRpcResult = (await sendJsonRpcRequest(
				this.rpcUrl,
				"pm_clientVersion",
				[],
			)) as string;

			if (paymasterVersionJsonRpcResult.startsWith("Candide/v3")) {
				this.version = "v3";
			} else if (paymasterVersionJsonRpcResult.startsWith("Candide/v2")) {
				this.version = "v2";
			} else {
				throw new RangeError(
					"Invalid paymaster version received from paymaster rpc",
				);
			}

			const supportedEntrypoints = await this.getSupportedEntrypointsLive();
			if (
				supportedEntrypoints.some(
					(x) => x.toLowerCase() === ENTRYPOINT_V8.toLowerCase(),
				)
			) {
				const supportedTokensAndMetadataResultV8 =
					await this.getSupportedERC20TokensAndPaymasterMetadata(ENTRYPOINT_V8);

				this.entrypointDataV8 =
					(supportedTokensAndMetadataResultV8 as SupportedERC20TokensAndMetadataV8) ??
					null;
			}

			if (
				supportedEntrypoints.some(
					(x) => x.toLowerCase() === ENTRYPOINT_V7.toLowerCase(),
				)
			) {
				const supportedTokensAndMetadataResultV7 =
					await this.getSupportedERC20TokensAndPaymasterMetadata(ENTRYPOINT_V7);

				this.entrypointDataV7 =
					(supportedTokensAndMetadataResultV7 as SupportedERC20TokensAndMetadataV7) ??
					null;
			}

			if (
				supportedEntrypoints.some(
					(x) => x.toLowerCase() === ENTRYPOINT_V6.toLowerCase(),
				)
			) {
				const supportedTokensAndMetadataResultV6 =
					await this.getSupportedERC20TokensAndPaymasterMetadata(ENTRYPOINT_V6);

				this.entrypointDataV6 =
					(supportedTokensAndMetadataResultV6 as SupportedERC20TokensAndMetadataV6) ??
					null;
			}

			if (
				this.entrypointDataV8 == null &&
				this.entrypointDataV7 == null &&
				this.entrypointDataV6 == null
			) {
				throw new RangeError("Invalid data received during initialization.");
			}
			this.initialized = true;
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

	private async getSupportedERC20TokensAndPaymasterMetadata(
		entrypoint: string,
	): Promise<
		| SupportedERC20TokensAndMetadataV8
		| SupportedERC20TokensAndMetadataV7
		| SupportedERC20TokensAndMetadataV6
		| null
	> {
		if (!this.initialized) {
			try {
				let jsonRpcResult;
				if (this.version == "v3") {
					jsonRpcResult = await sendJsonRpcRequest(
						this.rpcUrl,
						"pm_supportedERC20Tokens",
						[entrypoint],
					);
				} else {
					jsonRpcResult = await sendJsonRpcRequest(
						this.rpcUrl,
						"pm_supportedERC20Tokens",
						[],
					);
				}
				if (entrypoint == ENTRYPOINT_V8) {
					jsonRpcResult = jsonRpcResult as SupportedERC20TokensAndMetadataV8;
					return {
						tokens: jsonRpcResult.tokens.map((gasToken) => ({
							name: gasToken.name,
							symbol: gasToken.symbol,
							address: gasToken.address,
							decimals: Number(gasToken.decimals),
							//exchangeRate: BigInt(gasToken.exchangeRate),
						})),
						paymasterMetadata: jsonRpcResult.paymasterMetadata,
					};
				} else if (entrypoint == ENTRYPOINT_V7) {
					jsonRpcResult = jsonRpcResult as SupportedERC20TokensAndMetadataV7;
					return {
						tokens: jsonRpcResult.tokens.map((gasToken) => ({
							name: gasToken.name,
							symbol: gasToken.symbol,
							address: gasToken.address,
							decimals: Number(gasToken.decimals),
							//exchangeRate: BigInt(gasToken.exchangeRate),
						})),
						paymasterMetadata: jsonRpcResult.paymasterMetadata,
					};
				} else if (entrypoint == ENTRYPOINT_V6) {
					jsonRpcResult = jsonRpcResult as SupportedERC20TokensAndMetadataV6;
					return {
						tokens: jsonRpcResult.tokens.map((gasToken) => ({
							name: gasToken.name,
							symbol: gasToken.symbol,
							address: gasToken.address,
							decimals: Number(gasToken.decimals),
							//exchangeRate: BigInt(gasToken.exchangeRate),
						})),
						paymasterMetadata: jsonRpcResult.paymasterMetadata,
					};
				} else {
					throw new RangeError("unsupported entrypoint.");
				}
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
			if (entrypoint == ENTRYPOINT_V8) {
				return this.entrypointDataV8 ?? null;
			} else if (entrypoint == ENTRYPOINT_V7) {
				return this.entrypointDataV7 ?? null;
			} else if (entrypoint == ENTRYPOINT_V6) {
				return this.entrypointDataV6 ?? null;
			}
		}
		return null;
	}

	private async getSupportedEntrypointsLive(): Promise<string[]> {
		try {
			if (this.version == "v3") {
				const supportedEntrypoints = await sendJsonRpcRequest(
					this.rpcUrl,
					"pm_supportedEntryPoints",
					[],
				);

				return supportedEntrypoints as string[];
			} else {
				const supportedEntrypoint = await sendJsonRpcRequest(
					this.rpcUrl,
					"pm_supportedEntryPoint",
					[],
				);

				return [supportedEntrypoint] as string[];
			}
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
	}

	/**
	 * Get the EntryPoint addresses supported by this paymaster.
	 * Auto-initializes if not yet initialized.
	 *
	 * @returns Array of supported EntryPoint contract addresses
	 */
	async getSupportedEntrypoints(): Promise<string[]> {
		if (!this.initialized) {
			await this.initialize();
		}
		const supportedEntrypoints = [];
		if (this.entrypointDataV8 != null) {
			supportedEntrypoints.push(ENTRYPOINT_V8);
		}
		if (this.entrypointDataV7 != null) {
			supportedEntrypoints.push(ENTRYPOINT_V7);
		}
		if (this.entrypointDataV6 != null) {
			supportedEntrypoints.push(ENTRYPOINT_V6);
		}
		return supportedEntrypoints;
	}

	/**
	 * Get the paymaster contract metadata for a specific EntryPoint.
	 * Auto-initializes if not yet initialized.
	 *
	 * @param entrypoint - Target EntryPoint address
	 * @returns The paymaster metadata (name, address, icons, dummyPaymasterAndData, etc.)
	 * @throws RangeError if the entrypoint is not supported
	 */
	async getPaymasterMetaData(
		entrypoint: string,
	): Promise<PaymasterMetadataV8 | PaymasterMetadataV7 | PaymasterMetadataV6 | null> {
		if (!this.initialized) {
			await this.initialize();
		}

		if (entrypoint == ENTRYPOINT_V8 && this.entrypointDataV8 != null) {
			return this.entrypointDataV8.paymasterMetadata;
		} else if (entrypoint == ENTRYPOINT_V7 && this.entrypointDataV7 != null) {
			return this.entrypointDataV7.paymasterMetadata;
		} else if (entrypoint == ENTRYPOINT_V6 && this.entrypointDataV6 != null) {
			return this.entrypointDataV6.paymasterMetadata;
		} else {
			throw new RangeError("unsupported entrypoint.");
		}
	}

	/**
	 * Check if the token paymaster supports a given ERC-20 token for gas payment.
	 *
	 * @param erc20TokenAddress - The ERC-20 token contract address to check
	 * @param entrypoint - Target EntryPoint address (default: ENTRYPOINT_V7)
	 * @returns true if the token is supported, false otherwise
	 */
	async isSupportedERC20Token(
		erc20TokenAddress: string,
		entrypoint: string = ENTRYPOINT_V7,
	): Promise<boolean> {
		const gasToken = this.getSupportedERC20TokenData(
			erc20TokenAddress,
			entrypoint,
		);
		if (!gasToken) {
			return false;
		} else {
			return true;
		}
	}

	/**
	 * Get the paymaster's data for a specific ERC-20 token.
	 *
	 * @param erc20TokenAddress - The ERC-20 token contract address
	 * @param entrypoint - Target EntryPoint address (default: ENTRYPOINT_V7)
	 * @returns The token data (name, symbol, address, decimals), or null if not supported
	 * @throws RangeError if the entrypoint is not supported
	 */
	async getSupportedERC20TokenData(
		erc20TokenAddress: string,
		entrypoint: string = ENTRYPOINT_V7,
	): Promise<ERC20Token | null> {
		if (!this.initialized) {
			await this.initialize();
		}
		let supportedTokens: ERC20Token[];
		if (entrypoint == ENTRYPOINT_V8 && this.entrypointDataV8 != null) {
			supportedTokens = this.entrypointDataV8.tokens;
		} else if (entrypoint == ENTRYPOINT_V7 && this.entrypointDataV7 != null) {
			supportedTokens = this.entrypointDataV7.tokens;
		} else if (entrypoint == ENTRYPOINT_V6 && this.entrypointDataV6 != null) {
			supportedTokens = this.entrypointDataV6.tokens;
		} else {
			throw new RangeError("unsupported entrypoint.");
		}

		const gasToken = supportedTokens.find(
			(token) =>
				token.address.toLowerCase() === erc20TokenAddress.toLowerCase(),
		);

		if (!gasToken) {
			return null;
		} else {
			return {
				name: gasToken.name,
				symbol: gasToken.symbol,
				address: gasToken.address,
				decimals: Number(gasToken.decimals),
				//exchangeRate: BigInt(gasToken.exchangeRate),
			};
		}
	}

	/**
	 * Estimate gas, set paymaster fields, and return a paymaster-ready UserOperation.
	 * Gas limits will only increase if the bundler estimation exceeds the input values.
	 * Gas overrides and multipliers are applied after estimation.
	 *
	 * @param userOperation - The UserOperation to sponsor
	 * @param bundlerRpc - Bundler RPC URL for gas estimation
	 * @param context - Paymaster context (e.g., `{ token: "0x..." }` for token paymaster)
	 * @param overrides - Override gas limits and multipliers
	 * @returns A tuple of [UserOperation, SponsorMetadata | undefined]
	 * @throws AbstractionKitError with code "PAYMASTER_ERROR" if sponsorship fails
	 */
	async createPaymasterUserOperation(
		smartAccount: PrependTokenPaymasterApproveAccount,
		userOperation: UserOperationV9,
		bundlerRpc: string,
		context?: CandidePaymasterContext,
		overrides?: PaymasterUserOperationOverrides,
	): Promise<[UserOperationV9, SponsorMetadata | undefined]>;
	async createPaymasterUserOperation(
		smartAccount: PrependTokenPaymasterApproveAccount,
		userOperation: UserOperationV8,
		bundlerRpc: string,
		context?: CandidePaymasterContext,
		overrides?: PaymasterUserOperationOverrides,
	): Promise<[UserOperationV8, SponsorMetadata | undefined]>;
	async createPaymasterUserOperation(
		smartAccount: PrependTokenPaymasterApproveAccount,
		userOperation: UserOperationV7,
		bundlerRpc: string,
		context?: CandidePaymasterContext,
		overrides?: PaymasterUserOperationOverrides,
	): Promise<[UserOperationV7, SponsorMetadata | undefined]>;
	async createPaymasterUserOperation(
		smartAccount: PrependTokenPaymasterApproveAccount,
		userOperation: UserOperationV6,
		bundlerRpc: string,
		context?: CandidePaymasterContext,
		overrides?: PaymasterUserOperationOverrides,
	): Promise<[UserOperationV6, SponsorMetadata | undefined]>;
	async createPaymasterUserOperation(
		smartAccount: PrependTokenPaymasterApproveAccount,
		userOperation: UserOperationV9 | UserOperationV8 | UserOperationV7 | UserOperationV6,
		bundlerRpc: string,
		context?: CandidePaymasterContext,
		overrides?: PaymasterUserOperationOverrides
	): Promise<
		[
			UserOperationV9 | UserOperationV8 | UserOperationV7 | UserOperationV6,
			SponsorMetadata | undefined,
		]
	> {
		if (context == null) {
			context = {};
		}
		let gasUserOperationOverrides =
			overrides as PaymasterUserOperationOverrides;
		if (gasUserOperationOverrides == null) {
			gasUserOperationOverrides = {};
		}
		userOperation = { ...userOperation };
		if (!this.initialized) {
			await this.initialize();
		}
		let sponsorMetadata = undefined;
		try {
			let entrypointAddress = smartAccount.entrypointAddress;
            if ("initCode" in userOperation) {
                if (this.entrypointDataV6 == null) {
                    throw new RangeError("UserOperation v0.06 is not supported");
                }
                if(entrypointAddress.toLowerCase() != ENTRYPOINT_V6.toLowerCase()){
                    throw new RangeError("Invalid useroperation for account entrypoint.");
                }
                const paymasterMetadata = this.entrypointDataV6.paymasterMetadata;
                userOperation.paymasterAndData =
                    paymasterMetadata.dummyPaymasterAndData;
            } else if ("eip7702Auth" in userOperation) {
                let paymasterMetadata;
                if(entrypointAddress.toLowerCase() == ENTRYPOINT_V9.toLowerCase()){
                    if (this.entrypointDataV9 == null) {
                        throw new RangeError("UserOperation v0.09 is not supported");
                    }
                    paymasterMetadata = this.entrypointDataV9.paymasterMetadata;
                } else if(entrypointAddress.toLowerCase() == ENTRYPOINT_V8.toLowerCase()){
                    if (this.entrypointDataV8 == null) {
                        throw new RangeError("UserOperation v0.08 is not supported");
                    }
                    paymasterMetadata = this.entrypointDataV8.paymasterMetadata;
                } else{
                    throw new RangeError("Invalid useroperation for account entrypoint.");
                }

                const paymasterAndData = paymasterMetadata.dummyPaymasterAndData;
                userOperation.paymaster = paymasterAndData.paymaster;
                userOperation.paymasterVerificationGasLimit =
                    paymasterAndData.paymasterVerificationGasLimit;
                userOperation.paymasterPostOpGasLimit =
                    paymasterAndData.paymasterPostOpGasLimit;
                userOperation.paymasterData = paymasterAndData.paymasterData;
            } else {
                if (this.entrypointDataV7 == null) {
                    throw new RangeError("UserOperation v0.07 is not supported");
                }
				if(entrypointAddress.toLowerCase() != ENTRYPOINT_V7.toLowerCase()){
                    throw new RangeError("Invalid useroperation for account entrypoint.");
                }

                const paymasterMetadata = this.entrypointDataV7.paymasterMetadata;
                const paymasterAndData = paymasterMetadata.dummyPaymasterAndData;
                userOperation.paymaster = paymasterAndData.paymaster;
                userOperation.paymasterVerificationGasLimit =
                    paymasterAndData.paymasterVerificationGasLimit;
                userOperation.paymasterPostOpGasLimit =
                    paymasterAndData.paymasterPostOpGasLimit;
                userOperation.paymasterData = paymasterAndData.paymasterData;
            }
			//only estimate gas if:
			//1- paymaster v2 (only supports entrypoint v0.06)
			//2- token paymaster v3 (supports both entrypoints)
			//don't estimate gas for v3 (it will be overridden by the paymaster anyway)
			if (this.version == "v2" || context.token !== undefined) {
				let preVerificationGas = userOperation.preVerificationGas;
				let verificationGasLimit = userOperation.verificationGasLimit;
				let callGasLimit = userOperation.callGasLimit;

				//call the bundler to estimate gas if one of the gas overrides
				//is not provided
				if (
					gasUserOperationOverrides.preVerificationGas == null ||
					gasUserOperationOverrides.verificationGasLimit == null ||
					gasUserOperationOverrides.callGasLimit == null
				) {
					if (bundlerRpc != null) {
						const bundler = new Bundler(bundlerRpc);

						userOperation.callGasLimit = 0n;
						userOperation.verificationGasLimit = 0n;
						userOperation.preVerificationGas = 0n;
						const inputMaxFeePerGas = userOperation.maxFeePerGas;
						const inputMaxPriorityFeePerGas =
							userOperation.maxPriorityFeePerGas;
						userOperation.maxFeePerGas = 0n;
						userOperation.maxPriorityFeePerGas = 0n;
						const estimation = await bundler.estimateUserOperationGas(
							userOperation,
							entrypointAddress as string,
							gasUserOperationOverrides.state_override_set,
						);

						// only change gas limits if the estimated limits is higher than
						// the supplied
						if (preVerificationGas < estimation.preVerificationGas) {
							preVerificationGas = estimation.preVerificationGas;
						}
						if (verificationGasLimit < estimation.verificationGasLimit) {
							verificationGasLimit = estimation.verificationGasLimit;
						}
						if (callGasLimit < estimation.callGasLimit) {
							callGasLimit = estimation.callGasLimit;
						}

						userOperation.maxFeePerGas = inputMaxFeePerGas;
						userOperation.maxPriorityFeePerGas = inputMaxPriorityFeePerGas;
					} else {
						throw new AbstractionKitError(
							"BAD_DATA",
							"bundlerRpc can't be null if preVerificationGas,verificationGasLimit and callGasLimit are not overridden",
						);
					}
				}

				//check gas overrides type and range
				if (
					typeof gasUserOperationOverrides.preVerificationGas === "bigint" &&
					gasUserOperationOverrides.preVerificationGas < 0n
				) {
					throw new RangeError("preVerificationGas override can't be negative");
				}

				if (
					typeof gasUserOperationOverrides.verificationGasLimit === "bigint" &&
					gasUserOperationOverrides.verificationGasLimit < 0n
				) {
					throw new RangeError("verificationGasLimit override can't be negative");
				}

				if (
					typeof gasUserOperationOverrides.callGasLimit === "bigint" &&
					gasUserOperationOverrides.callGasLimit < 0n
				) {
					throw new RangeError("callGasLimit override can't be negative");
				}

				//apply gas overrides
				userOperation.preVerificationGas = gasUserOperationOverrides.preVerificationGas ??
                    BigInt(
                        Math.floor(
                            Number(preVerificationGas) *
                            (((gasUserOperationOverrides.preVerificationGasPercentageMultiplier ?? 0) + 100) / 100)
                        )
                    );

				userOperation.verificationGasLimit = gasUserOperationOverrides.verificationGasLimit ??
                   BigInt(
                        Math.floor(
                            Number(verificationGasLimit) *
                            (((gasUserOperationOverrides.verificationGasLimitPercentageMultiplier ?? 0) + 100) / 100)
                        )
                    );

				userOperation.callGasLimit = gasUserOperationOverrides.callGasLimit ??
                    BigInt(
                        Math.floor(
                            Number(callGasLimit) *
                            (((gasUserOperationOverrides.callGasLimitPercentageMultiplier ?? 0) + 100) / 100)
                        )
                    );

				//add small buffer to preVerification gas
				userOperation.preVerificationGas =
					userOperation.preVerificationGas + 100n;
				//add gas to compensate for paymasterAndData verification overhead
				userOperation.verificationGasLimit =
					userOperation.verificationGasLimit + 10000n;
			} else {
				//gas limits overrides are useless with the sponsor paymaster v3
				if (
					gasUserOperationOverrides.preVerificationGas != null ||
					gasUserOperationOverrides.verificationGasLimit != null ||
					gasUserOperationOverrides.callGasLimit != null ||
					gasUserOperationOverrides.preVerificationGasPercentageMultiplier !=
						null ||
					gasUserOperationOverrides.verificationGasLimitPercentageMultiplier !=
						null ||
					gasUserOperationOverrides.callGasLimitPercentageMultiplier != null
				) {
					throw new RangeError(
						"you can't use any gas overrides for paymaster v3," +
							" as it will estimate gas and override any provided values.",
					);
				}
			}

			// call the paymaster rpc to sponsor the UserOperation
			const jsonRpcResult = await sendJsonRpcRequest(
				this.rpcUrl,
				"pm_sponsorUserOperation",
				[userOperation, entrypointAddress, context],
			);
			const result = jsonRpcResult as
				| PmUserOperationV8Result
				| PmUserOperationV7Result
				| PmUserOperationV6Result;
			const resultMod = {
				//paymasterAndData: result.paymasterAndData,
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
				sponsorMetadata:
					result.sponsorMetadata == null ? undefined : result.sponsorMetadata,
			};

			//override gas limits and gas prices if the paymaster modified them
			//needed in case the paymaster modifies the UserOperation before
			//generating the paymasterAndData
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
			sponsorMetadata = resultMod.sponsorMetadata;

			if ("initCode" in userOperation) {
				const result = jsonRpcResult as PmUserOperationV6Result;

				userOperation.paymasterAndData = result.paymasterAndData;
			} else {
				const result = jsonRpcResult as
					| PmUserOperationV8Result
					| PmUserOperationV7Result;

				userOperation.paymaster = result.paymaster;
				userOperation.paymasterVerificationGasLimit = BigInt(
					result.paymasterVerificationGasLimit,
				);
				userOperation.paymasterPostOpGasLimit = BigInt(
					result.paymasterPostOpGasLimit,
				);
				userOperation.paymasterData = result.paymasterData;
			}

			return [userOperation, sponsorMetadata];
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
	 * Convenience wrapper around createPaymasterUserOperation with sponsor context.
	 *
	 * @param smartAccount - The smart account instance (must implement prependTokenPaymasterApproveToCallData)
	 * @param userOperation - The UserOperation to sponsor
	 * @param bundlerRpc - Bundler RPC URL for gas estimation
	 * @param sponsorshipPolicyId - Optional sponsorship policy ID
	 * @param overrides - Override gas limits and multipliers
	 * @returns A tuple of [UserOperation, SponsorMetadata | undefined]
	 * @throws AbstractionKitError with code "PAYMASTER_ERROR" if sponsorship fails
	 */
	async createSponsorPaymasterUserOperation(
		smartAccount: PrependTokenPaymasterApproveAccount,
		userOperation: UserOperationV9,
		bundlerRpc: string,
		sponsorshipPolicyId?: string,
		overrides?: PaymasterUserOperationOverrides,
	): Promise<[UserOperationV9, SponsorMetadata | undefined]>;
	async createSponsorPaymasterUserOperation(
		smartAccount: PrependTokenPaymasterApproveAccount,
		userOperation: UserOperationV8,
		bundlerRpc: string,
		sponsorshipPolicyId?: string,
		overrides?: PaymasterUserOperationOverrides,
	): Promise<[UserOperationV8, SponsorMetadata | undefined]>;
	async createSponsorPaymasterUserOperation(
		smartAccount: PrependTokenPaymasterApproveAccount,
		userOperation: UserOperationV7,
		bundlerRpc: string,
		sponsorshipPolicyId?: string,
		overrides?: PaymasterUserOperationOverrides,
	): Promise<[UserOperationV7, SponsorMetadata | undefined]>;
	async createSponsorPaymasterUserOperation(
		smartAccount: PrependTokenPaymasterApproveAccount,
		userOperation: UserOperationV6,
		bundlerRpc: string,
		sponsorshipPolicyId?: string,
		overrides?: PaymasterUserOperationOverrides,
	): Promise<[UserOperationV6, SponsorMetadata | undefined]>;
	async createSponsorPaymasterUserOperation(
		smartAccount: PrependTokenPaymasterApproveAccount,
		userOperation: UserOperationV7 | UserOperationV6,
		bundlerRpc: string,
		sponsorshipPolicyId?: string,
		overrides?: PaymasterUserOperationOverrides,
	): Promise<
		[
			UserOperationV9 | UserOperationV8 | UserOperationV7 | UserOperationV6,
			SponsorMetadata | undefined,
		]
	> {
		const context: CandidePaymasterContext = {};
		if (sponsorshipPolicyId && sponsorshipPolicyId.trim().length > 0) {
			context["sponsorshipPolicyId"] = sponsorshipPolicyId;
		}
		if ("initCode" in userOperation) {
			return await this.createPaymasterUserOperation(
                smartAccount,
				userOperation as UserOperationV6,
				bundlerRpc,
				context,
				overrides,
			);
		} else if ("eip7702Auth" in userOperation) {
			return await this.createPaymasterUserOperation(
                smartAccount,
				userOperation as UserOperationV9 | UserOperationV8,
				bundlerRpc,
				context,
				overrides,
			);
		} else {
			return await this.createPaymasterUserOperation(
                smartAccount,
				userOperation as UserOperationV7,
				bundlerRpc,
				context,
				overrides,
			);
		}
	}

	/**
	 * Create a UserOperation that pays for gas with an ERC-20 token.
	 * Automatically prepends a token approval to the calldata and sets paymaster fields.
	 *
	 * @param smartAccount - The smart account instance (must implement prependTokenPaymasterApproveToCallData)
	 * @param userOperation - The UserOperation to modify for token payment
	 * @param tokenAddress - The ERC-20 token contract address to pay gas with
	 * @param bundlerRpc - Bundler RPC URL for gas estimation
	 * @param overrides - Override gas limits and multipliers
	 * @returns The UserOperation with token approval prepended and paymaster fields set
	 * @throws AbstractionKitError with code "PAYMASTER_ERROR" if the token is not supported
	 */
	async createTokenPaymasterUserOperation(
		smartAccount: PrependTokenPaymasterApproveAccount,
		userOperation: UserOperationV8,
		tokenAddress: string,
		bundlerRpc: string,
		overrides?: PaymasterUserOperationOverrides,
	): Promise<UserOperationV8>;
	async createTokenPaymasterUserOperation(
		smartAccount: PrependTokenPaymasterApproveAccount,
		userOperation: UserOperationV7,
		tokenAddress: string,
		bundlerRpc: string,
		overrides?: PaymasterUserOperationOverrides,
	): Promise<UserOperationV7>;
	async createTokenPaymasterUserOperation(
		smartAccount: PrependTokenPaymasterApproveAccount,
		userOperation: UserOperationV6,
		tokenAddress: string,
		bundlerRpc: string,
		overrides?: PaymasterUserOperationOverrides,
	): Promise<UserOperationV6>;
	async createTokenPaymasterUserOperation(
		smartAccount: PrependTokenPaymasterApproveAccount,
		userOperation: UserOperationV8 | UserOperationV7 | UserOperationV6,
		tokenAddress: string,
		bundlerRpc: string,
		overrides?: PaymasterUserOperationOverrides,
	): Promise<UserOperationV8 | UserOperationV7 | UserOperationV6> {
		try {
			if (!this.initialized) {
				await this.initialize();
			}
			const _overrides = { ...(overrides || {}),
				callGasLimitPercentageMultiplier: overrides?.callGasLimitPercentageMultiplier ?? 105,
			};
			let entrypoint = smartAccount.entrypointAddress;
			const maxErc20Cost =
				await this.calculateUserOperationErc20TokenMaxGasCost(
					userOperation,
					tokenAddress,
				);

			const approveAmount = maxErc20Cost * 2n; //for the extra cost of the paymasterAndData

			const metadata = await this.getPaymasterMetaData(entrypoint);

			if (metadata == null) {
				throw new RangeError("unsupported entrypoint.");
			}

			const paymasterAddress = metadata.address;

			const callDataWithApprove =
				smartAccount.prependTokenPaymasterApproveToCallData(
					userOperation.callData,
					tokenAddress,
					paymasterAddress,
					approveAmount,
				);
			userOperation.callData = callDataWithApprove;

			if ("initCode" in userOperation) {
				const [resultUserOp] = await this.createPaymasterUserOperation(
                    smartAccount,
					userOperation as UserOperationV6,
					bundlerRpc,
					{
						token: tokenAddress,
					},
					_overrides,
				);
				return resultUserOp;
			} else if ("eip7702Auth" in userOperation) {
				const [resultUserOp] = await this.createPaymasterUserOperation(
                    smartAccount,
				    userOperation as UserOperationV9 | UserOperationV8,
					bundlerRpc,
					{
						token: tokenAddress,
					},
					_overrides,
				);
				return resultUserOp;
			} else {
				const [resultUserOp] = await this.createPaymasterUserOperation(
                    smartAccount,
					userOperation as UserOperationV7,
					bundlerRpc,
					{
						token: tokenAddress,
					},
					_overrides,
				);
				return resultUserOp;
			}
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
	 * @param overrides - Optional entrypoint override
	 * @returns Maximum token cost as a bigint (in token's smallest unit)
	 * @throws AbstractionKitError with code "PAYMASTER_ERROR" if the token is not supported
	 */
	async calculateUserOperationErc20TokenMaxGasCost(
		userOperation: UserOperationV8 | UserOperationV7 | UserOperationV6,
		erc20TokenAddress: string,
		overrides: { entrypoint?: string | null } = {},
	): Promise<bigint> {
		try {
			if (!this.initialized) {
				await this.initialize();
			}
			let entrypoint = overrides.entrypoint;
			if (entrypoint == null) {
				if ("initCode" in userOperation) {
					entrypoint = ENTRYPOINT_V6;
				} else if ("eip7702Auth" in userOperation) {
					entrypoint = ENTRYPOINT_V8;
				} else {
					entrypoint = ENTRYPOINT_V7;
				}
			}
			const exchangeRate = await this.fetchTokenPaymasterExchangeRate(
				erc20TokenAddress,
				entrypoint,
			);
			const cost = calculateUserOperationMaxGasCost(userOperation);
			return (exchangeRate * cost) / BigInt(10 ** 18);
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

	/**
	 * Fetch the current exchange rate for an ERC-20 token from the paymaster.
	 *
	 * @param erc20TokenAddress - The ERC-20 token contract address
	 * @param entrypoint - Target EntryPoint address (default: ENTRYPOINT_V7)
	 * @returns The exchange rate as a bigint
	 * @throws AbstractionKitError with code "PAYMASTER_ERROR" if the token is not supported
	 */
	async fetchTokenPaymasterExchangeRate(
		erc20TokenAddress: string,
		entrypoint: string = ENTRYPOINT_V7,
	): Promise<bigint> {
		try {
			if (!this.initialized) {
				await this.initialize();
			}

			let jsonRpcResult;
			if (this.version == "v3") {
				jsonRpcResult = await sendJsonRpcRequest(
					this.rpcUrl,
					"pm_supportedERC20Tokens",
					[entrypoint],
				);
			} else {
				jsonRpcResult = await sendJsonRpcRequest(
					this.rpcUrl,
					"pm_supportedERC20Tokens",
					[],
				);
			}

			jsonRpcResult = jsonRpcResult as
				| SupportedERC20TokensAndMetadataV7WithExchangeRate
				| SupportedERC20TokensAndMetadataV6WithExchangeRate;

			const supportedTokensExchangeRates = jsonRpcResult.tokens.map(
				(gasToken) => ({
					address: gasToken.address,
					exchangeRate: gasToken.exchangeRate,
				}),
			);

			const gasToken = supportedTokensExchangeRates.find(
				(token) =>
					token.address.toLowerCase() === erc20TokenAddress.toLowerCase(),
			);

			if (!gasToken) {
				throw new AbstractionKitError(
					"PAYMASTER_ERROR",
					erc20TokenAddress + " token is not supported by the paymaster.",
					{
						context: {
							supportedERC20TokensAndPaymasterMetadataV7: JSON.stringify(
								this.entrypointDataV7,
								(_key, value) =>
									typeof value === "bigint" ? "0x" + value.toString(16) : value,
							),
							supportedERC20TokensAndPaymasterMetadataV6: JSON.stringify(
								this.entrypointDataV6,
								(_key, value) =>
									typeof value === "bigint" ? "0x" + value.toString(16) : value,
							),
						},
					},
				);
			} else {
				return BigInt(gasToken.exchangeRate);
			}
		} catch (err) {
			const error = ensureError(err);

			throw new AbstractionKitError(
				"PAYMASTER_ERROR",
				"fetchTokenPaymasterExchangeRate failed",
				{
					cause: error,
				},
			);
		}
	}

	/**
	 * Fetch fresh supported ERC-20 tokens with exchange rates and paymaster metadata.
	 * Unlike the cached version, this always makes an RPC call.
	 *
	 * @param entrypoint - Target EntryPoint address (default: ENTRYPOINT_V7)
	 * @returns Supported tokens with exchange rates and paymaster metadata
	 * @throws AbstractionKitError with code "PAYMASTER_ERROR" if the call fails
	 */
	async fetchSupportedERC20TokensAndPaymasterMetadata(
		entrypoint: string = ENTRYPOINT_V7,
	): Promise<
		| SupportedERC20TokensAndMetadataV8WithExchangeRate
		| SupportedERC20TokensAndMetadataV7WithExchangeRate
		| SupportedERC20TokensAndMetadataV6WithExchangeRate
	> {
		try {
			if (!this.initialized) {
				await this.initialize();
			}

			let jsonRpcResult;
			if (this.version == "v3") {
				jsonRpcResult = await sendJsonRpcRequest(
					this.rpcUrl,
					"pm_supportedERC20Tokens",
					[entrypoint],
				);
			} else {
				jsonRpcResult = await sendJsonRpcRequest(
					this.rpcUrl,
					"pm_supportedERC20Tokens",
					[],
				);
			}

			if (entrypoint == ENTRYPOINT_V8 || entrypoint == ENTRYPOINT_V7) {
				jsonRpcResult =
					jsonRpcResult as SupportedERC20TokensAndMetadataV7WithExchangeRate;
				return {
					tokens: jsonRpcResult.tokens.map((gasToken) => ({
						name: gasToken.name,
						symbol: gasToken.symbol,
						address: gasToken.address,
						decimals: Number(gasToken.decimals),
						exchangeRate: BigInt(gasToken.exchangeRate),
					})),
					paymasterMetadata: jsonRpcResult.paymasterMetadata,
				};
			} else if (entrypoint == ENTRYPOINT_V6) {
				jsonRpcResult =
					jsonRpcResult as SupportedERC20TokensAndMetadataV6WithExchangeRate;
				return {
					tokens: jsonRpcResult.tokens.map((gasToken) => ({
						name: gasToken.name,
						symbol: gasToken.symbol,
						address: gasToken.address,
						decimals: Number(gasToken.decimals),
						exchangeRate: BigInt(gasToken.exchangeRate),
					})),
					paymasterMetadata: jsonRpcResult.paymasterMetadata,
				};
			} else {
				throw new RangeError("unsupported entrypoint.");
			}
		} catch (err) {
			const error = ensureError(err);

			throw new AbstractionKitError(
				"PAYMASTER_ERROR",
				"fetchSupportedERC20TokensAndPaymasterMetadata failed",
				{
					cause: error,
				},
			);
		}
	}
}
