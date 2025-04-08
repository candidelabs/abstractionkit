import { Paymaster } from "./Paymaster";
import { calculateUserOperationMaxGasCost, sendJsonRpcRequest } from "../utils";
import {
	UserOperationV6,
	UserOperationV7,
	UserOperationV8,
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
} from "../types";
import {
	CandidePaymasterContext,
	PrependTokenPaymasterApproveAccount,
	GasPaymasterUserOperationOverrides, BasePaymasterUserOperationOverrides
} from "./types";
import { Bundler } from "src/Bundler";
import { AbstractionKitError, ensureError } from "src/errors";
import { ENTRYPOINT_V8, ENTRYPOINT_V7, ENTRYPOINT_V6 } from "src/constants";

export class CandidePaymaster extends Paymaster {
	readonly rpcUrl: string;
	private version: "v3" | "v2" | "v1" | undefined;
	private entrypointDataV8: SupportedERC20TokensAndMetadataV8 | undefined;
	private entrypointDataV7: SupportedERC20TokensAndMetadataV7 | undefined;
	private entrypointDataV6: SupportedERC20TokensAndMetadataV6 | undefined;
	private initialized = false;

	constructor(rpcUrl: string) {
		super();
		this.rpcUrl = rpcUrl;
	}

	/**
	 * initialize the paymaster object the paymaster supported tokens,
	 * entrypoint and metadata from the bundler url
	 * @returns null
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
			} else if (paymasterVersionJsonRpcResult.startsWith("Candide/v1")) {
				this.version = "v1";
			} else {
				throw RangeError(
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
				throw RangeError("Invalid data received during initialization.");
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
		SupportedERC20TokensAndMetadataV8 | 
		SupportedERC20TokensAndMetadataV7 | 
        SupportedERC20TokensAndMetadataV6 |
        null
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
					throw RangeError("unsupported entrypoint.");
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
	 * gets the entrypoints that the paymaster supports,
	 * @returns a promise of a list of entrypoints addresses
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
			throw RangeError("unsupported entrypoint.");
		}
	}

	/**
	 * check if the token paymaster accepts an erc20 token
	 * @param erc20TokenAddress - token address to check if supported
	 * @param entrypoint - target entrypoint address
	 * @returns a promise of a boolean(true if the token is supported)
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
	 * get the paymaster token data
	 * @param erc20TokenAddress - token to get data for
	 * @param entrypoint - target entrypoint address
	 * @returns promise of ERC20Token or null
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
			throw RangeError("unsupported entrypoint.");
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
	 * createPaymasterUserOperation will estimate gas and set paymasterAndData.
	 * gas limits will only change if the estimated gas limits returned by
	 * the bundler is more than the input gas limits, then gas overrides
	 * and multipliers will be applied
	 * @param userOperation - User operation that requests the paymaster sponsorship
	 * @param bundlerRpc - Bundler endpoint rpc url
	 * @param context - Paymaster context data
	 * @param overrides - Overrides for the default values
	 * @returns a promise of [UserOperationV8 | UserOperationV7 | UserOperationV6, SponsorMetadata | undefined]
	 */
    async createPaymasterUserOperation(
		userOperation: UserOperationV8,
		bundlerRpc: string,
		context?: CandidePaymasterContext,
		overrides?: BasePaymasterUserOperationOverrides | GasPaymasterUserOperationOverrides,
	): Promise<[UserOperationV8, SponsorMetadata | undefined]>;
	async createPaymasterUserOperation(
		userOperation: UserOperationV7,
		bundlerRpc: string,
		context?: CandidePaymasterContext,
		overrides?: BasePaymasterUserOperationOverrides | GasPaymasterUserOperationOverrides,
	): Promise<[UserOperationV7, SponsorMetadata | undefined]>;
	async createPaymasterUserOperation(
		userOperation: UserOperationV6,
		bundlerRpc: string,
		context?: CandidePaymasterContext,
		overrides?: BasePaymasterUserOperationOverrides | GasPaymasterUserOperationOverrides,
	): Promise<[UserOperationV6, SponsorMetadata | undefined]>;
	async createPaymasterUserOperation(
		userOperation: UserOperationV8 | UserOperationV7 | UserOperationV6,
		bundlerRpc: string,
		context?: CandidePaymasterContext,
		overrides?: BasePaymasterUserOperationOverrides | GasPaymasterUserOperationOverrides,
	): Promise<[
        UserOperationV8 | UserOperationV7 | UserOperationV6,
        SponsorMetadata | undefined
    ]> {
		if (context == null) {
			context = {};
		}
		let gasUserOperationOverrides = overrides as GasPaymasterUserOperationOverrides;
		if (gasUserOperationOverrides == null) {
			gasUserOperationOverrides = {};
		}
		userOperation = { ...userOperation };
		if (!this.initialized) {
			await this.initialize();
		}
		let sponsorMetadata = undefined;
		try {
			let entrypointAddress = gasUserOperationOverrides.entrypoint;
            if(entrypointAddress == null){
                if ("initCode" in userOperation) {
                    if (this.entrypointDataV6 == null) {
                        throw RangeError("UserOperation v0.06 is not supported");
                    }
                    entrypointAddress = ENTRYPOINT_V6;

                    const paymasterMetadata = this.entrypointDataV6.paymasterMetadata;
                    userOperation.paymasterAndData =
                        paymasterMetadata.dummyPaymasterAndData;
                } else if ("eip7702Auth" in userOperation) {
                    if (this.entrypointDataV8 == null) {
                        throw RangeError("UserOperation v0.08 is not supported");
                    }
                    entrypointAddress = ENTRYPOINT_V8;

                    const paymasterMetadata = this.entrypointDataV8.paymasterMetadata;
                    const paymasterAndData = paymasterMetadata.dummyPaymasterAndData;
                    userOperation.paymaster = paymasterAndData.paymaster;
                    userOperation.paymasterVerificationGasLimit =
                        paymasterAndData.paymasterVerificationGasLimit;
                    userOperation.paymasterPostOpGasLimit =
                        paymasterAndData.paymasterPostOpGasLimit;
                    userOperation.paymasterData = paymasterAndData.paymasterData;
                } else {
                    if (this.entrypointDataV7 == null) {
                        throw RangeError("UserOperation v0.07 is not supported");
                    }
                    entrypointAddress = ENTRYPOINT_V7;

                    const paymasterMetadata = this.entrypointDataV7.paymasterMetadata;
                    const paymasterAndData = paymasterMetadata.dummyPaymasterAndData;
                    userOperation.paymaster = paymasterAndData.paymaster;
                    userOperation.paymasterVerificationGasLimit =
                        paymasterAndData.paymasterVerificationGasLimit;
                    userOperation.paymasterPostOpGasLimit =
                        paymasterAndData.paymasterPostOpGasLimit;
                    userOperation.paymasterData = paymasterAndData.paymasterData;
                }
            }
			//only estimate gas if:
			//1-paymaster v1 or v2(only supports entrypoint v0.06)
			//2-token paymaster v3(supports both entrypoints)
			//don't estimate gas for v3 (it will be overridden by
			//the paymaster anyway)
			if (this.version == "v2") {
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
					typeof gasUserOperationOverrides.preVerificationGas ===
						"bigint" &&
					gasUserOperationOverrides.preVerificationGas < 0n
				) {
					throw RangeError("preVerificationGas override can't be negative");
				}

				if (
					typeof gasUserOperationOverrides.verificationGasLimit ===
						"bigint" &&
					gasUserOperationOverrides.verificationGasLimit < 0n
				) {
					throw RangeError("verificationGasLimit override can't be negative");
				}

				if (
					typeof gasUserOperationOverrides.callGasLimit ===
						"bigint" &&
					gasUserOperationOverrides.callGasLimit < 0n
				) {
					throw RangeError("callGasLimit override can't be negative");
				}

				//apply gas overrides
				userOperation.preVerificationGas =
					gasUserOperationOverrides.preVerificationGas ??
					(preVerificationGas *
						BigInt(
							(gasUserOperationOverrides.preVerificationGasPercentageMultiplier ??
								0) + 100,
						)) /
						100n;

				userOperation.verificationGasLimit =
					gasUserOperationOverrides.verificationGasLimit ??
					(verificationGasLimit *
						BigInt(
							(gasUserOperationOverrides.verificationGasLimitPercentageMultiplier ??
								0) + 100,
						)) /
						100n;

				userOperation.callGasLimit =
					gasUserOperationOverrides.callGasLimit ??
					(callGasLimit *
						BigInt(
							(gasUserOperationOverrides.callGasLimitPercentageMultiplier ??
								0) + 100,
						)) /
						100n;

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
					gasUserOperationOverrides.callGasLimitPercentageMultiplier !=
						null
				) {
					throw RangeError(
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
				const result = jsonRpcResult as PmUserOperationV8Result | PmUserOperationV7Result;

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
	 * createSponsorPaymasterUserOperation will request sponsorship from the paymaster and fill
	 * all paymaster fields and gas fields for the UserOperation
	 * @param userOperation - User operation that requests the paymaster sponsorship
	 * @param bundlerRpc - Bundler endpoint rpc url
	 * @param sponsorshipPolicyId - Sponsorship policy ID
	 * @param overrides - Overrides for the paymaster operation
	 * @returns promise with [UserOperationV6 | UserOperationV7 | UserOperationV8, SponsorMetadata | undefined]
	 */
    async createSponsorPaymasterUserOperation(
		userOperation: UserOperationV8,
		bundlerRpc: string,
		sponsorshipPolicyId?: string,
		overrides?: BasePaymasterUserOperationOverrides,
	): Promise<[UserOperationV8, SponsorMetadata | undefined]>;
	async createSponsorPaymasterUserOperation(
		userOperation: UserOperationV7,
		bundlerRpc: string,
		sponsorshipPolicyId?: string,
		overrides?: BasePaymasterUserOperationOverrides,
	): Promise<[UserOperationV7, SponsorMetadata | undefined]>;
	async createSponsorPaymasterUserOperation(
		userOperation: UserOperationV6,
		bundlerRpc: string,
		sponsorshipPolicyId?: string,
		overrides?: BasePaymasterUserOperationOverrides,
	): Promise<[UserOperationV6, SponsorMetadata | undefined]>;
	async createSponsorPaymasterUserOperation(
		userOperation: UserOperationV7 | UserOperationV6,
		bundlerRpc: string,
		sponsorshipPolicyId?: string,
		overrides?: BasePaymasterUserOperationOverrides,
	): Promise<[
        UserOperationV8 | UserOperationV7 | UserOperationV6,
        SponsorMetadata | undefined
    ]> {
		const context: CandidePaymasterContext = {};
		if (sponsorshipPolicyId && sponsorshipPolicyId.trim().length > 0){
			context["sponsorshipPolicyId"] = sponsorshipPolicyId;
		}
		if ("initCode" in userOperation) {
			return await this.createPaymasterUserOperation(
				userOperation as UserOperationV6,
				bundlerRpc,
				context,
				overrides
			);
        } else if ("eip7702Auth" in userOperation) {
            return await this.createPaymasterUserOperation(
				userOperation as UserOperationV8,
				bundlerRpc,
				context,
        overrides
			);
		} else {
			return await this.createPaymasterUserOperation(
				userOperation as UserOperationV7,
				bundlerRpc,
				context,
				overrides
			);
		}
	}

	/**
	 * createPaymasterUserOperation will request sponsorship from the paymaster using the token provided and fill
	 * all paymaster fields and gas fields for the UserOperation
	 * @param smartAccount - Smart Account object that created the userOperation
	 * @param userOperation - User operation that requests the paymaster token sponsorship
	 * @param tokenAddress - Target token to pay gas with
	 * @param bundlerRpc - Bundler endpoint rpc url
	 * @param overrides - Overrides for the paymaster operation
	 * @returns a promise with UserOperationV8 | UserOperationV7 | UserOperationV6
	 */
  async createTokenPaymasterUserOperation(
		smartAccount: PrependTokenPaymasterApproveAccount,
		userOperation: UserOperationV8,
		tokenAddress: string,
		bundlerRpc: string,
		overrides?: BasePaymasterUserOperationOverrides,
	): Promise<UserOperationV8>;
	async createTokenPaymasterUserOperation(
		smartAccount: PrependTokenPaymasterApproveAccount,
		userOperation: UserOperationV7,
		tokenAddress: string,
		bundlerRpc: string,
		overrides?: BasePaymasterUserOperationOverrides,
	): Promise<UserOperationV7>;
	async createTokenPaymasterUserOperation(
		smartAccount: PrependTokenPaymasterApproveAccount,
		userOperation: UserOperationV6,
		tokenAddress: string,
		bundlerRpc: string,
		overrides?: BasePaymasterUserOperationOverrides,
	): Promise<UserOperationV6>;
	async createTokenPaymasterUserOperation(
		smartAccount: PrependTokenPaymasterApproveAccount,
		userOperation: UserOperationV8 | UserOperationV7 | UserOperationV6,
		tokenAddress: string,
		bundlerRpc: string,
		overrides?: BasePaymasterUserOperationOverrides,
	): Promise<UserOperationV8 | UserOperationV7 | UserOperationV6> {
		try {
			if (!this.initialized) {
				await this.initialize();
			}
			let entrypoint = overrides?.entrypoint;
            if (entrypoint == null){
                if ("initCode" in userOperation) {
                    entrypoint = ENTRYPOINT_V6;
                } else if ("eip7702Auth" in userOperation) {
                    entrypoint = ENTRYPOINT_V8;
                } else {
                    entrypoint = ENTRYPOINT_V7;
                }
            }
			const maxErc20Cost =
				await this.calculateUserOperationErc20TokenMaxGasCost(
					userOperation,
					tokenAddress,
				);

			const approveAmount = maxErc20Cost * 2n; //for the extra cost of the paymasterAndData

			const metadata = await this.getPaymasterMetaData(entrypoint);

			if (metadata == null) {
				throw RangeError("unsupported entrypoint.");
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
					userOperation as UserOperationV6,
					bundlerRpc,
					{
						token: tokenAddress,
					},
					overrides,
				);
				return resultUserOp;
            } else if ("eip7702Auth" in userOperation) {
                const [resultUserOp] = await this.createPaymasterUserOperation(
					userOperation as UserOperationV8,
					bundlerRpc,
					{
						token: tokenAddress,
					},
          overrides,
				);
				return resultUserOp;
			} else {
				const [resultUserOp] = await this.createPaymasterUserOperation(
					userOperation as UserOperationV7,
					bundlerRpc,
					{
						token: tokenAddress,
					},
					overrides,
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

	async calculateUserOperationErc20TokenMaxGasCost(
		userOperation: UserOperationV8 | UserOperationV7 | UserOperationV6,
		erc20TokenAddress: string,
        overrides: {entrypoint?: string| null} = {},
	): Promise<bigint> {
		try {
			if (!this.initialized) {
				await this.initialize();
			}
            let entrypoint = overrides.entrypoint;
            if (entrypoint == null){
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
                SupportedERC20TokensAndMetadataV7WithExchangeRate | 
                SupportedERC20TokensAndMetadataV6WithExchangeRate;

            const supportedTokensExchangeRates =
                jsonRpcResult.tokens.map((gasToken) =>
                 ({
                     address: gasToken.address,
                     exchangeRate:gasToken.exchangeRate,
                 })
                )

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
                            supportedERC20TokensAndPaymasterMetadataV7: 
                                JSON.stringify(
                                    this.entrypointDataV7,
                                    (_key, value) =>
                                        typeof value === "bigint" ? "0x" +
                                            value.toString(16) : value,
                                ),
                            supportedERC20TokensAndPaymasterMetadataV6:
                                JSON.stringify(
                                    this.entrypointDataV6,
                                    (_key, value) =>
                                        typeof value === "bigint" ? 
                                            "0x" + value.toString(16) : value,
                            ),
                        },
                    },
                );
            } else {
                return BigInt(gasToken.exchangeRate)
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
    
    async fetchSupportedERC20TokensAndPaymasterMetadata(
        entrypoint: string = ENTRYPOINT_V7,
	): Promise<
        SupportedERC20TokensAndMetadataV8WithExchangeRate | 
        SupportedERC20TokensAndMetadataV7WithExchangeRate | 
        SupportedERC20TokensAndMetadataV6WithExchangeRate
    > {
        try{
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
					jsonRpcResult = jsonRpcResult as
                        SupportedERC20TokensAndMetadataV7WithExchangeRate;
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
                jsonRpcResult = jsonRpcResult as
                    SupportedERC20TokensAndMetadataV6WithExchangeRate;
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
                throw RangeError("unsupported entrypoint.");
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
