import type {
	UserOperation,
	GasEstimationResult,
	UserOperationByHashResult,
	UserOperationReceipt,
	UserOperationReceiptResult,
	StateOverrideSet,
	JsonRpcResult,
} from "./types";
import { sendJsonRpcRequest } from "./utils";
import { AbstractionKitError, ensureError } from "./errors";

export class Bundler {
	readonly rpcUrl: string;

	constructor(rpcUrl: string) {
		this.rpcUrl = rpcUrl;
	}

	/**
	 * call eth_chainId bundler rpc method
	 * @returns promise with chainid
	 */
	async chainId(): Promise<string> {
		try {
			const chainId = (await sendJsonRpcRequest(
				this.rpcUrl,
				"eth_chainId",
				[],
			)) as string;
			if (typeof chainId === "string") {
				return chainId;
			} else {
				throw new AbstractionKitError(
					"BAD_DATA",
					"bundler eth_chainId rpc call failed",
				);
			}
		} catch (err) {
			const error = ensureError(err);

			throw new AbstractionKitError(
				"BUNDLER_ERROR",
				"bundler eth_chainId rpc call failed",
				{
					cause: error,
				},
			);
		}
	}

	/**
	 * call eth_supportedEntryPoints bundler rpc method
	 * @returns promise with supportedEntryPoints
	 */
	async supportedEntryPoints(): Promise<string[]> {
		try {
			const supportedEntryPoints = (await sendJsonRpcRequest(
				this.rpcUrl,
				"eth_supportedEntryPoints",
				[],
			)) as string[];
			return supportedEntryPoints;
		} catch (err) {
			const error = ensureError(err);

			throw new AbstractionKitError(
				"BUNDLER_ERROR",
				"bundler eth_supportedEntryPoints rpc call failed",
				{
					cause: error,
				},
			);
		}
	}

	/**
	 * call eth_estimateUserOperationGas bundler rpc method
	 * @param useroperation - useroperation to estimate gas for
	 * @param entrypointAddress - supported entrypoint
	 * @param state_override_set - state override values to set during gs estimation
	 * @returns promise with GasEstimationResult
	 */
	async estimateUserOperationGas(
		useroperation: UserOperation,
		entrypointAddress: string,
		state_override_set?: StateOverrideSet,
	): Promise<GasEstimationResult> {
		try {
			let jsonRpcResult = {} as JsonRpcResult;
			if (typeof state_override_set === "undefined") {
				jsonRpcResult = await sendJsonRpcRequest(
					this.rpcUrl,
					"eth_estimateUserOperationGas",
					[useroperation, entrypointAddress],
				);
			} else {
				jsonRpcResult = await sendJsonRpcRequest(
					this.rpcUrl,
					"eth_estimateUserOperationGas",
					[useroperation, entrypointAddress, state_override_set],
				);
			}
			const res = jsonRpcResult as GasEstimationResult;
			const gasEstimationResult: GasEstimationResult = {
				callGasLimit: BigInt(res.callGasLimit),
				preVerificationGas: BigInt(res.preVerificationGas),
				verificationGasLimit: BigInt(res.verificationGasLimit),
			};

			return gasEstimationResult;
		} catch (err) {
			const error = ensureError(err);

			throw new AbstractionKitError(
				"BUNDLER_ERROR",
				"bundler eth_estimateUserOperationGas rpc call failed",
				{
					cause: error,
				},
			);
		}
	}

	/**
	 * call eth_sendUserOperation bundler rpc method
	 * @param useroperation - useroperation to estimate gas for
	 * @param entrypointAddress - supported entrypoint
	 * @returns promise with useroperationhash
	 */
	async sendUserOperation(
		useroperation: UserOperation,
		entrypointAddress: string,
	): Promise<string> {
		try {
			const jsonRpcResult = (await sendJsonRpcRequest(
				this.rpcUrl,
				"eth_sendUserOperation",
				[useroperation, entrypointAddress],
			)) as string;
			return jsonRpcResult;
		} catch (err) {
			const error = ensureError(err);

			throw new AbstractionKitError(
				"BUNDLER_ERROR",
				"bundler eth_sendUserOperation rpc call failed",
				{
					cause: error,
				},
			);
		}
	}

	/**
	 * call eth_getUserOperationReceipt bundler rpc method
	 * @param useroperationhash - useroperation hash
	 * @returns promise with UserOperationReceiptResult
	 */
	async getUserOperationReceipt(
		useroperationhash: string,
	): Promise<UserOperationReceiptResult> {
		try {
			const jsonRpcResult = await sendJsonRpcRequest(
				this.rpcUrl,
				"eth_getUserOperationReceipt",
				[useroperationhash],
			);
			const res = jsonRpcResult as UserOperationReceiptResult;

			if(res != null){
				const userOperationReceipt: UserOperationReceipt = {
					...res.receipt,
					blockNumber: BigInt(res.receipt.blockNumber),
					cumulativeGasUsed: BigInt(res.receipt.cumulativeGasUsed),
					gasUsed: BigInt(res.receipt.gasUsed),
					transactionIndex: BigInt(res.receipt.transactionIndex),
					effectiveGasPrice:
						res.receipt.effectiveGasPrice == undefined
							? undefined
							: BigInt(res.receipt.effectiveGasPrice),
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
			}else{
				return null
			}
		} catch (err) {
			const error = ensureError(err);

			throw new AbstractionKitError(
				"BUNDLER_ERROR",
				"bundler eth_getUserOperationReceipt rpc call failed",
				{
					cause: error,
					context: {
						useroperationhash: useroperationhash,
					},
				},
			);
		}
	}

	/**
	 * call eth_getUserOperationByHash bundler rpc method
	 * @param useroperationhash - useroperation hash
	 * @returns promise with UserOperationByHashResult
	 */
	async getUserOperationByHash(
		useroperationhash: string,
	): Promise<UserOperationByHashResult> {
		try {
			const jsonRpcResult = await sendJsonRpcRequest(
				this.rpcUrl,
				"eth_getUserOperationByHash",
				[useroperationhash],
			);
			const res = jsonRpcResult as UserOperationByHashResult;
			if(res != null){
				return {
					...res,
					blockNumber: res.blockNumber == null?null:BigInt(res.blockNumber),
				};
			}else{
				return null;
			}
		} catch (err) {
			const error = ensureError(err);

			throw new AbstractionKitError(
				"BUNDLER_ERROR",
				"bundler eth_getUserOperationByHash rpc call failed",
				{
					cause: error,
					context: {
						useroperationhash: useroperationhash,
					},
				},
			);
		}
	}
}
