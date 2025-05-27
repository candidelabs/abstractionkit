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
	UserOperationV8,
    PolygonChain,
    PolygonGasStationJsonRpcResponse,
} from "./types";
import {
	AbstractionKitError,
	BundlerErrorCodeDict,
	ensureError,
} from "./errors";
import { ENTRYPOINT_V6, ENTRYPOINT_V7, ENTRYPOINT_V8 } from "./constants";

function buildDomainSeparatorV8(chainId: bigint): string{
    // DOMAIN_NAME = "ERC4337"
    const hashed_name = "0x364da28a5c92bcc87fe97c8813a6c6b8a3a049b0ea0a328fcb0b4f0e00337586"; 

    // DOMAIN_VERSION = "1"
    const hashed_version = "0xc89efdaa54c0f20c7adf612882df0950f5a951637e0307cdcb4c672f298b8bc6";

    // TYPE_HASH = keccak("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    const type_hash = "0x8b73c3c69bb8fe3d512ecc4cf759cc79239f7b179b0ffacaa9a75d522b39400f";

    const abiCoder = AbiCoder.defaultAbiCoder();
    const encodedUserOperationHash = abiCoder.encode(
        ["(bytes32,bytes32,bytes32,uint256,address)"],
        [[type_hash, hashed_name, hashed_version, chainId, ENTRYPOINT_V8]],
    );
    return keccak256(encodedUserOperationHash);
}

/**
 * createUserOperationHash for the standard entrypointv0.6 hash
 * @param useroperation - useroperation to create hash for
 * @param entrypointAddress - supported entrypoint
 * @param chainId - target chain id
 * @returns UserOperationHash
 */
