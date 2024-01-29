import type { UserOperation, StateOverrideSet } from "../types";
import { CandidePaymasterContext } from "./types";

export abstract class Paymaster {
	abstract createPaymasterUserOperation(
		userOperation: UserOperation,
		bundlerRpc: string,
		context: CandidePaymasterContext,
		state_override_set?: StateOverrideSet,
	): Promise<UserOperation>;
}
