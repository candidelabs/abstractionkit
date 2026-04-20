import { AbiCoder, getAddress, id, JsonRpcProvider, keccak256 } from "ethers";
import { ENTRYPOINT_V6, ENTRYPOINT_V7, ENTRYPOINT_V8, ENTRYPOINT_V9 } from "./constants";
import { AbstractionKitError, BundlerErrorCodeDict, ensureError } from "./errors";
import {
	type AbiInputValue,
	GasOption,
	type GasPrice,
	type JsonRpcError,
	type JsonRpcParam,
	type JsonRpcResponse,
	type JsonRpcResult,
	type PolygonChain,
	type PolygonGasStationJsonRpcResponse,
	type UserOperationV6,
	type UserOperationV7,
	type UserOperationV8,
	type UserOperationV9,
} from "./types";

function buildDomainSeparator(chainId: bigint, entrypoint: string): string {
	// DOMAIN_NAME = "ERC4337"
	const hashed_name = "0x364da28a5c92bcc87fe97c8813a6c6b8a3a049b0ea0a328fcb0b4f0e00337586";

	// DOMAIN_VERSION = "1"
	const hashed_version = "0xc89efdaa54c0f20c7adf612882df0950f5a951637e0307cdcb4c672f298b8bc6";

	// TYPE_HASH = keccak("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
	const type_hash = "0x8b73c3c69bb8fe3d512ecc4cf759cc79239f7b179b0ffacaa9a75d522b39400f";

	const abiCoder = AbiCoder.defaultAbiCoder();
	const encodedUserOperationHash = abiCoder.encode(
		["(bytes32,bytes32,bytes32,uint256,address)"],
		[[type_hash, hashed_name, hashed_version, chainId, entrypoint]],
	);
	return keccak256(encodedUserOperationHash);
}

/**
 * Compute the UserOperation hash for any supported EntryPoint version.
 * This hash is what gets signed by the account owner(s).
 * Automatically selects the correct packing format based on the entrypoint address.
 *
 * @param useroperation - UserOperation to hash
 * @param entrypointAddress - EntryPoint contract address (determines hash format)
 * @param chainId - Target chain ID
 * @returns The UserOperation hash as a hex string
 */
export function createUserOperationHash(
	useroperation: UserOperationV6 | UserOperationV7 | UserOperationV8 | UserOperationV9,
	entrypointAddress: string,
	chainId: bigint,
): string {
	let packedUserOperationHash: string;
	const abiCoder = AbiCoder.defaultAbiCoder();
	let userOperationHash: string;
	if (entrypointAddress.toLowerCase() === ENTRYPOINT_V6.toLowerCase()) {
		packedUserOperationHash = keccak256(
			createPackedUserOperationV6(useroperation as UserOperationV6),
		);
		const encodedUserOperationHash = abiCoder.encode(
			["bytes32", "address", "uint256"],
			[packedUserOperationHash, entrypointAddress, chainId],
		);
		userOperationHash = keccak256(encodedUserOperationHash);
	} else if (entrypointAddress.toLowerCase() === ENTRYPOINT_V7.toLowerCase()) {
		packedUserOperationHash = keccak256(
			createPackedUserOperationV7(useroperation as UserOperationV7),
		);
		const encodedUserOperationHash = abiCoder.encode(
			["bytes32", "address", "uint256"],
			[packedUserOperationHash, entrypointAddress, chainId],
		);
		userOperationHash = keccak256(encodedUserOperationHash);
	} else if (entrypointAddress.toLowerCase() === ENTRYPOINT_V8.toLowerCase()) {
		packedUserOperationHash = keccak256(
			createPackedUserOperationV8(useroperation as UserOperationV8),
		);
		const domainSeparator = buildDomainSeparator(chainId, entrypointAddress);
		userOperationHash = keccak256(
			`0x1901${domainSeparator.slice(2)}${packedUserOperationHash.slice(2)}`,
		);
	} else if (entrypointAddress.toLowerCase() === ENTRYPOINT_V9.toLowerCase()) {
		packedUserOperationHash = keccak256(
			createPackedUserOperationV9(useroperation as UserOperationV8),
		);
		const domainSeparator = buildDomainSeparator(chainId, entrypointAddress);
		userOperationHash = keccak256(
			`0x1901${domainSeparator.slice(2)}${packedUserOperationHash.slice(2)}`,
		);
	} else {
		throw new RangeError(`unsupported entrypoint address: ${entrypointAddress}`);
	}

	return userOperationHash;
}

