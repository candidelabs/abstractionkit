import { Paymaster } from "./Paymaster";
import { calculateUserOperationMaxGasCost, sendJsonRpcRequest } from "../utils";
import {
	UserOperation,
	JsonRpcError,
	SupportedERC20TokensAndMetadata,
	PmUserOperationResult,
	PaymasterMetadata,
	ERC20Token,
	StateOverrideSet,
} from "../types";
import { CandidePaymasterContext } from "./types";
import { Bundler } from "src/Bundler";

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
	 * @returns null or JsonRpcError
	 */
	async initialize(): Promise<null | JsonRpcError> {
		const entrypointResult = await this.getSupportedEntrypoint();

		if (typeof entrypointResult === "string") {
			this.entrypointAddress = entrypointResult;
		} else {
			return entrypointResult;
		}

		const supportedTokensResult =
			await this.getSupportedERC20TokensAndPaymasterMetadata();

		if ("code" in supportedTokensResult) {
			return supportedTokensResult;
		} else {
			this.supportedTokens = supportedTokensResult.tokens;
			this.paymasterMetadata = supportedTokensResult.paymasterMetadata;
		}
		return null;
	}

	async getPaymasterMetaData(): Promise<PaymasterMetadata | JsonRpcError> {
		if (this.paymasterMetadata == null) {
			const result = await this.initialize();
			if (result != null) {
				return result;
			}
		}
		return this.paymasterMetadata as PaymasterMetadata;
	}

	async getSupportedERC20TokensAndPaymasterMetadata(): Promise<
		SupportedERC20TokensAndMetadata | JsonRpcError
	> {
		if (this.supportedTokens == null || this.paymasterMetadata == null) {
			const jsonRpcResult = await sendJsonRpcRequest(
				this.rpcUrl,
				"pm_supportedERC20Tokens",
				[],
			);

			if ("result" in jsonRpcResult) {
				const res = jsonRpcResult.result as SupportedERC20TokensAndMetadata;
				return { tokens: res.tokens, paymasterMetadata: res.paymasterMetadata };
			} else {
				return jsonRpcResult.error as JsonRpcError;
			}
		} else {
			return {
				tokens: this.supportedTokens,
				paymasterMetadata: this.paymasterMetadata,
			};
		}
	}

	async getSupportedEntrypoint(): Promise<string | JsonRpcError> {
		if (this.entrypointAddress == null) {
			const jsonRpcResult = await sendJsonRpcRequest(
				this.rpcUrl,
				"pm_supportedEntryPoint",
				[],
			);

			if ("result" in jsonRpcResult) {
				return jsonRpcResult.result as string;
			} else {
				return jsonRpcResult.error as JsonRpcError;
			}
		} else {
			return this.entrypointAddress;
		}
	}

	/**
	 * check if the token paymaster accepts an erc20 token
	 * @param erc20TokenAddress
	 * @returns boolean or JsonRpcError
	 */
	async isSupportedERC20Token(
		erc20TokenAddress: string,
	): Promise<boolean | JsonRpcError> {
		if (
			this.entrypointAddress == null ||
			this.supportedTokens == null ||
			this.paymasterMetadata == null
		) {
			const result = await this.initialize();
			if (result != null) {
				return result;
			}
		}
		const supportedTokens = this.supportedTokens as ERC20Token[];
		const gasToken = supportedTokens.find(
			(token) => token.address === erc20TokenAddress.toLowerCase(),
		);

		if (!gasToken) {
			return false;
		} else {
			return true;
		}
	}

	/**
	 * get the paymaster token data
	 * @param erc20TokenAddress
	 * @returns ERC20Token or null or JsonRpcError 
	 */
	async getSupportedERC20TokenData(
		erc20TokenAddress: string,
	): Promise<ERC20Token | null | JsonRpcError> {
		if (
			this.entrypointAddress == null ||
			this.supportedTokens == null ||
			this.paymasterMetadata == null
		) {
			const result = await this.initialize();
			if (result != null) {
				return result;
			}
		}
		const supportedTokens = this.supportedTokens as ERC20Token[];
		const gasToken = supportedTokens.find(
			(token) => token.address === erc20TokenAddress.toLowerCase(),
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
	 * @param userOperation 
	 * @param bundlerRpc 
	 * @param context 
	 * @param entrypointAddress 
	 * @param state_override_set 
	 * @returns UserOperation or JsonRpcError
	 */
	async createPaymasterUserOperation(
		userOperation: UserOperation,
		bundlerRpc: string,
		context: CandidePaymasterContext = {},
		entrypointAddress: string = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789",
		state_override_set?: StateOverrideSet,
	): Promise<UserOperation | JsonRpcError> {
		if (
			this.entrypointAddress == null ||
			this.supportedTokens == null ||
			this.paymasterMetadata == null
		) {
			const result = await this.initialize();
			if (result != null) {
				return result;
			}
		}

		const paymasterMetadata = this.paymasterMetadata as PaymasterMetadata;
		userOperation.paymasterAndData = paymasterMetadata.dummyPaymasterAndData;

		const bundler = new Bundler(bundlerRpc);
		const estimation = await bundler.estimateUserOperationGas(
			userOperation,
			entrypointAddress,
			state_override_set,
		);
		if ("code" in estimation) {
			return estimation;
		}
		userOperation.preVerificationGas = estimation.preVerificationGas;
		userOperation.verificationGasLimit =
			estimation.verificationGasLimit + 10000n;
		userOperation.callGasLimit = estimation.callGasLimit;

		const jsonRpcResult = await sendJsonRpcRequest(
			this.rpcUrl,
			"pm_sponsorUserOperation",
			[userOperation, this.entrypointAddress, context],
		);

		if ("result" in jsonRpcResult) {
			const result = jsonRpcResult.result as PmUserOperationResult;
			const resultMod = {
				paymasterAndData: result.paymasterAndData,
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
		} else {
			return jsonRpcResult.error as JsonRpcError;
		}
	}

	async calculateUserOperationErc20TokenMaxGasCost(
		userOperation: UserOperation,
		erc20TokenAddress: string,
	):Promise<bigint | JsonRpcError>{
		const supportedERC20TokensDataResult = await this.getSupportedERC20TokenData(erc20TokenAddress)
		if (supportedERC20TokensDataResult == null) {
			throw RangeError(
				"Erc20 token is not supported by the paymaster.",
			);
		}else{
			if("error" in supportedERC20TokensDataResult){
				return supportedERC20TokensDataResult as JsonRpcError
			}else{
				const supportedERC20TokensData = supportedERC20TokensDataResult as ERC20Token
				const cost = calculateUserOperationMaxGasCost(userOperation)
				const tokenCost = (supportedERC20TokensData.exchangeRate / cost) + supportedERC20TokensData.fee

				return tokenCost
			}
		}
	}
}
