import "ethers";
import type { UserOperation, JsonRpcError, StateOverrideSet } from "../types";
import { CandidePaymasterContext } from "./types";

export abstract class Paymaster {
	abstract createPaymasterUserOperation(
		userOperation: UserOperation,
		bundlerRpc: string,
		context: CandidePaymasterContext,
		entrypointAddress: string,
		state_override_set?: StateOverrideSet,
	): Promise<UserOperation | JsonRpcError>;
}