/**
 * ABI-encode and pack a UserOperation for hashing (EntryPoint v0.6 format).
 * Bytes fields (initCode, callData, paymasterAndData) are keccak256-hashed before packing.
 *
 * @param useroperation - UserOperation to pack
 * @returns ABI-encoded packed UserOperation as a hex string
 */
export function createPackedUserOperationV6(useroperation: UserOperationV6): string {
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
 * ABI-encode and pack a UserOperation for hashing (EntryPoint v0.7 format).
 * Reconstructs initCode, accountGasLimits, gasFees, and paymasterAndData from separate fields.
 *
 * @param useroperation - UserOperation to pack
 * @returns ABI-encoded packed UserOperation as a hex string
 */
export function createPackedUserOperationV7(useroperation: UserOperationV7): string {
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
		abiCoder.encode(["uint128"], [useroperation.verificationGasLimit]).slice(34) +
		abiCoder.encode(["uint128"], [useroperation.callGasLimit]).slice(34);

	const gasFees =
		"0x" +
		abiCoder.encode(["uint128"], [useroperation.maxPriorityFeePerGas]).slice(34) +
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
		["address", "uint256", "bytes32", "bytes32", "bytes32", "uint256", "bytes32", "bytes32"],
		useroperationValuesArrayWithHashedByteValues,
	);
	return packedUserOperation;
}

/**
 * ABI-encode and pack a UserOperation for hashing (EntryPoint v0.9 format).
 *
 * @param useroperation - UserOperation to pack
 * @returns ABI-encoded packed UserOperation as a hex string
 */
export function createPackedUserOperationV9(useroperation: UserOperationV8): string {
	return baseCreatePackedUserOperationV8V9(useroperation, true);
}

/**
 * ABI-encode and pack a UserOperation for hashing (EntryPoint v0.8 format).
 *
 * @param useroperation - UserOperation to pack
 * @returns ABI-encoded packed UserOperation as a hex string
 */
export function createPackedUserOperationV8(useroperation: UserOperationV8): string {
	return baseCreatePackedUserOperationV8V9(useroperation, false);
}

/**
 * createPackedUserOperation for the standard entrypointv0.8 hash
 * @param useroperation -useroperation to pack
 * @returns packed UserOperation
 */
function baseCreatePackedUserOperationV8V9(
	useroperation: UserOperationV8 | UserOperationV9,
	is_v9: boolean,
): string {
	const abiCoder = AbiCoder.defaultAbiCoder();

	let initCode = "0x";
	if (useroperation.factory != null) {
		const eip7702Auth = useroperation.eip7702Auth;
		if (eip7702Auth != null && eip7702Auth.address != null) {
			initCode = eip7702Auth.address;
		} else {
			initCode = useroperation.factory;
		}
		if (useroperation.factoryData != null) {
			initCode += useroperation.factoryData.slice(2);
		}
	}

	const accountGasLimits =
		"0x" +
		abiCoder.encode(["uint128"], [useroperation.verificationGasLimit]).slice(34) +
		abiCoder.encode(["uint128"], [useroperation.callGasLimit]).slice(34);

	const gasFees =
		"0x" +
		abiCoder.encode(["uint128"], [useroperation.maxPriorityFeePerGas]).slice(34) +
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
			const PAYMASTER_SIG_MAGIC = "22e325a297439656";
			if (is_v9 && useroperation.paymasterData.toLowerCase().endsWith(PAYMASTER_SIG_MAGIC)) {
				const sigLenHex = useroperation.paymasterData.slice(
					useroperation.paymasterData.length - 16 - 4,
					useroperation.paymasterData.length - 16,
				);
				const sigLen = parseInt(sigLenHex, 16);
				const prefixEnd = useroperation.paymasterData.length - 16 - 4 - sigLen * 2;
				paymasterAndData +=
					useroperation.paymasterData.slice(0, prefixEnd).replaceAll("0x", "") +
					PAYMASTER_SIG_MAGIC;
			} else {
				paymasterAndData += useroperation.paymasterData.slice(2);
			}
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
	const params: string = abiCoder.encode(functionInputAbi, functionInputParameters);
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
 * @param headers - Custom HTTP headers (defaults to Content-Type: application/json)
 * @param paramsKeyName - Key name for the params field (defaults to "params")
 * @returns The result field from the JSON-RPC response
 * @throws AbstractionKitError if the RPC returns an error
 */
export async function sendJsonRpcRequest(
	rpcUrl: string,
	method: string,
	params: JsonRpcParam,
	headers: Record<string, string> = { "Content-Type": "application/json" },
	paramsKeyName: string = "params",
): Promise<JsonRpcResult> {
	const raw = JSON.stringify(
		{
			method: method,
			[paramsKeyName]: params,
			id: Date.now(), //semi unique id
			jsonrpc: "2.0",
		},
		(_key, value) =>
			// change all bigint values to "0x" prefixed hex strings
			// eslint-disable-next-line @typescript-eslint/no-unsafe-return
			typeof value === "bigint" ? `0x${value.toString(16)}` : value,
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
			throw new AbstractionKitError(BundlerErrorCodeDict[codeString], err.message, {
				errno: err.code,
				context: {
					url: rpcUrl,
					requestOptions: JSON.stringify(requestOptions),
				},
			});
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
 * Fetch the account's nonce from the EntryPoint contract.
 *
 * @param rpcUrl - Ethereum JSON-RPC node URL
 * @param entryPoint - EntryPoint contract address
 * @param account - Smart account address to query
 * @param key - Nonce key (default 0). Different keys allow parallel nonce channels.
 * @returns The current nonce as a bigint
 * @throws AbstractionKitError with code "BAD_DATA" if the nonce call fails
 */
export async function fetchAccountNonce(
	rpcUrl: string,
	entryPoint: string,
	account: string,
	key: number = 0,
): Promise<bigint> {
	const getNonceFunctionSignature = "getNonce(address,uint192)";
	const getNonceFunctionSelector = getFunctionSelector(getNonceFunctionSignature);
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

				throw new AbstractionKitError("BAD_DATA", "getNonce returned ill formed data", {
					cause: error,
				});
			}
		} else {
			throw new AbstractionKitError("BAD_DATA", "getNonce returned ill formed data", {
				context: JSON.stringify(nonce),
			});
		}
	} catch (err) {
		const error = ensureError(err);

		throw new AbstractionKitError("BAD_DATA", "getNonce failed", {
			cause: error,
		});
	}
}

