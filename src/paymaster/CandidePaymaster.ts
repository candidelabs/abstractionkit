import { Paymaster } from "./Paymaster";
import { calculateUserOperationMaxGasCost, sendJsonRpcRequest } from "../utils";
import {
	UserOperationV6,
	UserOperationV7,
	SupportedERC20TokensAndMetadataV7,
	SupportedERC20TokensAndMetadataV6,
	PmUserOperationV7Result,
	PmUserOperationV6Result,
	PaymasterMetadataV7,
	PaymasterMetadataV6,
	ERC20Token,
	SponsorMetadata,
} from "../types";
import {
	CandidePaymasterContext,
	PrependTokenPaymasterApproveAccount,
	CreatePaymasterUserOperationOverrides,
} from "./types";
import { Bundler } from "src/Bundler";
import { AbstractionKitError, ensureError } from "src/errors";
import { ENTRYPOINT_V7, ENTRYPOINT_V6 } from "src/constants";

export class CandidePaymaster extends Paymaster {
	readonly rpcUrl: string;
	private version: "v3" | "v2" | "v1" | undefined;
	private entrypointDataV7: SupportedERC20TokensAndMetadataV7 | undefined;
	private entrypointDataV6: SupportedERC20TokensAndMetadataV6 | undefined;
	private isInitilized = false;

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
					"Invalide paymaster version received from paymaster rpc",
				);
			}

			const entrypointsAddresses = await this.getSupportedEntrypointsLive();
			if (
				entrypointsAddresses.some(
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
				entrypointsAddresses.some(
					(x) => x.toLowerCase() === ENTRYPOINT_V6.toLowerCase(),
				)
			) {
				const supportedTokensAndMetadataResultV6 =
					await this.getSupportedERC20TokensAndPaymasterMetadata(ENTRYPOINT_V6);

				this.entrypointDataV6 =
					(supportedTokensAndMetadataResultV6 as SupportedERC20TokensAndMetadataV6) ??
					null;
			}

			if (this.entrypointDataV7 == null && this.entrypointDataV6 == null) {
				throw RangeError("Invalide data received during initilization.");
			}
			this.isInitilized = true;
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
		SupportedERC20TokensAndMetadataV7 | SupportedERC20TokensAndMetadataV6 | null
	> {
		if (!this.isInitilized) {
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
				if (entrypoint == ENTRYPOINT_V7) {
					jsonRpcResult = jsonRpcResult as SupportedERC20TokensAndMetadataV7;
					return {
						tokens: jsonRpcResult.tokens.map((gasToken) => ({
							name: gasToken.name,
							symbol: gasToken.symbol,
							address: gasToken.address,
							decimal: Number(gasToken.decimal),
							exchangeRate: BigInt(gasToken.exchangeRate),
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
							decimal: Number(gasToken.decimal),
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
					"getSupportedERC20TokensAndPaymasterMetadata failed",
					{
						cause: error,
					},
				);
			}
		} else {
			if (entrypoint == ENTRYPOINT_V7) {
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
		if (!this.isInitilized) {
			await this.initialize();
		}
		const suppotedEntrypoints = [];
		if (this.entrypointDataV7 != null) {
			suppotedEntrypoints.push(ENTRYPOINT_V7);
		}
		if (this.entrypointDataV6 != null) {
			suppotedEntrypoints.push(ENTRYPOINT_V6);
		}
		return suppotedEntrypoints;
	}

	async getPaymasterMetaData(
		entrypoint: string,
	): Promise<PaymasterMetadataV7 | PaymasterMetadataV6 | null> {
		if (!this.isInitilized) {
			await this.initialize();
		}

		if (entrypoint == ENTRYPOINT_V7 && this.entrypointDataV7 != null) {
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
		if (!this.isInitilized) {
			await this.initialize();
		}
		let supportedTokens: ERC20Token[];
		if (entrypoint == ENTRYPOINT_V7 && this.entrypointDataV7 != null) {
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
				decimal: Number(gasToken.decimal),
				exchangeRate: BigInt(gasToken.exchangeRate),
			};
		}
	}

	/**
	 * createPaymasterUserOperation will estimate gas and set paymasterAndData.
	 * gas limits will only change if the estimated gas limits returned by
	 * the bundler is more than the input gas limits, then gas overrides
	 * and multipliers will be applied
	 * @param useroperation - useroperation to add paymaster support for
	 * @param bundlerRpc - bundler rpc for gas estimation
	 * @param context - paymaster context data
	 * @param overrides - overrides for the default values
	 * @returns promise of UserOperation and SponsorMetadata
	 */
	async createPaymasterUserOperation(
		userOperationInput: UserOperationV7,
		bundlerRpc: string,
		context?: CandidePaymasterContext,
		overrides?: CreatePaymasterUserOperationOverrides,
	): Promise<[UserOperationV7, SponsorMetadata | undefined]>;
	async createPaymasterUserOperation(
		userOperationInput: UserOperationV6,
		bundlerRpc: string,
		context?: CandidePaymasterContext,
		overrides?: CreatePaymasterUserOperationOverrides,
	): Promise<[UserOperationV6, SponsorMetadata | undefined]>;
	async createPaymasterUserOperation(
		userOperationInput: UserOperationV7 | UserOperationV6,
		bundlerRpc: string,
		context?: CandidePaymasterContext,
		overrides?: CreatePaymasterUserOperationOverrides,
	): Promise<[UserOperationV7 | UserOperationV6, SponsorMetadata | undefined]> {
		if (context == null) {
			context = {};
		}
		let createPaymasterUserOperationOverrides = overrides;
		if (createPaymasterUserOperationOverrides == null) {
			createPaymasterUserOperationOverrides = {};
		}
		const userOperation = { ...userOperationInput };
		if (!this.isInitilized) {
			await this.initialize();
		}
		let sponsorMetadata = undefined;
		try {
			let entrypointAddress: string;
			if ("initCode" in userOperation) {
				if (this.entrypointDataV6 == null) {
					throw RangeError("useroperation v0.06 is not supported");
				}
				entrypointAddress = ENTRYPOINT_V6;

				const paymasterMetadata = this.entrypointDataV6.paymasterMetadata;
				userOperation.paymasterAndData =
					paymasterMetadata.dummyPaymasterAndData;
			} else {
				if (this.entrypointDataV7 == null) {
					throw RangeError("useroperation v0.07 is not supported");
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

			//only estimate gas if:
			//1-paymaster v1 or v2(only supports entrypoint v0.06)
			//2-token paymaster v3(supports both entrypoints)
			//don't estimategas for sponsor paymaster v3(it will be overriden by
			//the paymaster anyway)
			if (
				this.version == "v1" ||
				this.version == "v2" ||
				("token" in context && context.token != null)
			) {
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
							createPaymasterUserOperationOverrides.state_override_set,
						);

						// only change gas limits if the esitmated limits is higher than
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
							"bundlerRpc cant't be null if preVerificationGas,verificationGasLimit and callGasLimit are not overriden",
						);
					}
				}

				//check gas overrides type and range
				if (
					typeof createPaymasterUserOperationOverrides.preVerificationGas ===
						"bigint" &&
					createPaymasterUserOperationOverrides.preVerificationGas < 0n
				) {
					throw RangeError("preVerificationGas overrid can't be negative");
				}

				if (
					typeof createPaymasterUserOperationOverrides.verificationGasLimit ===
						"bigint" &&
					createPaymasterUserOperationOverrides.verificationGasLimit < 0n
				) {
					throw RangeError("verificationGasLimit overrid can't be negative");
				}

				if (
					typeof createPaymasterUserOperationOverrides.callGasLimit ===
						"bigint" &&
					createPaymasterUserOperationOverrides.callGasLimit < 0n
				) {
					throw RangeError("callGasLimit overrid can't be negative");
				}

				//apply gas overrides
				userOperation.preVerificationGas =
					createPaymasterUserOperationOverrides.preVerificationGas ??
					(preVerificationGas *
						BigInt(
							(createPaymasterUserOperationOverrides.preVerificationGasPercentageMultiplier ??
								0) + 100,
						)) /
						100n;

				userOperation.verificationGasLimit =
					createPaymasterUserOperationOverrides.verificationGasLimit ??
					(verificationGasLimit *
						BigInt(
							(createPaymasterUserOperationOverrides.verificationGasLimitPercentageMultiplier ??
								0) + 100,
						)) /
						100n;

				userOperation.callGasLimit =
					createPaymasterUserOperationOverrides.callGasLimit ??
					(callGasLimit *
						BigInt(
							(createPaymasterUserOperationOverrides.callGasLimitPercentageMultiplier ??
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
					createPaymasterUserOperationOverrides.preVerificationGas != null ||
					createPaymasterUserOperationOverrides.verificationGasLimit != null ||
					createPaymasterUserOperationOverrides.callGasLimit != null ||
					createPaymasterUserOperationOverrides.preVerificationGasPercentageMultiplier !=
						null ||
					createPaymasterUserOperationOverrides.verificationGasLimitPercentageMultiplier !=
						null ||
					createPaymasterUserOperationOverrides.callGasLimitPercentageMultiplier !=
						null
				) {
					throw RangeError(
						"you can't use any gas overrides for sponsor paymaster v3," +
							" as it will estimate gas and override any provided values.",
					);
				}
			}

			//call the paymaster rpc to sponsor the useroperation
			const jsonRpcResult = await sendJsonRpcRequest(
				this.rpcUrl,
				"pm_sponsorUserOperation",
				[userOperation, entrypointAddress, context],
			);
			const result = jsonRpcResult as
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
			//needed in case the paymaster modifies the useroperation before
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
				const result = jsonRpcResult as PmUserOperationV7Result;

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
	 * createSponsorPaymasterUserOperation will estimate gas and set
	 * paymasterAndData for a sponsor paymaster operation
	 * @param useroperation - useroperation to add paymaster support for
	 * @param bundlerRpc - bundler rpc for gas estimation
	 * @param overrides - overrides for the default values
	 * @returns promise with [UserOperationV7, SponsorMetadata | undefined]
	 */
	async createSponsorPaymasterUserOperation(
		userOperation: UserOperationV7,
		bundlerRpc: string,
		overrides?: CreatePaymasterUserOperationOverrides,
	): Promise<[UserOperationV7, SponsorMetadata | undefined]>;
	async createSponsorPaymasterUserOperation(
		userOperation: UserOperationV6,
		bundlerRpc: string,
		overrides?: CreatePaymasterUserOperationOverrides,
	): Promise<[UserOperationV6, SponsorMetadata | undefined]>;
	async createSponsorPaymasterUserOperation(
		userOperation: UserOperationV7 | UserOperationV6,
		bundlerRpc: string,
		overrides: CreatePaymasterUserOperationOverrides = {},
	): Promise<[UserOperationV7 | UserOperationV6, SponsorMetadata | undefined]> {
		const createPaymasterUserOperationOverrides = overrides;
		if ("initCode" in userOperation) {
			return await this.createPaymasterUserOperation(
				userOperation as UserOperationV6,
				bundlerRpc,
				{},
				createPaymasterUserOperationOverrides,
			);
		} else {
			return await this.createPaymasterUserOperation(
				userOperation as UserOperationV7,
				bundlerRpc,
				{},
				createPaymasterUserOperationOverrides,
			);
		}
	}

	/**
	 * createPaymasterUserOperation will estimate gas and set
	 * paymasterAndData
	 * @param smartAccount - the SmartAccount object that created the target useroperation
	 * @param useroperation - useroperation to add paymaster support for
	 * @param tokenAddress - target token to pay gas with
	 * @param bundlerRpc - bundler rpc for gas estimation
	 * @param overrides - overrides for the default values
	 * @returns promise with UserOperation
	 */
	async createTokenPaymasterUserOperation(
		smartAccount: PrependTokenPaymasterApproveAccount,
		userOperation: UserOperationV7,
		tokenAddress: string,
		bundlerRpc: string,
		overrides?: CreatePaymasterUserOperationOverrides,
	): Promise<UserOperationV7>;
	async createTokenPaymasterUserOperation(
		smartAccount: PrependTokenPaymasterApproveAccount,
		userOperation: UserOperationV6,
		tokenAddress: string,
		bundlerRpc: string,
		overrides?: CreatePaymasterUserOperationOverrides,
	): Promise<UserOperationV6>;
	async createTokenPaymasterUserOperation(
		smartAccount: PrependTokenPaymasterApproveAccount,
		userOperation: UserOperationV7 | UserOperationV6,
		tokenAddress: string,
		bundlerRpc: string,
		overrides: CreatePaymasterUserOperationOverrides = {},
	): Promise<UserOperationV7 | UserOperationV6> {
		const createPaymasterUserOperationOverrides = overrides;
		try {
			if (!this.isInitilized) {
				await this.initialize();
			}

			let entrypoint;
			if ("initCode" in userOperation) {
				entrypoint = ENTRYPOINT_V6;
			} else {
				entrypoint = ENTRYPOINT_V7;
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
					createPaymasterUserOperationOverrides,
				);
				return resultUserOp;
			} else {
				const [resultUserOp] = await this.createPaymasterUserOperation(
					userOperation as UserOperationV7,
					bundlerRpc,
					{
						token: tokenAddress,
					},
					createPaymasterUserOperationOverrides,
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
		userOperation: UserOperationV7 | UserOperationV6,
		erc20TokenAddress: string,
	): Promise<bigint> {
		try {
			if (!this.isInitilized) {
				await this.initialize();
			}

			let entrypoint;
			if ("initCode" in userOperation) {
				entrypoint = ENTRYPOINT_V6;
			} else {
				entrypoint = ENTRYPOINT_V7;
			}

			const supportedERC20TokensData = await this.getSupportedERC20TokenData(
				erc20TokenAddress,
				entrypoint,
			);
			if (supportedERC20TokensData == null) {
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
