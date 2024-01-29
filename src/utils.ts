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
 * createUserOperationHash for the standard entrypointv0.6 hash
 * @param useroperation - useroperation to create hash for
 * @param entrypointAddress - supported entrypoint
 * @param chainId - target chain id
 * @returns UserOperationHash
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
 * createPackedUserOperation for the standard entrypointv0.6 hash
 * @param useroperation -useroperation to pack
 * @returns packed UserOperation
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
 * creates calldata from the function selector, abi and parameters
 * @param functionSelector- hexstring representation of the first four bytes of the hash of the signature of the function
 * @param functionInputAbi - list of input api types
 * @param functionInputParameters - list of input parameters values
 * @returns calldata
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
 * get function selector from the function signature
 * @param functionSignature - example of a function signature "mint(address)"
 * @returns fucntion selector - hexstring representation of the first four bytes of the hash of the signature of the function
 *
 * @example
 * const getNonceFunctionSignature =  'getNonce(address,uint192)';
 * const getNonceFunctionSelector =  getFunctionSelector(getNonceFunctionSignature);
 */
export function getFunctionSelector(functionSignature: string): string {
	return id(functionSignature).slice(0, 10);
}

/**
 * fetch account nonce by calling the entrypoint's "getNonce"
 * @param rpcUrl -node rpc to fetch account nonce and gas prices
 * @param entryPoint - target entrypoint
 * @param account - target ccount
 * @param key - nonce key
 * @returns promise with nonce
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