/**
 * Fetch current gas prices from a JSON-RPC node.
 * Applies a gas level multiplier to adjust for faster or cheaper inclusion.
 *
 * @param provideRpc - Ethereum JSON-RPC node URL
 * @param gasLevel - Gas price multiplier (default: GasOption.Medium = 1.2x)
 * @returns A tuple of [maxFeePerGas, maxPriorityFeePerGas] as bigints
 */
export async function fetchGasPrice(
	provideRpc: string,
	gasLevel: GasOption = GasOption.Medium,
): Promise<[bigint, bigint]> {
	try {
		const jsonRpcProvider = new JsonRpcProvider(provideRpc);
		const feeData = await jsonRpcProvider.getFeeData();
		let maxFeePerGas: bigint;
		let maxPriorityFeePerGas: bigint;

		if (feeData.maxFeePerGas != null && feeData.maxPriorityFeePerGas != null) {
			maxFeePerGas = BigInt(Math.ceil(Number(feeData.maxFeePerGas) * gasLevel));
			maxPriorityFeePerGas = BigInt(Math.ceil(Number(feeData.maxPriorityFeePerGas) * gasLevel));
		} else if (feeData.gasPrice != null) {
			maxFeePerGas = BigInt(Math.ceil(Number(feeData.gasPrice) * gasLevel));
			maxPriorityFeePerGas = maxFeePerGas;
		} else {
			maxFeePerGas = BigInt(Math.ceil(1000000000 * gasLevel));
			maxPriorityFeePerGas = maxFeePerGas;
		}

		if (maxFeePerGas === 0n) {
			maxFeePerGas = 1n;
		}
		if (maxPriorityFeePerGas === 0n) {
			maxPriorityFeePerGas = 1n;
		}

		return [maxFeePerGas, maxPriorityFeePerGas];
	} catch (err) {
		const error = ensureError(err);

		throw new AbstractionKitError("BAD_DATA", "fetching gas prices from node failed.", {
			cause: error,
		});
	}
}

/**
 * Fetch current gas prices from the Polygon Gas Station API.
 *
 * @param polygonChain - Target Polygon chain (Mainnet, Amoy, etc.)
 * @param gasLevel - Gas price level (Slow, Medium, Fast)
 * @returns A tuple of [maxFeePerGas, maxPriorityFeePerGas] as bigints
 */
