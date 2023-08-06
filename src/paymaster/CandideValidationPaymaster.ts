import { Paymaster } from "./Paymaster";
import { sendJsonRpcRequest } from "src/utils";
import { UserOperation, JsonRpcError } from "../types";
import { BytesLike } from "ethers";

export class CandideValidationPaymaster extends Paymaster {
	readonly rpcUrl: string;
	readonly entrypointAddress: string;

	constructor(
		entrypointAddress:string,
		rpcUrl: string
	) {
		super();
		this.rpcUrl = rpcUrl;
		this.entrypointAddress = entrypointAddress;
	}

	async getPaymasterCallDataForPayingGasWithErc20(
		userOperation: UserOperation,
		erc20TokenAddress:string,
	): Promise<{paymasterAndData: BytesLike} | JsonRpcError>{
		const config = [this.rpcUrl, this.entrypointAddress, erc20TokenAddress]

		return this.getPaymasterCallData(userOperation, config)
	}

	async getPaymasterCallData(
		userOperation: UserOperation,
		config: string[],
	): Promise<{paymasterAndData: BytesLike} | JsonRpcError>{
		const rpcUrl = config[0]
		const entrypointAddress = config[1]
		const tokenAddress = config[2]

		const jsonRpcResult = await sendJsonRpcRequest(
			rpcUrl,
			"pm_sponsorUserOperation",
			[userOperation, entrypointAddress, [tokenAddress]],
		);

		if ("result" in jsonRpcResult) {
			return {paymasterAndData: jsonRpcResult.result as BytesLike}
		} else {
			return jsonRpcResult.error as JsonRpcError;
		}
	}
}
