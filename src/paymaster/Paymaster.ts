import type { UserOperation } from "../types";
import { CandidePaymasterContext, CreatePaymasterUserOperationOverrides} from "./types";

export abstract class Paymaster {
	abstract createPaymasterUserOperation(
		userOperation: UserOperation,
		bundlerRpc: string,
		context: CandidePaymasterContext,
        createPaymasterUserOperationOverrides:CreatePaymasterUserOperationOverrides
	): Promise<UserOperation>;
}