export async function fetchGasPricePolygon(
	polygonChain: PolygonChain,
	gasLevel: GasOption = GasOption.Medium,
): Promise<[bigint, bigint]> {
	const gasStationUrl = `https://gasstation.polygon.technology/${polygonChain}`;
	try {
		const fetchResult = await fetch(gasStationUrl);
		const response = (await fetchResult.json()) as PolygonGasStationJsonRpcResponse;
		let gasPrice: GasPrice;
		if (gasLevel === GasOption.Slow) {
			gasPrice = response.safeLow;
		} else if (gasLevel === GasOption.Medium) {
			gasPrice = response.standard;
		} else {
			gasPrice = response.fast;
		}
		let maxFeePerGas = BigInt(Math.ceil(Number(gasPrice.maxFee) * 1000000000));
		let maxPriorityFeePerGas = BigInt(Math.ceil(Number(gasPrice.maxPriorityFee) * 1000000000));

		if (maxFeePerGas === 0n) {
			maxFeePerGas = 1n;
		}
		if (maxPriorityFeePerGas === 0n) {
			maxPriorityFeePerGas = 1n;
		}

		return [maxFeePerGas, maxPriorityFeePerGas];
	} catch (err) {
		const error = ensureError(err);

		throw new AbstractionKitError("BAD_DATA", `fetching gas prices from ${gasStationUrl} failed.`, {
			cause: error,
		});
	}
}

/**
 * Calculate the maximum gas cost (in wei) that a UserOperation could consume.
 * Uses different formulas for v0.6 (with paymaster multiplier) and v0.7+ UserOperations.
 *
 * @param useroperation - The UserOperation to calculate the max gas cost for
 * @returns Maximum possible gas cost in wei as a bigint
 */
