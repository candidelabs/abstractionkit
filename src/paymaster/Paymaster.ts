import { AbstractionKitError, ensureError } from "../errors";
import type { AnyUserOperation } from "./types";

/**
 * Abstract base class for all paymaster implementations.
 * Subclasses provide specific logic for gas sponsorship or ERC-20 token gas payment.
 */
export abstract class Paymaster {}

/**
 * Paymaster address carried by a set of paymaster fields: `paymaster` for
 * v0.7+ shapes, or the first 20 bytes of `paymasterAndData` for v0.6.
 * Works on a UserOperation as well as on a raw paymaster RPC response.
 * Returns `null` when no paymaster is present.
 */
export function extractPaymasterAddress(
	fields: { paymaster?: string | null; paymasterAndData?: string | null },
	isV6: boolean,
): string | null {
	if (isV6) {
		const packed = fields.paymasterAndData;
		if (typeof packed !== "string" || packed.length < 42) return null;
		return packed.slice(0, 42);
	}
	return fields.paymaster ?? null;
}

/** Paymaster address carried by a UserOperation, or `null` when it has none. */
export function getUserOperationPaymaster(userOp: AnyUserOperation): string | null {
	return extractPaymasterAddress(userOp, "initCode" in userOp);
}

/**
 * Guard for the token paymaster flows. The ERC-20 `approve` is prepended to
 * `callData` for `spender` before the paymaster RPC returns its final fields,
 * so nothing else ties the two together: a response that finalizes with a
 * different paymaster, or with none at all, would leave the caller signing an
 * approval to an address the operation never pays. Throws in both cases.
 *
 * @param finalPaymaster - Paymaster named by the final response (or carried
 *   by the finished operation), `null` when absent.
 * @param spender - Address the approval was built for.
 */
export function assertPaymasterMatchesApproveSpender(
	finalPaymaster: string | null,
	spender: string,
): void {
	if (finalPaymaster == null || finalPaymaster.toLowerCase() !== spender.toLowerCase()) {
		throw new AbstractionKitError(
			"PAYMASTER_ERROR",
			`token paymaster mismatch: the ERC-20 approval was built for ${spender} ` +
				`but the final paymaster is ${finalPaymaster ?? "missing"}. ` +
				"Refusing to return an operation whose approval and paymaster disagree.",
			{ context: { approveSpender: spender, finalPaymaster } },
		);
	}
}

/**
 * The error a paymaster client throws for a failure, shared by the clients
 * so they keep one contract. The code names the service that failed:
 * - An {@link AbstractionKitError} is returned as is. A PAYMASTER_ERROR is
 *   not wrapped again (that pushed its `context`, e.g. the supported tokens,
 *   several causes deep), and an error from another service keeps its code:
 *   a gas estimation failure is the bundler's BUNDLER_ERROR, exactly as from
 *   an account's `createUserOperation`, with its `aaCode` and `errno`.
 * - A `RangeError` is invalid UserOperation input (a negative gas override,
 *   an unsupported EntryPoint) and is returned as is, as the account classes
 *   throw it. Invalid paymaster context (the token, `exchangeRate`) is not
 *   UserOperation input: the clients throw it as PAYMASTER_ERROR at the
 *   source, so one handler covers every problem with the paymaster part.
 * - Anything else came from the paymaster: a raw error from its RPC or a
 *   `TypeError` from a malformed response. It becomes the `cause` of a
 *   PAYMASTER_ERROR, with a JSON-RPC error code copied to `errno`.
 *
 * @internal
 */
export function toPaymasterError(message: string, err: unknown): Error {
	const error = ensureError(err);
	if (error instanceof AbstractionKitError || error instanceof RangeError) {
		return error;
	}
	return paymasterRpcError(message, error);
}

/**
 * Wrap an error from the paymaster's own RPC endpoint as PAYMASTER_ERROR,
 * with the raw error as `cause` and its JSON-RPC code copied to `errno`.
 *
 * @internal
 */
export function paymasterRpcError(message: string, err: unknown): AbstractionKitError {
	const error = ensureError(err);
	const rpcCode = (error as { code?: unknown }).code;
	return new AbstractionKitError("PAYMASTER_ERROR", message, {
		cause: error,
		errno: typeof rpcCode === "number" ? rpcCode : undefined,
	});
}
