import { Paymaster } from "./Paymaster";
import { sendJsonRpcRequest } from "src/utils";
import { UserOperation, JsonRpcError } from "../types";
import { BytesLike } from "ethers";

export class CandideValidationPaymaster extends Paymaster {
	readonly rpcUrl: string;
	readonly entrypointAddress: string;

	constructor(pymasterAddress: string,
		entrypointAddress:string,
		rpcUrl: string
	) {
		super(pymasterAddress);
		this.rpcUrl = rpcUrl;
		this.entrypointAddress = entrypointAddress;
	}

	async getPaymasterCallDataForPayingGasWithErc20(
		userOperation: UserOperation,
		erc20TokenAddress:string,
	): Promise<BytesLike | JsonRpcError>{
		const config = [this.rpcUrl, this.entrypointAddress, erc20TokenAddress]

		return this.getPaymasterCallData(userOperation, config)
	}

	async getPaymasterCallData(
		userOperation: UserOperation,
		config: string[],
	): Promise<BytesLike | JsonRpcError>{
		const rpcUrl = config[0]
		const entrypointAddress = config[1]
		const tokenAddress = config[2]

		const jsonRpcResult = await sendJsonRpcRequest(
			rpcUrl,
			"pm_sponsorUserOperation",
			[userOperation, entrypointAddress, [tokenAddress]],
		);

		if ("result" in jsonRpcResult) {
			return jsonRpcResult.result as BytesLike
		} else {
			return jsonRpcResult.error as JsonRpcError;
		}
	}

	getPaymasterCallDataAndEstimateGas(
		userOperation: UserOperation,
		config: string[],
	): Promise<BytesLike | JsonRpcError>{
		return this.getPaymasterCallData(userOperation, config)
	}
}
