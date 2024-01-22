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

	/**
	 * call eth_chainId bundler rpc method
	 * @returns 
	 */
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

	/**
	 * call eth_supportedEntryPoints bundler rpc method
	 * @returns 
	 */
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

	/**
	 * call eth_estimateUserOperationGas bundler rpc method
	 * @param useroperation 
	 * @param entrypointAddress 
	 * @param state_override_set 
	 * @returns GasEstimationResult or BundlerJsonRpcError
	 */
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
			const res = jsonRpcResult.result as GasEstimationResult
			const gasEstimationResult: GasEstimationResult = {
				callGasLimit: BigInt(res.callGasLimit),
				preVerificationGas: BigInt(res.preVerificationGas),
				verificationGasLimit: BigInt(res.verificationGasLimit)
			};

			return gasEstimationResult;
		} else {
			return jsonRpcResult.error as BundlerJsonRpcError;
		}
	}

	/**
	 * call eth_sendUserOperation bundler rpc method
	 * @param useroperation 
	 * @param entrypointAddress 
	 * @returns useroperationhash or BundlerJsonRpcError
	 */
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

	/**
	 * call eth_getUserOperationReceipt bundler rpc method
	 * @param useroperationhash 
	 * @returns UserOperationReceiptResult or BundlerJsonRpcError
	 */
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
				blockNumber: BigInt(res.receipt.blockNumber),
				cumulativeGasUsed: BigInt(res.receipt.cumulativeGasUsed),
				gasUsed: BigInt(res.receipt.gasUsed),
				transactionIndex: BigInt(res.receipt.transactionIndex),
				effectiveGasPrice: (res.receipt.effectiveGasPrice == undefined)?undefined:BigInt(res.receipt.effectiveGasPrice),
				logs: JSON.stringify(res.receipt.logs),
			};

			const bundlerGetUserOperationReceiptResult: UserOperationReceiptResult = {
				...res,
				nonce: BigInt(res.nonce),
				actualGasCost: BigInt(res.actualGasCost),
				actualGasUsed: BigInt(res.actualGasUsed),
				logs: JSON.stringify(res.logs),
				receipt: userOperationReceipt,
			};
			return bundlerGetUserOperationReceiptResult;
		} else {
			const error = jsonRpcResult.error as BundlerJsonRpcError;
			return error;
		}
	}

	/**
	 * call eth_getUserOperationByHash bundler rpc method
	 * @param useroperationhash 
	 * @returns UserOperationByHashResult or BundlerJsonRpcError
	 */
	async getUserOperationByHash(
		useroperationhash: BytesLike,
	): Promise<UserOperationByHashResult | BundlerJsonRpcError> {
		const jsonRpcResult = await sendJsonRpcRequest(
			this.rpcUrl,
			"eth_getUserOperationByHash",
			[useroperationhash],
		);
		if ("result" in jsonRpcResult) {
			const res = jsonRpcResult.result as UserOperationByHashResult;

			const userOperationByHashResult: UserOperationByHashResult = {
				...res,
				blockNumber: BigInt(res.blockNumber),
			};
			return userOperationByHashResult;
		} else {
			const error = jsonRpcResult.error as BundlerJsonRpcError;
			return error;
		}
	}
}
