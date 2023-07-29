import * as fetchImport from "isomorphic-unfetch";
import type {
	UserOperation,
	JsonRpcError,
	GasEstimationResult,
	UserOperationByHashResult,
	UserOperationReceipt,
	UserOperationReceiptResult,
	AbiInputValue,
	JsonRpcResponse,
} from "./types";
import { BytesLike } from "ethers";

export class Bundler {
	readonly rpcUrl: string;
	readonly entrypointAddress: string;

	constructor(rpcUrl: string, entrypointAddress: string) {
		this.rpcUrl = rpcUrl;
		this.entrypointAddress = entrypointAddress;
	}

	async chainId(): Promise<{ chainId: string } | JsonRpcError> {
		const jsonRpcResult = await this.sendJsonRpcRequest(
			this.rpcUrl,
			"eth_chainId",
			[],
		);
		if ("result" in jsonRpcResult) {
			return { chainId: jsonRpcResult.result as string };
		} else {
			return jsonRpcResult.error as JsonRpcError;
		}
	}

	async supportedEntryPoints(): Promise<
		{ supportedEntryPoints: string[] } | JsonRpcError
	> {
		const jsonRpcResult = await this.sendJsonRpcRequest(
			this.rpcUrl,
			"eth_supportedEntryPoints",
			[],
		);

		if ("result" in jsonRpcResult) {
			return { supportedEntryPoints: jsonRpcResult.result as string[] };
		} else {
			return jsonRpcResult.error as JsonRpcError;
		}
	}

	async estimateUserOperationGas(
		useroperation: UserOperation,
	): Promise<GasEstimationResult | JsonRpcError> {
		const jsonRpcResult = await this.sendJsonRpcRequest(
			this.rpcUrl,
			"eth_estimateUserOperationGas",
			[useroperation, this.entrypointAddress],
		);

		if ("result" in jsonRpcResult) {
			return jsonRpcResult.result as GasEstimationResult;
		} else {
			return jsonRpcResult.error as JsonRpcError;
		}
	}

	async sendUserOperation(
		useroperation: UserOperation,
	): Promise<{ userOperationHash: string } | JsonRpcError> {
		const jsonRpcResult = await this.sendJsonRpcRequest(
			this.rpcUrl,
			"eth_sendUserOperation",
			[useroperation, this.entrypointAddress],
		);
		if ("result" in jsonRpcResult) {
			return { userOperationHash: jsonRpcResult.result as string };
		} else {
			const error = jsonRpcResult.error as JsonRpcError;
			return error;
		}
	}

	async getUserOperationReceipt(
		useroperationhash: BytesLike,
	): Promise<UserOperationReceiptResult | JsonRpcError> {
		const jsonRpcResult = await this.sendJsonRpcRequest(
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
			const error = jsonRpcResult.error as JsonRpcError;
			return error;
		}
	}

	async getUserOperationByHash(
		useroperationhash: BytesLike,
	): Promise<UserOperationByHashResult | JsonRpcError> {
		const jsonRpcResult = await this.sendJsonRpcRequest(
			this.rpcUrl,
			"eth_getUserOperationByHash",
			[useroperationhash],
		);
		if ("result" in jsonRpcResult) {
			return jsonRpcResult.result as UserOperationByHashResult;
		} else {
			const error = jsonRpcResult.error as JsonRpcError;
			return error;
		}
	}

	async sendJsonRpcRequest(
		rpcUrl: string,
		method: string,
		params: AbiInputValue,
	): Promise<JsonRpcResponse> {
		const fetch = fetchImport.default || fetchImport;

		const raw = JSON.stringify({
			method: method,
			params: params,
			id: 1,
			jsonrpc: "2.0",
		});

		const requestOptions: RequestInit = {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: raw,
			redirect: "follow",
		};

		const response = await fetch(rpcUrl, requestOptions);

		return JSON.parse(await response.text()) as JsonRpcResponse;
	}
}
