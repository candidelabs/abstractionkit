import { Paymaster } from "./Paymaster";
import { sendJsonRpcRequest } from "../utils";
import {
	UserOperation,
	BundlerJsonRpcError,
	SupportedERC20Tokens,
	PmSponsorUserOperationResult,
} from "../types";

export class CandideValidationPaymaster extends Paymaster {
	readonly rpcUrl: string;
	readonly entrypointAddress: string;

	constructor(entrypointAddress: string, rpcUrl: string) {
		super();
		this.rpcUrl = rpcUrl;
		this.entrypointAddress = entrypointAddress;
	}

	async getSupportedERC20Tokens(): Promise<
		SupportedERC20Tokens | BundlerJsonRpcError
	> {
		const jsonRpcResult = await sendJsonRpcRequest(
			this.rpcUrl,
			"pm_supportedERC20Tokens",
			[],
		);

		if ("result" in jsonRpcResult) {
			const res = jsonRpcResult.result as SupportedERC20Tokens;
			return { tokens: res.tokens, paymasterMetadata: res.paymasterMetadata };
		} else {
			return jsonRpcResult.error as BundlerJsonRpcError;
		}
	}

	async getSupportedEntrypoint(): Promise<string | BundlerJsonRpcError> {
		const jsonRpcResult = await sendJsonRpcRequest(
			this.rpcUrl,
			"pm_supportedEntryPoint",
			[],
		);

		if ("result" in jsonRpcResult) {
			return jsonRpcResult.result as string;
		} else {
			return jsonRpcResult.error as BundlerJsonRpcError;
		}
	}

	async getPaymasterCallDataForPayingGasWithErc20(
		userOperation: UserOperation,
		erc20TokenAddress: string,
	): Promise<PmSponsorUserOperationResult | BundlerJsonRpcError> {
		const config = [this.rpcUrl, this.entrypointAddress, erc20TokenAddress];

		return this.getPaymasterCallData(userOperation, config);
	}

	async getPaymasterCallDataForGaslessTx(
		userOperation: UserOperation,
	): Promise<PmSponsorUserOperationResult | BundlerJsonRpcError> {
		const config = [this.rpcUrl, this.entrypointAddress];

		return this.getPaymasterCallData(userOperation, config);
	}

	async getPaymasterCallData(
		userOperation: UserOperation,
		config: string[],
	): Promise<PmSponsorUserOperationResult | BundlerJsonRpcError> {
		const rpcUrl = config[0];
		const entrypointAddress = config[1];
		const tokenAddress = config[2];

		const jsonRpcResult = await sendJsonRpcRequest(
			rpcUrl,
			"pm_sponsorUserOperation",
			[userOperation, entrypointAddress, { token: tokenAddress }],
		);

		if ("result" in jsonRpcResult) {
			return jsonRpcResult.result as PmSponsorUserOperationResult;
		} else {
			return jsonRpcResult.error as BundlerJsonRpcError;
		}
	}
}
