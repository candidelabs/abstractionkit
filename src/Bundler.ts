import type {
	UserOperationV6,
	UserOperationV7,
	UserOperationV8,
	UserOperationV9,
	GasEstimationResult,
	UserOperationByHashResult,
	UserOperationReceipt,
	UserOperationReceiptResult,
	StateOverrideSet,
	JsonRpcResult,
} from "./types";
import { sendJsonRpcRequest } from "./utils";
import { AbstractionKitError, ensureError } from "./errors";

/**
 * Client for communicating with an ERC-4337 bundler via JSON-RPC.
 * Provides methods for gas estimation, UserOperation submission, and receipt retrieval.
 *
 * Candide's bundler endpoint follows the format:
 * - `https://api.candide.dev/api/v3/{chainId}/{apiKey}` (authenticated)
 * - `https://api.candide.dev/public/v3/{chainId}` (public, no key required)
 *
 * @example
 * const bundler = new Bundler("https://api.candide.dev/public/v3/11155111");
 * const receipt = await bundler.getUserOperationReceipt(userOpHash);
 */
export class Bundler {
	/** The bundler JSON-RPC endpoint URL */
	readonly rpcUrl: string;

	/** @param rpcUrl - The bundler JSON-RPC endpoint URL */
	constructor(rpcUrl: string) {
		this.rpcUrl = rpcUrl;
	}

	/**
	 * Get the chain ID from the bundler.
	 * @returns The chain ID as a hex-encoded string
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
	 * Get the list of EntryPoint addresses supported by this bundler.
	 * @returns An array of supported EntryPoint contract addresses
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
	 * Estimate gas limits for a UserOperation.
	 * @param useroperation - UserOperation to estimate gas for
	 * @param entrypointAddress - Target EntryPoint address
	 * @param state_override_set - Optional state overrides for estimation
	 * @returns Gas estimation with callGasLimit, preVerificationGas, and verificationGasLimit
	 */
	async estimateUserOperationGas(
		useroperation: UserOperationV6 | UserOperationV7 | UserOperationV8 | UserOperationV9,
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
			// `paymasterVerificationGasLimit` and `paymasterPostOpGasLimit`
			// are standard ERC-4337 UserOperation fields but NOT part of the
			// bundler-spec `GasInfo`. Some bundlers return them as a
			// non-standard extension when a paymaster is attached; forwarded
			// here for compatibility. Guarded with `!= null` so spec-compliant
			// bundlers still work.
			if (res.paymasterVerificationGasLimit != null) {
				gasEstimationResult.paymasterVerificationGasLimit = BigInt(
					res.paymasterVerificationGasLimit,
				);
			}
			if (res.paymasterPostOpGasLimit != null) {
				gasEstimationResult.paymasterPostOpGasLimit = BigInt(
					res.paymasterPostOpGasLimit,
				);
			}

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
	 * Submit a signed UserOperation to the bundler for on-chain inclusion.
	 * @param useroperation - The signed UserOperation to submit
	 * @param entrypointAddress - Target EntryPoint address
	 * @returns The UserOperation hash
	 */
	async sendUserOperation(
		useroperation: UserOperationV6 | UserOperationV7 | UserOperationV8 | UserOperationV9,
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
	 * Get the receipt for a previously submitted UserOperation.
	 * @param useroperationhash - The hash of the UserOperation to look up
	 * @returns The receipt, or null if not yet included
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

			if (res != null) {
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

				const bundlerGetUserOperationReceiptResult: UserOperationReceiptResult =
					{
						...res,
						nonce: BigInt(res.nonce),
						actualGasCost: BigInt(res.actualGasCost),
						actualGasUsed: BigInt(res.actualGasUsed),
						logs: JSON.stringify(res.logs),
						receipt: userOperationReceipt,
					};
				return bundlerGetUserOperationReceiptResult;
			} else {
				return null;
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
	 * Look up a UserOperation by its hash.
	 * @param useroperationhash - The hash of the UserOperation to look up
	 * @returns The UserOperation with metadata, or null if not found
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
			if (res != null) {
				return {
					...res,
					blockNumber: res.blockNumber == null ? null : BigInt(res.blockNumber),
				};
			} else {
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
