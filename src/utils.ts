import {AbiCoder, id, keccak256} from "ethers";
import {ENTRYPOINT_V6, ENTRYPOINT_V7, ENTRYPOINT_V8, ENTRYPOINT_V9} from "./constants";
import {AbstractionKitError, ensureError} from "./errors";
import {JsonRpcNode, type Transport, TransportRpcError} from "./transport";
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
 * @internal
 * Reconstruct the packed `initCode` field for an EntryPoint v0.8/v0.9
 * UserOperation. When `eip7702Auth.address` is set, the EIP-7702 delegatee
 * address replaces the factory address in initCode (only `factoryData` is
 * concatenated). Otherwise, behaves like v0.7 (`factory + factoryData`).
 *
 * Shared by {@link createPackedUserOperationV8} /
 * {@link createPackedUserOperationV9} and Simple7702Account's typed-data
 * builder. Not part of the public API; only `export`ed for cross-module
 * use within the package and not re-exported from `src/abstractionkit.ts`.
 *
 * @param useroperation - V8 or V9 UserOperation to read fields from
 * @returns Hex-encoded initCode
 */
export function buildPackedInitCodeV8V9(useroperation: UserOperationV8 | UserOperationV9): string {
	if (useroperation.factory == null) return "0x";
	const eip7702Auth = useroperation.eip7702Auth;
	const head =
		eip7702Auth != null && eip7702Auth.address != null
			? eip7702Auth.address
			: useroperation.factory;
	const factoryData = useroperation.factoryData != null ? useroperation.factoryData.slice(2) : "";
	return head + factoryData;
}

/**
 * @internal
 * Reconstruct the packed `paymasterAndData` field from a UserOperation's
 * separate paymaster fields. Returns `0x` when no paymaster is set.
 *
 * For EntryPoint v0.9, when `paymasterData` ends with the parallel-paymaster
 * signature magic suffix (`0x22e325a297439656`), the embedded signature is
 * stripped so the userOpHash does not commit to the paymaster's signature
 * over itself. Pass `stripV9PaymasterSig=false` to preserve the wire format.
 *
 * Shared by v7/v8/v9 packers and Simple7702Account's typed-data builder.
 * Not part of the public API; only `export`ed for cross-module use within
 * the package and not re-exported from `src/abstractionkit.ts`.
 *
 * @param useroperation - V7/V8/V9 UserOperation to read fields from
 * @param stripV9PaymasterSig - Whether to strip the v0.9 paymaster signature suffix
 * @returns Hex-encoded paymasterAndData
 */
export function buildPaymasterAndData(
	useroperation: UserOperationV7 | UserOperationV8 | UserOperationV9,
	stripV9PaymasterSig: boolean = false,
): string {
	if (useroperation.paymaster == null) return "0x";
	const abiCoder = AbiCoder.defaultAbiCoder();
	let paymasterAndData = useroperation.paymaster;
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
		if (
			stripV9PaymasterSig &&
			useroperation.paymasterData.toLowerCase().endsWith(PAYMASTER_SIG_MAGIC)
		) {
			const sigLenHex = useroperation.paymasterData.slice(
				useroperation.paymasterData.length - 16 - 4,
				useroperation.paymasterData.length - 16,
			);
			const sigLen = parseInt(sigLenHex, 16);
			const prefixEnd = useroperation.paymasterData.length - 16 - 4 - sigLen * 2;
			paymasterAndData +=
				useroperation.paymasterData.slice(0, prefixEnd).replaceAll("0x", "") + PAYMASTER_SIG_MAGIC;
		} else {
			paymasterAndData += useroperation.paymasterData.slice(2);
		}
	}
	return paymasterAndData;
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

	const paymasterAndData = buildPaymasterAndData(useroperation);

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
 * Shared packer for EntryPoint v0.8 and v0.9 UserOperations.
 * @param useroperation - UserOperation to pack
 * @param is_v9 - If true, strips the paymaster signature suffix (v0.9-specific)
 * @returns ABI-encoded packed UserOperation as a hex string
 */
