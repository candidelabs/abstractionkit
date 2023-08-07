import * as fetchImport from "isomorphic-unfetch";

import { AbiCoder, keccak256 } from "ethers";

import type { AddressLike, BytesLike, BigNumberish } from "ethers";

import type { AbiInputValue, UserOperation, JsonRpcResponse, JsonRpcParam } from "./types";

export function getUserOperationHash(
	useroperation: UserOperation,
	entrypointAddress: AddressLike,
	chainId: BigNumberish,
): BytesLike {
	const packedUserOperationHash = keccak256(
		getPackedUserOperation(useroperation),
	);

	const abiCoder = AbiCoder.defaultAbiCoder();
	const encodedUserOperationHash = abiCoder.encode(
		["bytes32", "address", "uint256"],
		[packedUserOperationHash, entrypointAddress, chainId],
	);

	const userOperationHash = keccak256(encodedUserOperationHash);

	return userOperationHash;
}

export function getPackedUserOperation(
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

export function getCallData(
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