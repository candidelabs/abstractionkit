import type {
	UserOperation,
	BundlerJsonRpcError,
	GasEstimationResult,
	UserOperationByHashResult,
	UserOperationReceipt,
	UserOperationReceiptResult,
	StateOverrideSet,
	JsonRpcResponse,
} from "./types";
import { BytesLike } from "ethers";
import {sendJsonRpcRequest} from "./utils";

export class Bundler {
	readonly rpcUrl: string;

	constructor(rpcUrl: string) {
		this.rpcUrl = rpcUrl;
	}

	async chainId(): Promise<string| BundlerJsonRpcError> {
		const jsonRpcResult = await sendJsonRpcRequest(
			this.rpcUrl,
			"eth_chainId",
			[],
		);
		if ("result" in jsonRpcResult) {
			return jsonRpcResult.result as string
		} else {
			return jsonRpcResult.error as BundlerJsonRpcError;
		}
	}

	async supportedEntryPoints(): Promise<
		string[] | BundlerJsonRpcError
	> {
		const jsonRpcResult = await sendJsonRpcRequest(
			this.rpcUrl,
			"eth_supportedEntryPoints",
			[],
		);

		if ("result" in jsonRpcResult) {
			return jsonRpcResult.result as string[]
		} else {
			return jsonRpcResult.error as BundlerJsonRpcError;
		}
	}

	async estimateUserOperationGas(
		useroperation: UserOperation,
		entrypointAddress: string,
		state_override_set?: StateOverrideSet
	): Promise<GasEstimationResult | BundlerJsonRpcError> {
		let jsonRpcResult = {} as JsonRpcResponse
		if (typeof state_override_set === 'undefined') {
			jsonRpcResult = await sendJsonRpcRequest(
				this.rpcUrl,
				"eth_estimateUserOperationGas",
				[useroperation, entrypointAddress],
			);
		}else{
			jsonRpcResult = await sendJsonRpcRequest(
				this.rpcUrl,
				"eth_estimateUserOperationGas",
				[useroperation, entrypointAddress, state_override_set],
			);
		}
		if ("result" in jsonRpcResult) {
			return jsonRpcResult.result as GasEstimationResult;
		} else {
			return jsonRpcResult.error as BundlerJsonRpcError;
		}
	}

	async sendUserOperation(
		useroperation: UserOperation,
		entrypointAddress: string,
	): Promise<string | BundlerJsonRpcError> {
		const jsonRpcResult = await sendJsonRpcRequest(
			this.rpcUrl,
			"eth_sendUserOperation",
			[useroperation, entrypointAddress],
		);
		if ("result" in jsonRpcResult) {
			return jsonRpcResult.result as string
		} else {
			const error = jsonRpcResult.error as BundlerJsonRpcError;
			return error;
		}
	}

	async getUserOperationReceipt(
		useroperationhash: BytesLike,
	): Promise<UserOperationReceiptResult | BundlerJsonRpcError> {
		const jsonRpcResult = await sendJsonRpcRequest(
			this.rpcUrl,
			"eth_getUserOperationReceipt",
			[useroperationhash],
		);
		if ("result" in jsonRpcResult) {
			const res = jsonRpcResult.result as UserOperationReceiptResult;
			const userOperationReceipt: UserOperationReceipt = {
				...res.receipt,
				logs: JSON.stringify(res.receipt.logs),
			};

			const bundlerGetUserOperationReceiptResult: UserOperationReceiptResult = {
				...res,
				logs: JSON.stringify(res.logs),
				receipt: userOperationReceipt,
			};
			return bundlerGetUserOperationReceiptResult;
		} else {
			const error = jsonRpcResult.error as BundlerJsonRpcError;
			return error;
		}
	}

	async getUserOperationByHash(
		useroperationhash: BytesLike,
	): Promise<UserOperationByHashResult | BundlerJsonRpcError> {
		const jsonRpcResult = await sendJsonRpcRequest(
			this.rpcUrl,
			"eth_getUserOperationByHash",
			[useroperationhash],
		);
		if ("result" in jsonRpcResult) {
			return jsonRpcResult.result as UserOperationByHashResult;
		} else {
			const error = jsonRpcResult.error as BundlerJsonRpcError;
			return error;
		}
	}
}
