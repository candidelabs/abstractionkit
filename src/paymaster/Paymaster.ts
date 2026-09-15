import { AbstractionKitError } from "../errors";
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
