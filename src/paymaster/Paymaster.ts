import { AbstractionKitError } from "../errors";
import type { AnyUserOperation } from "./types";

/**
 * Abstract base class for all paymaster implementations.
 * Subclasses provide specific logic for gas sponsorship or ERC-20 token gas payment.
 */
export abstract class Paymaster {}

/**
 * Paymaster address carried by a UserOperation: the `paymaster` field on
 * v0.7+ operations, or the first 20 bytes of `paymasterAndData` on v0.6.
 * Returns `null` when the operation carries no paymaster.
 */
export function getUserOperationPaymaster(userOp: AnyUserOperation): string | null {
	if ("initCode" in userOp) {
		const packed = userOp.paymasterAndData;
		if (typeof packed !== "string" || packed.length < 42) return null;
		return packed.slice(0, 42);
	}
	return userOp.paymaster ?? null;
}

/**
 * Guard for the token paymaster flows. The ERC-20 `approve` is prepended to
 * `callData` for `spender` before the paymaster RPC returns its final fields,
 * so nothing else ties the two together: a response that finalizes with a
 * different paymaster, or with none at all, would leave the caller signing an
 * approval to an address the operation never pays. Throws in both cases.
 */
export function assertPaymasterMatchesApproveSpender(
	userOp: AnyUserOperation,
	spender: string,
): void {
	const final = getUserOperationPaymaster(userOp);
	if (final == null || final.toLowerCase() !== spender.toLowerCase()) {
		throw new AbstractionKitError(
			"PAYMASTER_ERROR",
			`token paymaster mismatch: the ERC-20 approval was built for ${spender} ` +
				`but the final UserOperation paymaster is ${final ?? "missing"}. ` +
				"Refusing to return an operation whose approval and paymaster disagree.",
			{ context: { approveSpender: spender, finalPaymaster: final } },
		);
	}
}
