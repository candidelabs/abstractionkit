import * as fetchImport from "isomorphic-unfetch";

import { id, AbiCoder, keccak256, JsonRpcProvider } from "ethers";

import {
	AbiInputValue,
	UserOperation,
	JsonRpcResponse,
	JsonRpcParam,
	JsonRpcError,
	GasOption,
	JsonRpcResult,
} from "./types";
import {
	AbstractionKitError,
	BundlerErrorCodeDict,
	ensureError,
} from "./errors";

/**
 * Compute the UserOperation hash for EntryPoint v0.6.
 * This hash is what gets signed by the account owner(s).
 *
 * @param useroperation - UserOperation to create the hash for
 * @param entrypointAddress - EntryPoint contract address
 * @param chainId - Target chain ID
 * @returns The UserOperation hash as a hex string
 *
 * @example
 * const hash = createUserOperationHash(userOp, "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789", 1n);
 */
export function createUserOperationHash(
	useroperation: UserOperation,
	entrypointAddress: string,
	chainId: bigint,
): string {
	const packedUserOperationHash = keccak256(
		createPackedUserOperation(useroperation),
	);

	const abiCoder = AbiCoder.defaultAbiCoder();
	const encodedUserOperationHash = abiCoder.encode(
		["bytes32", "address", "uint256"],
		[packedUserOperationHash, entrypointAddress, chainId],
	);

	const userOperationHash = keccak256(encodedUserOperationHash);

	return userOperationHash;
}

/**
 * ABI-encode and pack a UserOperation for hashing (EntryPoint v0.6 format).
 * Bytes fields (initCode, callData, paymasterAndData) are keccak256-hashed before packing.
 *
 * @param useroperation - UserOperation to pack
 * @returns ABI-encoded packed UserOperation as a hex string
 */
export function createPackedUserOperation(
	useroperation: UserOperation,
): string {
	const useroperationValuesArrayWithHashedByteValues = [
		useroperation.sender,
		useroperation.nonce,
		keccak256(useroperation.initCode),
		keccak256(useroperation.callData),
		useroperation.callGasLimit,
		useroperation.verificationGasLimit,
		useroperation.preVerificationGas,
		useroperation.maxFeePerGas,
		useroperation.maxPriorityFeePerGas,
		keccak256(useroperation.paymasterAndData),
	];

	const abiCoder = AbiCoder.defaultAbiCoder();
	const packedUserOperation = abiCoder.encode(
		[
			"address",
			"uint256",
			"bytes32",
			"bytes32",
			"uint256",
			"uint256",
			"uint256",
			"uint256",
			"uint256",
			"bytes32",
		],
		useroperationValuesArrayWithHashedByteValues,
	);
	return packedUserOperation;
}

/**
 * Encode a function call into ABI-encoded calldata.
 *
 * @param functionSelector - 4-byte hex function selector (e.g., "0xa9059cbb" for ERC-20 transfer)
 * @param functionInputAbi - Array of ABI type strings (e.g., ["address", "uint256"])
 * @param functionInputParameters - Array of parameter values matching the ABI types
 * @returns ABI-encoded calldata as a hex string (selector + encoded parameters)
 *
 * @example
 * const transferCallData = createCallData(
 *   "0xa9059cbb",
 *   ["address", "uint256"],
 *   ["0xRecipientAddress", 1000000n],
 * );
 */
export function createCallData(
	functionSelector: string,
	functionInputAbi: string[],
	functionInputParameters: AbiInputValue[],
): string {
	const abiCoder = AbiCoder.defaultAbiCoder();
	const params: string = abiCoder.encode(
		functionInputAbi,
		functionInputParameters,
	);
	const callData = functionSelector + params.slice(2);

	return callData;
}

/**
 * Send a JSON-RPC request to the specified endpoint.
 * Automatically converts bigint values to hex strings in the request body.
 *
 * @param rpcUrl - The JSON-RPC endpoint URL (bundler, node, or paymaster)
 * @param method - The JSON-RPC method name (e.g., "eth_call", "eth_sendUserOperation")
 * @param params - The JSON-RPC parameters
 * @returns The result field from the JSON-RPC response
 * @throws AbstractionKitError if the RPC returns an error
 */
export async function sendJsonRpcRequest(
	rpcUrl: string,
	method: string,
	params: JsonRpcParam,
): Promise<JsonRpcResult> {
	const fetch = fetchImport.default || fetchImport;

	const raw = JSON.stringify(
		{
			method: method,
			params: params,
			id: new Date().getTime(), //semi unique id
			jsonrpc: "2.0",
		},
		(key, value) =>
			// change all bigint values to "0x" prefixed hex strings
			// eslint-disable-next-line @typescript-eslint/no-unsafe-return
			typeof value === "bigint" ? "0x" + value.toString(16) : value,
	);
	const requestOptions: RequestInit = {
		method: "POST",
		body: raw,
		redirect: "follow",
	};
	const fetchResult = await fetch(rpcUrl, requestOptions);
	const response = (await fetchResult.json()) as JsonRpcResponse;

	if ("result" in response) {
		return response.result as JsonRpcResult;
	} else {
		const err = response.error as JsonRpcError;
		const codeString = String(err.code);

		if (codeString in BundlerErrorCodeDict) {
			throw new AbstractionKitError(
				BundlerErrorCodeDict[codeString],
				err.message,
				{
					errno: err.code,
					context: {
						url: rpcUrl,
						requestOptions: JSON.stringify(requestOptions),
					},
				},
			);
		} else {
			throw new AbstractionKitError("UNKNOWN_ERROR", err.message, {
				errno: err.code,
				context: {
					url: rpcUrl,
					requestOptions: JSON.stringify(requestOptions),
				},
			});
		}
	}
}

