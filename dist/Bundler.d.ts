import type {
	UserOperation,
	JsonRpcError,
	GasEstimationResult,
	UserOperationByHashResult,
	UserOperationReceiptResult,
	AbiInputValue,
	JsonRpcResponse,
} from "./types";
import { BytesLike } from "ethers";
export declare class Bundler {
	readonly rpcUrl: string;
	readonly entrypointAddress: string;
	constructor(rpcUrl: string, entrypointAddress: string);
	chainId(): Promise<
		| {
				chainId: string;
		  }
		| JsonRpcError
	>;
	supportedEntryPoints(): Promise<
		| {
				supportedEntryPoints: string[];
		  }
		| JsonRpcError
	>;
	estimateUserOperationGas(
		useroperation: UserOperation,
	): Promise<GasEstimationResult | JsonRpcError>;
	sendUserOperation(useroperation: UserOperation): Promise<
		| {
				userOperationHash: string;
		  }
		| JsonRpcError
	>;
	getUserOperationReceipt(
		useroperationhash: BytesLike,
	): Promise<UserOperationReceiptResult | JsonRpcError>;
	getUserOperationByHash(
		useroperationhash: BytesLike,
	): Promise<UserOperationByHashResult | JsonRpcError>;
	sendJsonRpcRequest(
		rpcUrl: string,
		method: string,
		params: AbiInputValue,
	): Promise<JsonRpcResponse>;
}
//# sourceMappingURL=Bundler.d.ts.map
