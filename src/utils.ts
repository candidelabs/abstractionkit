import * as fetchImport from "isomorphic-unfetch";

import { id, AbiCoder, keccak256, JsonRpcProvider } from "ethers";

import type { BytesLike } from "ethers";

import { 
	AbiInputValue, 
	UserOperation, 
	JsonRpcResponse, 
	JsonRpcParam,
	JsonRpcError,
	GasOption,
 } from "./types";

 /**
  * createUserOperationHash for the standard entrypointv0.6 hash
  * @param useroperation 
  * @param entrypointAddress 
  * @param chainId 
  * @returns UserOperationHash
  */
export function createUserOperationHash(
	useroperation: UserOperation,
	entrypointAddress: string,
	chainId: bigint,
): BytesLike {
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
 * @param useroperation 
 * @returns packed UserOperation
 */
export function createPackedUserOperation(
	useroperation: UserOperation,
): BytesLike {
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
 * @param functionSelector 
 * @param functionInputAbi 
 * @param functionInputParameters 
 * @returns calldata
 */
export function createCallData(
	functionSelector: string,
	functionInputAbi: string[],
	functionInputParameters: AbiInputValue[],
): BytesLike {
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
): Promise<JsonRpcResponse> {
	const fetch = fetchImport.default || fetchImport;

	const raw = JSON.stringify({
		method: method,
		params: params,
		id: 1,
		jsonrpc: "2.0",
	},(key, value) =>
		// change all bigint values to "0x" prefixed hex strings
		// eslint-disable-next-line @typescript-eslint/no-unsafe-return
		typeof value === 'bigint'
			? '0x' + value.toString(16)
			: value
	);
	const requestOptions: RequestInit = {
		method: "POST",
		body: raw,
		redirect: "follow",
	};

	const response = await fetch(rpcUrl, requestOptions);

	return await response.json() as JsonRpcResponse;
}

/**
 * get function selector from the function signature
 * @param functionSignature 
 * @returns fucntion selector
 * 
 * @example
 * const getNonceFunctionSignature =  'getNonce(address,uint192)';
 * const getNonceFunctionSelector =  getFunctionSelector(getNonceFunctionSignature);
 */
export function getFunctionSelector(
	functionSignature: string,
): string {
	return id(functionSignature).slice(0,10);
}

/**
 * fetch account nonce by calling the entrypoint's "getNonce"
 * @param rpcUrl 
 * @param entryPoint 
 * @param account 
 * @param key 
 * @returns nonce
 */
export async function fetchAccountNonce(
	rpcUrl: string,
	entryPoint:string,
	account: string,
	key: number=0,
): Promise<bigint | JsonRpcError> {
	const getNonceFunctionSignature =  'getNonce(address,uint192)';
    const getNonceFunctionSelector =  getFunctionSelector(getNonceFunctionSignature);
    const getNonceTransactionCallData = createCallData(
		getNonceFunctionSelector, 
		["address", "uint192"],
		[account, key]
	);

	const params = [
		{
			"from": "0x0000000000000000000000000000000000000000",
			"to": entryPoint,
			"data": getNonceTransactionCallData,
		},
		"latest",
	]

	const jsonRpcResult = await sendJsonRpcRequest(
		rpcUrl,
		"eth_call",
		params,
	);

	if ("result" in jsonRpcResult) {
		return BigInt(jsonRpcResult.result as string);
	} else {
		return jsonRpcResult.error as JsonRpcError;
	}
}

export async function fetchGasPrice(
	provideRpc:string, gasLevel: GasOption = GasOption.Medium
):Promise<[bigint,bigint]>{
	const jsonRpcProvider = new JsonRpcProvider(provideRpc)
	const feeData = await jsonRpcProvider.getFeeData()
	const maxFeePerGas = BigInt(Math.ceil(
		Number(feeData.maxFeePerGas)*gasLevel))
	const maxPriorityFeePerGas = BigInt(Math.ceil(
		Number(feeData.maxPriorityFeePerGas)*gasLevel))

	return [maxFeePerGas, maxPriorityFeePerGas]
}

export function calculateUserOperationMaxGasCost(
	useroperation: UserOperation,
):bigint{
	const isPaymasterAndData = useroperation.paymasterAndData == "0x" || useroperation.paymasterAndData == null
	const mul = isPaymasterAndData?3n:0n
	const requiredGas = useroperation.callGasLimit + useroperation.verificationGasLimit * mul + useroperation.preVerificationGas;

	return requiredGas * useroperation.maxFeePerGas
}