export function calculateUserOperationMaxGasCost(
	useroperation: UserOperationV6 | UserOperationV7,
): bigint {
	if ("initCode" in useroperation) {
		const isPaymasterAndData =
			useroperation.paymasterAndData !== "0x" && useroperation.paymasterAndData != null;
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

/**
 * Deposit information for an address in the EntryPoint contract.
 */
export type DepositInfo = {
	deposit: bigint;
	staked: boolean;
	stake: bigint;
	unstakeDelaySec: bigint;
	withdrawTime: bigint;
};

/**
 * Get the deposit balance of an address in the EntryPoint contract.
 *
 * @param nodeRpcUrl - Ethereum JSON-RPC node URL
 * @param address - Address to query the deposit for
 * @param entrypointAddress - EntryPoint contract address
 * @returns The deposit balance as a bigint
 */
export async function getBalanceOf(
	nodeRpcUrl: string,
	address: string,
	entrypointAddress: string,
): Promise<bigint> {
	const depositInfo = await getDepositInfo(nodeRpcUrl, address, entrypointAddress);
	return depositInfo.deposit;
}

/**
 * Get the full deposit info of an address from the EntryPoint contract.
 *
 * @param nodeRpcUrl - Ethereum JSON-RPC node URL
 * @param address - Address to query
 * @param entrypointAddress - EntryPoint contract address
 * @returns DepositInfo with deposit, staked, stake, unstakeDelaySec, withdrawTime
 */
export async function getDepositInfo(
	nodeRpcUrl: string,
	address: string,
	entrypointAddress: string,
): Promise<DepositInfo> {
	const getDepositInfoSelector = "0x5287ce12"; //"getDepositInfo(address)"
	const getDepositInfoCallData = createCallData(getDepositInfoSelector, ["address"], [address]);

	const params = {
		from: "0x0000000000000000000000000000000000000000",
		to: entrypointAddress,
		data: getDepositInfoCallData,
	};

	try {
		const depositInfoRequestResult = await sendEthCallRequest(nodeRpcUrl, params, "latest");

		const abiCoder = AbiCoder.defaultAbiCoder();
		const decodedCalldata = abiCoder.decode(
			["uint256", "bool", "uint112", "uint32", "uint48"],
			depositInfoRequestResult,
		);

		if (decodedCalldata.length === 5) {
			try {
				return {
					deposit: BigInt(decodedCalldata[0]),
					staked: Boolean(decodedCalldata[1]),
					stake: BigInt(decodedCalldata[2]),
					unstakeDelaySec: BigInt(decodedCalldata[3]),
					withdrawTime: BigInt(decodedCalldata[4]),
				};
			} catch (err) {
				const error = ensureError(err);

				throw new AbstractionKitError("BAD_DATA", "getDepositInfo returned ill formed data", {
					cause: error,
				});
			}
		} else {
			throw new AbstractionKitError("BAD_DATA", "getDepositInfo returned ill formed data", {
				context: JSON.stringify(decodedCalldata),
			});
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

/**
 * Send an eth_call JSON-RPC request with optional state overrides.
 *
 * @param nodeRpcUrl - Ethereum JSON-RPC node URL
 * @param ethCallTransaction - The call transaction parameters
 * @param blockNumber - Block number or "latest"
 * @param stateOverrides - Optional state overrides for the call
 * @returns The call result as a hex string
 */
export async function sendEthCallRequest(
	nodeRpcUrl: string,
	ethCallTransaction: EthCallTransaction,
	blockNumber: string | bigint,
	stateOverrides?: object,
): Promise<string> {
	let params = [];
	if (stateOverrides == null) {
		params = [ethCallTransaction, blockNumber];
	} else {
		params = [ethCallTransaction, blockNumber, stateOverrides];
	}

	try {
		const data = await sendJsonRpcRequest(nodeRpcUrl, "eth_call", params);

		if (typeof data === "string") {
			try {
				return data;
			} catch (err) {
				const error = ensureError(err);

				throw new AbstractionKitError("BAD_DATA", "eth_call returned ill formed data", {
					cause: error,
				});
			}
		} else {
			throw new AbstractionKitError("BAD_DATA", "eth_call returned ill formed data", {
				context: JSON.stringify(data),
			});
		}
	} catch (err) {
		const error = ensureError(err);

		throw new AbstractionKitError("BAD_DATA", "eth_call failed", {
			cause: error,
		});
	}
}

/**
 * Send an eth_getCode JSON-RPC request to check deployed bytecode.
 *
 * @param nodeRpcUrl - Ethereum JSON-RPC node URL
 * @param contractAddress - Contract address to query
 * @param blockNumber - Block number or "latest"
 * @returns The deployed bytecode as a hex string
 */
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

				throw new AbstractionKitError("BAD_DATA", "eth_getCode returned ill formed data", {
					cause: error,
				});
			}
		} else {
			throw new AbstractionKitError("BAD_DATA", "eth_getCode returned ill formed data", {
				context: JSON.stringify(data),
			});
		}
	} catch (err) {
		const error = ensureError(err);

		throw new AbstractionKitError("BAD_DATA", "eth_getCode failed", {
			cause: error,
		});
	}
}

/**
 * Check if an address is delegated via EIP-7702 and return the delegatee address.
 * EIP-7702 delegated accounts have bytecode in the format `0xef0100` + 20-byte address.
 *
 * @param accountAddress - The address to check
 * @param providerRpc - Ethereum JSON-RPC node URL
 * @returns The checksummed delegatee address, or `null` if not delegated
 */
export async function getDelegatedAddress(
	accountAddress: string,
	providerRpc: string,
): Promise<string | null> {
	const code = (await sendEthGetCodeRequest(providerRpc, accountAddress, "latest")).toLowerCase();
	if (code.length === 48 && code.startsWith("0xef0100")) {
		return getAddress(`0x${code.slice(8)}`);
	}
	return null;
}

/**
 * Fetch gas prices using either the Polygon Gas Station or a standard JSON-RPC node.
 *
 * @param providerRpc - Ethereum JSON-RPC node URL (used if polygonGasStation is null)
 * @param polygonGasStation - Polygon chain to use for gas station (takes priority)
 * @param gasLevel - Gas price multiplier (default: GasOption.Medium)
 * @returns A tuple of [maxFeePerGas, maxPriorityFeePerGas] as bigints
 */
export async function handlefetchGasPrice(
	providerRpc: string | undefined,
	polygonGasStation: PolygonChain | undefined,
	gasLevel: GasOption = GasOption.Medium,
): Promise<[bigint, bigint]> {
	let maxFeePerGas: bigint;
	let maxPriorityFeePerGas: bigint;

	if (polygonGasStation != null) {
		[maxFeePerGas, maxPriorityFeePerGas] = await fetchGasPricePolygon(polygonGasStation, gasLevel);
	} else if (providerRpc != null) {
		[maxFeePerGas, maxPriorityFeePerGas] = await fetchGasPrice(providerRpc, gasLevel);
	} else {
		throw new AbstractionKitError(
			"BAD_DATA",
			"providerRpc can't be null if maxFeePerGas and " + "maxPriorityFeePerGas are not overriden",
		);
	}
	return [maxFeePerGas, maxPriorityFeePerGas];
}
