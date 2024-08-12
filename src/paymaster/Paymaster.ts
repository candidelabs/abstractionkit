import type { UserOperationV7, UserOperationV6, SponsorMetadata } from "../types";
import { CandidePaymasterContext, CreatePaymasterUserOperationOverrides} from "./types";

export abstract class Paymaster {
	abstract createPaymasterUserOperation(
		userOperation: UserOperationV7 | UserOperationV6,
		bundlerRpc: string,
		context: CandidePaymasterContext,
        createPaymasterUserOperationOverrides:CreatePaymasterUserOperationOverrides
	): Promise<[UserOperationV7 | UserOperationV6, SponsorMetadata | undefined]>; 
}
