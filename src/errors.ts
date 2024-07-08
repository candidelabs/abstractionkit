//credits:https://medium.com/with-orus/the-5-commandments-of-clean-error-handling-in-typescript-93a9cbdf1af5

import { Dictionary } from "./types";

export type BasicErrorCode =
	| "UNKNOWN_ERROR"
	| "TIMEOUT"
	| "BAD_DATA"
	| "BUNDLER_ERROR"
	| "PAYMASTER_ERROR";

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
	| "INVALID_USEROPERATION_HASH"
	| "EXECUTION_REVERTED";

export type JsonRpcErrorCode =
	| "PARSE_ERROR"
	| "INVALID_REQUEST"
	| "METHOD_NOT_FOUND"
	| "INVALID_PARAMS"
	| "INTERNAL_ERROR"
	| "SERVER_ERROR";

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
	"-32601": "INVALID_USEROPERATION_HASH",
	"-32521": "EXECUTION_REVERTED",
};

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

export class AbstractionKitError extends Error {
	public readonly code: BundlerErrorCode | BasicErrorCode | JsonRpcErrorCode;
	public readonly context?: Jsonable;
	public readonly errno?: number;

	constructor(
		code: BundlerErrorCode | BasicErrorCode | JsonRpcErrorCode,
		message: string,
		options: { cause?: Error; errno?: number; context?: Jsonable } = {},
	) {
		const { cause, errno, context } = options;

		super(message, { cause });
		this.name = this.constructor.name;

		this.code = code;
		this.errno = errno;
		this.context = context;
	}

    //get a string representation of AbstractionKitError
    //Usefull with React Native, as Error "cause" is not shown in the error trace
    stringify(): string {
        return JSON.stringify(
            this,
            ["name", "code", "message", "cause", "errno", "context"]
        )
    }
}

export function ensureError(value: unknown): Error {
	if (value instanceof Error) return value;

	let stringified = "[Unable to stringify the thrown value]";
	try {
		stringified = JSON.stringify(value);
	} catch {
		/* empty */
	}

	const error = new Error(
		`This value was thrown as is, not through an Error: ${stringified}`,
	);
	return error;
}