/**
 * Get the 4-byte function selector from a function signature string.
 *
 * @param functionSignature - Solidity function signature (e.g., "transfer(address,uint256)")
 * @returns 4-byte hex function selector (e.g., "0xa9059cbb")
 *
 * @example
 * const selector = getFunctionSelector("transfer(address,uint256)");
 * // returns "0xa9059cbb"
 */
export function getFunctionSelector(functionSignature: string): string {
	return id(functionSignature).slice(0, 10);
}

/**
 * Fetch the account's nonce from the EntryPoint contract by calling getNonce(address,uint192).
 *
 * @param rpcUrl - Ethereum JSON-RPC node URL
 * @param entryPoint - EntryPoint contract address
 * @param account - Smart account address to query
 * @param key - Nonce key (default 0). Different keys allow parallel nonce channels.
 * @returns The current nonce as a bigint
 * @throws AbstractionKitError with code "BAD_DATA" if the nonce call fails or returns malformed data
 */
export async function fetchAccountNonce(
	rpcUrl: string,
	entryPoint: string,
	account: string,
	key: number = 0,
): Promise<bigint> {
	const getNonceFunctionSignature = "getNonce(address,uint192)";
	const getNonceFunctionSelector = getFunctionSelector(
		getNonceFunctionSignature,
	);
	const getNonceTransactionCallData = createCallData(
		getNonceFunctionSelector,
		["address", "uint192"],
		[account, key],
	);

	const params = [
		{
			from: "0x0000000000000000000000000000000000000000",
			to: entryPoint,
			data: getNonceTransactionCallData,
		},
		"latest",
	];

	try {
		const nonce = await sendJsonRpcRequest(rpcUrl, "eth_call", params);

		if (typeof nonce === "string") {
			try {
				return BigInt(nonce);
			} catch (err) {
				const error = ensureError(err);

				throw new AbstractionKitError(
					"BAD_DATA",
					"getNonce returned ill formed data",
					{
						cause: error,
					},
				);
			}
		} else {
			throw new AbstractionKitError(
				"BAD_DATA",
				"getNonce returned ill formed data",
				{
					context: JSON.stringify(nonce),
				},
			);
		}
	} catch (err) {
		const error = ensureError(err);

		throw new AbstractionKitError("BAD_DATA", "getNonce failed", {
			cause: error,
		});
	}
}

/**
 * Fetch current gas prices (maxFeePerGas and maxPriorityFeePerGas) from a JSON-RPC node.
 * Applies a gas level multiplier to adjust for faster or cheaper inclusion.
 *
 * @param provideRpc - Ethereum JSON-RPC node URL
 * @param gasLevel - Gas price multiplier (default: GasOption.Medium = 1.2x)
 * @returns A tuple of [maxFeePerGas, maxPriorityFeePerGas] as bigints
 *
 * @example
 * const [maxFeePerGas, maxPriorityFeePerGas] = await fetchGasPrice(nodeRpcUrl, GasOption.Fast);
 */
export async function fetchGasPrice(
	provideRpc: string,
	gasLevel: GasOption = GasOption.Medium,
): Promise<[bigint, bigint]> {
	const jsonRpcProvider = new JsonRpcProvider(provideRpc);
	const feeData = await jsonRpcProvider.getFeeData();
	const maxFeePerGas = BigInt(
		Math.ceil(Number(feeData.maxFeePerGas) * gasLevel),
	);
	const maxPriorityFeePerGas = BigInt(
		Math.ceil(Number(feeData.maxPriorityFeePerGas) * gasLevel),
	);

	return [maxFeePerGas, maxPriorityFeePerGas];
}

/**
 * Calculate the maximum gas cost (in wei) that a UserOperation could consume.
 * Accounts for the paymaster verification overhead multiplier (3x when no paymaster).
 *
 * @param useroperation - The UserOperation to calculate the max gas cost for
 * @returns Maximum possible gas cost in wei as a bigint
 *
 * @example
 * const maxCost = calculateUserOperationMaxGasCost(userOp);
 */
export function calculateUserOperationMaxGasCost(
	useroperation: UserOperation,
): bigint {
	const isPaymasterAndData =
		useroperation.paymasterAndData == "0x" ||
		useroperation.paymasterAndData == null;
	const mul = isPaymasterAndData ? 3n : 0n;
	const requiredGas =
		useroperation.callGasLimit +
		useroperation.verificationGasLimit * mul +
		useroperation.preVerificationGas;

	return requiredGas * useroperation.maxFeePerGas;
}