export function createUserOperationHash(
	useroperation: UserOperationV6 | UserOperationV7 | UserOperationV8,
	entrypointAddress: string,
	chainId: bigint,
): string {
	let packedUserOperationHash: string;
    const abiCoder = AbiCoder.defaultAbiCoder();
	let userOperationHash;
	if (entrypointAddress.toLowerCase() == ENTRYPOINT_V6.toLowerCase()) {
		packedUserOperationHash = keccak256(
			createPackedUserOperationV6(useroperation as UserOperationV6),
		);
        const encodedUserOperationHash = abiCoder.encode(
            ["bytes32", "address", "uint256"],
            [packedUserOperationHash, entrypointAddress, chainId],
        );
        userOperationHash = keccak256(encodedUserOperationHash);
    }else if (entrypointAddress.toLowerCase() == ENTRYPOINT_V7.toLowerCase()) {
		packedUserOperationHash = keccak256(
			createPackedUserOperationV7(useroperation as UserOperationV7),
		);
        const encodedUserOperationHash = abiCoder.encode(
            ["bytes32", "address", "uint256"],
            [packedUserOperationHash, entrypointAddress, chainId],
        );
        userOperationHash = keccak256(encodedUserOperationHash);
	}else{
        packedUserOperationHash = keccak256(
			createPackedUserOperationV8(useroperation as UserOperationV8),
		);
        const domainSeparator = buildDomainSeparatorV8(chainId);
        userOperationHash = keccak256(
            "0x1901" + domainSeparator.slice(2) + packedUserOperationHash.slice(2));
    }

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
 * createPackedUserOperation for the standard entrypointv0.8 hash
 * @param useroperation -useroperation to pack
 * @returns packed UserOperation
 */
export function createPackedUserOperationV8(
	useroperation: UserOperationV8,
): string {
	const abiCoder = AbiCoder.defaultAbiCoder();

	let initCode = "0x";
	if (useroperation.factory != null) {
        const eip7702Auth = useroperation.eip7702Auth;
        if (eip7702Auth != null && eip7702Auth.address != null){
            initCode = eip7702Auth.address; 
        }else{
            initCode = useroperation.factory;
        }
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
        // PACKED_USEROP_TYPEHASH
        "0x29a0bca4af4be3421398da00295e58e6d7de38cb492214754cb6a47507dd6f8e",
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
			"bytes32",
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
    headers: Record<string, string> = { "Content-Type": "application/json" },
    paramsKeyName: string = "params",
): Promise<JsonRpcResult> {
	const fetch = fetchImport.default || fetchImport;
	const raw = JSON.stringify(
		{
			method: method,
			[paramsKeyName]: params,
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
		headers, 
		body: raw,
		redirect: "follow",
	};
	const fetchResult = await fetch(rpcUrl, requestOptions);
	const response = (await fetchResult.json()) as JsonRpcResponse;

	if ("result" in response) {
		return response.result as JsonRpcResult;
	} else if ("simulation_results" in response) {
		return response.simulation_results as JsonRpcResult;
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
    try{
        const jsonRpcProvider = new JsonRpcProvider(provideRpc);
        const feeData = await jsonRpcProvider.getFeeData();
        let maxFeePerGas:bigint;
        let maxPriorityFeePerGas:bigint;

        if(feeData.maxFeePerGas != null && feeData.maxPriorityFeePerGas != null){
            maxFeePerGas = BigInt(
                Math.ceil(Number(feeData.maxFeePerGas) * gasLevel),
            );
            maxPriorityFeePerGas = BigInt(
                Math.ceil(Number(feeData.maxPriorityFeePerGas) * gasLevel),
            );
        }else if(feeData.gasPrice != null){
            maxFeePerGas = BigInt(
                Math.ceil(Number(feeData.gasPrice) * gasLevel),
            );
            maxPriorityFeePerGas = maxFeePerGas;
        }
        else{
            maxFeePerGas = BigInt(Math.ceil(1000000000 * gasLevel));
            maxPriorityFeePerGas = maxFeePerGas;
        }

        if (maxFeePerGas == 0n) {
            maxFeePerGas = 1n;
        }
        if (maxPriorityFeePerGas == 0n) {
            maxPriorityFeePerGas = 1n;
        }

        return [maxFeePerGas, maxPriorityFeePerGas];
    }catch (err) {
        const error = ensureError(err);

        throw new AbstractionKitError(
            "BAD_DATA",
            "fetching gas prices from node failed.", {
            cause: error,
        });
    }
}

export async function fetchGasPricePolygon(
	polygonChain: PolygonChain,
	gasLevel: GasOption = GasOption.Medium,
): Promise<[bigint, bigint]> {
    const gasStationUrl = 'https://gasstation.polygon.technology/' + polygonChain;
    try{
        const fetchResult = await fetch(gasStationUrl);
        const response = (await fetchResult.json()) as PolygonGasStationJsonRpcResponse;
        let gasPrice;
        if(gasLevel == GasOption.Slow){
           gasPrice = response.safeLow; 
        }else if(gasLevel == GasOption.Medium){
           gasPrice = response.standard; 
        }else{
           gasPrice = response.fast; 
        }
        let maxFeePerGas = BigInt(
            Math.ceil(Number(gasPrice.maxFee) * 1000000000),
        );
        let maxPriorityFeePerGas = BigInt(
            Math.ceil(Number(gasPrice.maxPriorityFee) * 1000000000),
        );

        if (maxFeePerGas == 0n) {
            maxFeePerGas = 1n;
        }
        if (maxPriorityFeePerGas == 0n) {
            maxPriorityFeePerGas = 1n;
        }

        return [maxFeePerGas, maxPriorityFeePerGas];
    }catch (err) {
        const error = ensureError(err);

        throw new AbstractionKitError(
            "BAD_DATA",
            "fetching gas prices from " + gasStationUrl + " failed.", {
            cause: error,
        });
    }
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

export type DepositInfo = {
    deposit: bigint;
    staked: boolean;
    stake:bigint;
    unstakeDelaySec: bigint;
    withdrawTime: bigint;
};

export async function getBalanceOf(
	nodeRpcUrl: string,
	address: string,
	entrypointAddress: string,
): Promise<bigint> {
   const depositInfo = await getDepositInfo(
        nodeRpcUrl, address, entrypointAddress
    )
    return depositInfo.deposit;
}

export async function getDepositInfo(
	nodeRpcUrl: string,
	address: string,
	entrypointAddress: string,
): Promise<DepositInfo> {
	const getDepositInfoSelector = "0x5287ce12"; //"getDepositInfo(address)"
	const getDepositInfoCallData = createCallData(
		getDepositInfoSelector,
		["address"],
		[address],
	);

	const params = {
        from: "0x0000000000000000000000000000000000000000",
        to: entrypointAddress,
        data: getDepositInfoCallData,
    };

	try {
        const depositInfoRequestResult = await sendEthCallRequest(
            nodeRpcUrl, params, "latest");

        const abiCoder = AbiCoder.defaultAbiCoder();
	    const decodedCalldata = abiCoder.decode(
            ["uint256", "bool", "uint112", "uint32", "uint48"],
            depositInfoRequestResult
        );


		if (decodedCalldata.length === 5) {
			try {
				return {
                    deposit:BigInt(decodedCalldata[0]),
                    staked:Boolean(decodedCalldata[1]),
                    stake:BigInt(decodedCalldata[2]),
                    unstakeDelaySec:BigInt(decodedCalldata[3]),
                    withdrawTime:BigInt(decodedCalldata[4]),
                };
			} catch (err) {
				const error = ensureError(err);

				throw new AbstractionKitError(
					"BAD_DATA",
					"getDepositInfo returned ill formed data",
					{
						cause: error,
					},
				);
			}
		} else {
			throw new AbstractionKitError(
				"BAD_DATA",
				"getDepositInfo returned ill formed data",
				{
					context: JSON.stringify(decodedCalldata),
				},
			);
		}
	} catch (err) {
		const error = ensureError(err);

		throw new AbstractionKitError("BAD_DATA", "getDepositInfo failed", {
			cause: error,
		});
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

export async function handlefetchGasPrice(
    providerRpc: string | undefined,
    polygonGasStation: PolygonChain | undefined,
    gasLevel: GasOption = GasOption.Medium,
): Promise<[bigint, bigint]> {
    let maxFeePerGas:bigint;
    let maxPriorityFeePerGas:bigint;

    if (polygonGasStation != null) {
        [maxFeePerGas, maxPriorityFeePerGas] = await fetchGasPricePolygon(
                polygonGasStation, gasLevel);
    }
    else if (providerRpc != null) {
        [maxFeePerGas, maxPriorityFeePerGas] =
            await fetchGasPrice(providerRpc, gasLevel);
    } else {
        throw new AbstractionKitError(
            "BAD_DATA",
            "providerRpc cant't be null if maxFeePerGas and " +
                "maxPriorityFeePerGas are not overriden",
        );
    }
    return [maxFeePerGas, maxPriorityFeePerGas];
}
