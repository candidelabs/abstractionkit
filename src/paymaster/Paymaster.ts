import type {
	UserOperationV7,
	UserOperationV6,
	SponsorMetadata,
} from "../types";
import {
	BasePaymasterUserOperationOverrides,
	CandidePaymasterContext,
	GasPaymasterUserOperationOverrides
} from "./types";

export abstract class Paymaster {
	abstract createPaymasterUserOperation(
		userOperation: UserOperationV7 | UserOperationV6,
		bundlerRpc: string,
		context: CandidePaymasterContext,
		createPaymasterUserOperationOverrides: BasePaymasterUserOperationOverrides | GasPaymasterUserOperationOverrides,
	): Promise<[UserOperationV7 | UserOperationV6, SponsorMetadata | undefined]>;
}