function baseCreatePackedUserOperationV8V9(
	useroperation: UserOperationV8 | UserOperationV9,
	is_v9: boolean,
): string {
	const abiCoder = AbiCoder.defaultAbiCoder();

	const initCode = buildPackedInitCodeV8V9(useroperation);

	const accountGasLimits =
		"0x" +
		abiCoder.encode(["uint128"], [useroperation.verificationGasLimit]).slice(34) +
		abiCoder.encode(["uint128"], [useroperation.callGasLimit]).slice(34);

	const gasFees =
		"0x" +
		abiCoder.encode(["uint128"], [useroperation.maxPriorityFeePerGas]).slice(34) +
		abiCoder.encode(["uint128"], [useroperation.maxFeePerGas]).slice(34);

	const paymasterAndData = buildPaymasterAndData(useroperation, is_v9);

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
 * Send a JSON-RPC 2.0 request to the specified endpoint.
 *
 * **External escape hatch.** Most SDK consumers should use one of the
 * high-level service classes ({@link Bundler}, {@link CandidePaymaster},
 * {@link Erc7677Paymaster}, {@link JsonRpcNode}) which translate errors into
 * the SDK's domain vocabulary. This function is intentionally low-level: it
 * speaks plain JSON-RPC and throws {@link TransportRpcError}
 * (an EIP-1193-shaped `ProviderRpcError`) on RPC errors.
 *
 * Two execution modes:
 * - **URL string:** issues a `fetch` POST directly. Supports custom `headers`
 *   and a custom `paramsKeyName` for non-standard servers (e.g. APIs that
 *   expect `"simulations"` instead of `"params"`).
 * - **Transport / JsonRpcNode:** delegates to `.request({ method, params })`.
 *   `headers` and `paramsKeyName` are ignored (those concerns belong to the
 *   transport implementation).
 *
 * Automatically serializes `bigint` values in `params` as `0x`-prefixed hex.
 *
 * @param rpc - JSON-RPC endpoint URL, {@link Transport}, or {@link JsonRpcNode}
 * @param method - The JSON-RPC method name (e.g., `"eth_call"`)
 * @param params - The JSON-RPC parameters
 * @param headers - Custom HTTP headers (URL inputs only; default Content-Type: application/json)
 * @param paramsKeyName - Override the params key in the envelope (URL inputs only; default `"params"`)
 * @returns The `result` (or non-standard equivalent) field from the JSON-RPC response
 * @throws {@link TransportRpcError} when the response contains an `error` field
 */
export async function sendJsonRpcRequest(
	rpc: string | Transport | JsonRpcNode,
	method: string,
	params: JsonRpcParam,
	headers: Record<string, string> = { "Content-Type": "application/json" },
	paramsKeyName: string = "params",
): Promise<JsonRpcResult> {
	if (typeof rpc !== "string") {
		return JsonRpcNode.from(rpc).request<JsonRpcResult>({
			method,
			params: params as readonly unknown[] | object,
		});
	}
	// URL path — preserve the historical fetch-based implementation so callers
	// passing custom headers or a custom paramsKeyName continue to work.
	const raw = JSON.stringify(
		{
			method,
			[paramsKeyName]: params,
			id: Date.now(),
			jsonrpc: "2.0",
		},
		(_key, value) =>
			// eslint-disable-next-line @typescript-eslint/no-unsafe-return
			typeof value === "bigint" ? `0x${value.toString(16)}` : value,
	);
	const fetchResult = await fetch(rpc, {
		method: "POST",
		headers,
		body: raw,
		redirect: "follow",
	});
	const response = (await fetchResult.json()) as JsonRpcResponse;
	if ("result" in response) {
		return response.result as JsonRpcResult;
	}
	const err = response.error as JsonRpcError;
	throw new TransportRpcError(err.code, err.message);
}

/**
 * Get a 4-byte function selector from a Solidity-style function signature.
 * Computed as the first 4 bytes of keccak256(signature).
 * @param functionSignature - Solidity-style function signature, e.g. "mint(address)"
 * @returns Function selector as a 0x-prefixed 10-character hex string
 *
 * @example
 * getFunctionSelector("getNonce(address,uint192)"); // "0x35567e1a"
 */
export function getFunctionSelector(functionSignature: string): string {
	return id(functionSignature).slice(0, 10);
}

/**
 * Fetch the account's nonce from the EntryPoint contract.
 *
 * Equivalent to `JsonRpcNode.from(rpc).getEntryPointNonce(entryPoint, account, key)`.
 * Kept as a top-level export for backward compatibility with existing call
 * sites; the first parameter widens from `string` to
 * `string | Transport | JsonRpcNode` so users can pass a configured transport
 * (with custom headers, retries, etc.) without restructuring their code.
 *
 * @param rpc - Ethereum JSON-RPC node URL, {@link Transport}, or {@link JsonRpcNode}
 * @param entryPoint - EntryPoint contract address
 * @param account - Smart account address to query
 * @param key - Nonce key (default 0). Different keys allow parallel nonce channels.
 * @returns The current nonce as a bigint
 */
export async function fetchAccountNonce(
	rpc: string | Transport | JsonRpcNode,
	entryPoint: string,
	account: string,
	key: number = 0,
): Promise<bigint> {
	return JsonRpcNode.from(rpc).getEntryPointNonce(entryPoint, account, BigInt(key));
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
 * @internal
 * Internal dispatcher: routes to the Polygon Gas Station when a chain is
 * provided, otherwise delegates to {@link JsonRpcNode.getFeeData}. Used by
 * the account classes when assembling base UserOperation gas fields.
 */
export async function handlefetchGasPrice(
	providerRpc: string | Transport | JsonRpcNode | undefined,
	polygonGasStation: PolygonChain | undefined,
	gasLevel: GasOption = GasOption.Medium,
): Promise<[bigint, bigint]> {
	if (polygonGasStation != null) {
		return fetchGasPricePolygon(polygonGasStation, gasLevel);
	}
	if (providerRpc != null) {
		return JsonRpcNode.from(providerRpc).getFeeData(gasLevel);
	}
	throw new AbstractionKitError(
		"BAD_DATA",
		"providerRpc can't be null if maxFeePerGas and maxPriorityFeePerGas are not overridden",
	);
}
