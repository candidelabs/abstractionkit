import * as fetchImport from "isomorphic-unfetch";

import { id, AbiCoder, keccak256, JsonRpcProvider } from "ethers";

import {
	AbiInputValue,
	UserOperationV6,
	JsonRpcResponse,
	JsonRpcParam,
	JsonRpcError,
	GasOption,
	JsonRpcResult,
	UserOperationV7,
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
	useroperation: UserOperationV6 | UserOperationV7,
	entrypointAddress: string,
	chainId: bigint,
): string {
	let packedUserOperationHash: string;
	if ("initCode" in useroperation) {
		packedUserOperationHash = keccak256(
			createPackedUserOperationV6(useroperation),
		);
	} else {
		packedUserOperationHash = keccak256(
			createPackedUserOperationV7(useroperation),
		);
	}

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
export function createPackedUserOperationV6(
	useroperation: UserOperationV6,
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
 * createPackedUserOperation for the standard entrypointv0.7 hash
 * @param useroperation -useroperation to pack
 * @returns packed UserOperation
 */
export function createPackedUserOperationV7(
	useroperation: UserOperationV7,
): string {
	const abiCoder = AbiCoder.defaultAbiCoder();

	let initCode = "0x";
	if (useroperation.factory != null) {
		initCode = useroperation.factory;
		if (useroperation.factoryData != null) {
			initCode += useroperation.factoryData.slice(2);
		}
	}

	const accountGasLimits =
		"0x" +
		abiCoder
			.encode(["uint128"], [useroperation.verificationGasLimit])
			.slice(34) +
		abiCoder.encode(["uint128"], [useroperation.callGasLimit]).slice(34);

	const gasFees =
		"0x" +
		abiCoder
			.encode(["uint128"], [useroperation.maxPriorityFeePerGas])
			.slice(34) +
		abiCoder.encode(["uint128"], [useroperation.maxFeePerGas]).slice(34);

	let paymasterAndData = "0x";
	if (useroperation.paymaster != null) {
		paymasterAndData = useroperation.paymaster;
		if (useroperation.paymasterVerificationGasLimit != null) {
			paymasterAndData += abiCoder
				.encode(["uint128"], [useroperation.paymasterVerificationGasLimit])
				.slice(34);
		}
		if (useroperation.paymasterPostOpGasLimit != null) {
			paymasterAndData += abiCoder
				.encode(["uint128"], [useroperation.paymasterPostOpGasLimit])
				.slice(34);
		}
		if (useroperation.paymasterData != null) {
			paymasterAndData += useroperation.paymasterData.slice(2);
		}
	}

	const useroperationValuesArrayWithHashedByteValues = [
		useroperation.sender,
		useroperation.nonce,
		keccak256(initCode),
		keccak256(useroperation.callData),
		accountGasLimits,
		useroperation.preVerificationGas,
		gasFees,
		keccak256(paymasterAndData),
	];

	const packedUserOperation = abiCoder.encode(
		[
			"address",
			"uint256",
			"bytes32",
			"bytes32",
			"bytes32",
			"uint256",
			"bytes32",
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
		headers: { "Content-Type": "application/json" },
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
	useroperation: UserOperationV6 | UserOperationV7,
): bigint {
	if ("initCode" in useroperation) {
		const isPaymasterAndData =
			useroperation.paymasterAndData == "0x" ||
			useroperation.paymasterAndData == null;
		const mul = isPaymasterAndData ? 3n : 0n;
		const requiredGas =
			useroperation.callGasLimit +
			useroperation.verificationGasLimit * mul +
			useroperation.preVerificationGas;
		return requiredGas * useroperation.maxFeePerGas;
	} else {
		const requiredGas =
			useroperation.verificationGasLimit +
			useroperation.callGasLimit +
			(useroperation.paymasterVerificationGasLimit ?? 0n) +
			(useroperation.paymasterPostOpGasLimit ?? 0n) +
			useroperation.preVerificationGas;

		return requiredGas * useroperation.maxFeePerGas;
	}
}

type EthCallTransaction = {
	from?: string;
	to: string;
	gas?: bigint;
	gasPrice?: bigint;
	value?: bigint;
	data?: string;
};

export async function sendEthCallRequest(
	nodeRpcUrl: string,
	ethCallTransaction: EthCallTransaction,
	blockNumber: string | bigint,
    stateOverrides?:object
): Promise<string> {
    let params = [];
    if(stateOverrides == null){
	    params = [ethCallTransaction, blockNumber];
    }else{
	    params = [ethCallTransaction, blockNumber, stateOverrides];
    }

	try {
		const data = await sendJsonRpcRequest(nodeRpcUrl, "eth_call", params);

		if (typeof data === "string") {
			try {
				return data;
			} catch (err) {
				const error = ensureError(err);

				throw new AbstractionKitError(
					"BAD_DATA",
					"eth_call returned ill formed data",
					{
						cause: error,
					},
				);
			}
		} else {
			throw new AbstractionKitError(
				"BAD_DATA",
				"eth_call returned ill formed data",
				{
					context: JSON.stringify(data),
				},
			);
		}
	} catch (err) {
		const error = ensureError(err);

		throw new AbstractionKitError("BAD_DATA", "eth_call failed", {
			cause: error,
		});
	}
}

export async function sendEthGetCodeRequest(
	nodeRpcUrl: string,
	contractAddress: string,
	blockNumber: string | bigint,
): Promise<string> {
	const params = [contractAddress, blockNumber];

	try {
		const data = await sendJsonRpcRequest(nodeRpcUrl, "eth_getCode", params);

		if (typeof data === "string") {
			try {
				return data;
			} catch (err) {
				const error = ensureError(err);

				throw new AbstractionKitError(
					"BAD_DATA",
					"eth_getCode returned ill formed data",
					{
						cause: error,
					},
				);
			}
		} else {
			throw new AbstractionKitError(
				"BAD_DATA",
				"eth_getCode returned ill formed data",
				{
					context: JSON.stringify(data),
				},
			);
		}
	} catch (err) {
		const error = ensureError(err);

		throw new AbstractionKitError("BAD_DATA", "eth_getCode failed", {
			cause: error,
		});
	}
}
