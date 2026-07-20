//credits:https://medium.com/with-orus/the-5-commandments-of-clean-error-handling-in-typescript-93a9cbdf1af5

import type {Dictionary} from "./types";

/**
 * General SDK error codes for non-bundler, non-RPC failures.
 *
 * - `NODE_ERROR` — outer code thrown by {@link JsonRpcNode} when an underlying
 *   RPC call fails. The specific JSON-RPC code (when known) appears in
 *   `.cause` as a nested {@link AbstractionKitError} carrying a
 *   {@link JsonRpcErrorCode}.
 * - `BAD_DATA` — reserved for malformed responses (the RPC call returned, but
 *   the data shape was wrong). Not used for RPC failures themselves.
 */
export type BasicErrorCode =
	| "UNKNOWN_ERROR"
	| "TIMEOUT"
	| "BAD_DATA"
	| "BUNDLER_ERROR"
	| "PAYMASTER_ERROR"
	| "NODE_ERROR";

/**
 * ERC-4337 bundler-specific error codes, mapped from JSON-RPC error numbers
 * defined in the ERC-4337 specification.
 */
export type BundlerErrorCode =
	| "INVALID_FIELDS"
	| "SIMULATE_VALIDATION"
	| "SIMULATE_PAYMASTER_VALIDATION"
	| "OPCODE_VALIDATION"
	| "EXPIRE_SHORTLY"
	| "REPUTATION"
	| "INSUFFICIENT_STAKE"
	| "UNSUPPORTED_SIGNATURE_AGGREGATOR"
	| "INVALID_SIGNATURE"
	/** @deprecated no longer produced: -32601 was mismapped to this code; an
	 * invalid hash surfaces as INVALID_FIELDS (-32602) per the bundler spec
	 * tests and Voltaire, while -32601 is the standard METHOD_NOT_FOUND. */
	| "INVALID_USEROPERATION_HASH"
	| "EXECUTION_REVERTED";

/**
 * Standard JSON-RPC 2.0 error codes plus Tenderly simulation errors.
 */
export type JsonRpcErrorCode =
	| "PARSE_ERROR"
	| "INVALID_REQUEST"
	| "METHOD_NOT_FOUND"
	| "INVALID_PARAMS"
	| "INTERNAL_ERROR"
	| "SERVER_ERROR"
	| "TENDERLY_SIMULATION_ERROR"
	| "TENDERLY_HTTP_ERROR"
	| "TENDERLY_INVALID_JSON"
	| "TENDERLY_NETWORK_ERROR";

/**
 * Maps JSON-RPC numeric error codes to human-readable {@link BundlerErrorCode} values.
 */
export const BundlerErrorCodeDict: Dictionary<BundlerErrorCode> = {
	"-32602": "INVALID_FIELDS",
	"-32500": "SIMULATE_VALIDATION",
	"-32501": "SIMULATE_PAYMASTER_VALIDATION",
	"-32502": "OPCODE_VALIDATION",
	"-32503": "EXPIRE_SHORTLY",
	"-32504": "REPUTATION",
	"-32505": "INSUFFICIENT_STAKE",
	"-32506": "UNSUPPORTED_SIGNATURE_AGGREGATOR",
	"-32507": "INVALID_SIGNATURE",
	"-32521": "EXECUTION_REVERTED",
};

/**
 * Maps JSON-RPC numeric error codes to human-readable {@link JsonRpcErrorCode} values.
 */
export const JsonRpcErrorDict: Dictionary<JsonRpcErrorCode> = {
	"-32700": "PARSE_ERROR",
	"-32600": "INVALID_REQUEST",
	"-32601": "METHOD_NOT_FOUND",
	"-32602": "INVALID_PARAMS",
	"-32603": "INTERNAL_ERROR",
};

type Jsonable =
	| string
	| number
	| boolean
	| null
	| undefined
	| readonly Jsonable[]
	| { readonly [key: string]: Jsonable }
	| { toJSON(): Jsonable };

/**
 * Custom error class for the AbstractionKit SDK. Wraps bundler, JSON-RPC,
 * and general errors with a structured code, optional numeric errno, and
 * arbitrary JSON-serializable context.
 */
export class AbstractionKitError extends Error {
	public readonly code: BundlerErrorCode | BasicErrorCode | JsonRpcErrorCode;
	public readonly context?: Jsonable;
	public readonly errno?: number;
	/**
	 * The EntryPoint FailedOp revert code parsed from the message (e.g. "AA21"),
	 * when present. EntryPoint codes are contract-defined and stable across
	 * bundlers, so they are a reliable signal for classifying a failure without
	 * matching the human-readable message text.
	 */
	public readonly aaCode?: string;

	/**
	 * @param code - Error code identifying the category of failure
	 * @param message - Human-readable error description
	 * @param options - Optional cause, numeric errno, JSON-serializable context, and AAxx code
	 */
	constructor(
		code: BundlerErrorCode | BasicErrorCode | JsonRpcErrorCode,
		message: string,
		options: { cause?: Error; errno?: number; context?: Jsonable; aaCode?: string } = {},
	) {
		const { cause, errno, context, aaCode } = options;

		super(message, { cause });
		this.name = this.constructor.name;

		this.code = code;
		this.errno = errno;
		this.context = context;
		this.aaCode = aaCode;
	}

	/**
	 * Returns a JSON string representation of this error including name, code,
	 * message, cause, errno, context, and aaCode. Useful in React Native where
	 * the Error "cause" property is not shown in stack traces.
	 * @returns JSON string of the error
	 */
	stringify(): string {
		return JSON.stringify(this, ["name", "code", "message", "cause", "errno", "context", "aaCode"]);
	}
}

/**
 * Parse the EntryPoint FailedOp revert code (e.g. "AA21") from a bundler error
 * message, if one is present. Returns the uppercased code or undefined.
 */
export function parseAaCode(message: string): string | undefined {
	// Word boundaries keep the code from matching digit pairs embedded in hex
	// blobs (revert data, hashes, addresses, chain ids) that bundler messages
	// routinely carry, e.g. "0x3aa21f" or chainId "0xaa36a7".
	return message.match(/\bAA\d{2}\b/i)?.[0].toUpperCase();
}

/**
 * Coerces an unknown thrown value into an Error instance.
 * If the value is already an Error it is returned as-is; otherwise it is
 * stringified and wrapped in a new Error.
 * @param value - The caught value to normalize
 * @returns An Error instance
 */
export function ensureError(value: unknown): Error {
	if (value instanceof Error) return value;

	let stringified = "[Unable to stringify the thrown value]";
	try {
		stringified = JSON.stringify(value);
	} catch {
		/* empty */
	}

	const error = new Error(`This value was thrown as is, not through an Error: ${stringified}`);
	return error;
}
