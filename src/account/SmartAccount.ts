import { keccak256, solidityPacked, solidityPackedKeccak256 } from "ethers";

import type { BytesLike, BigNumberish } from "ethers";
import { AbiInputValue } from "../types";
import { getCallData } from "../utils";

export class SmartAccount {
	readonly singletonAddress: string;
	readonly proxyByteCode: BytesLike;
	readonly initializerFunctionSelector: string;
	readonly initializerFunctionInputAbi: string[];
	readonly executorFunctionSelector: string;
	readonly executorFunctionInputAbi: string[];

	constructor(
		singletonAddress: string,
		proxyByteCode: BytesLike,
		initializerFunctionSelector: string,
		initializerFunctionInputAbi: string[],
		executorFunctionSelector: string,
		executorFunctionInputAbi: string[],
	) {
		this.singletonAddress = singletonAddress;
		this.proxyByteCode = proxyByteCode;
		this.initializerFunctionSelector = initializerFunctionSelector;
		this.initializerFunctionInputAbi = initializerFunctionInputAbi;
		this.executorFunctionSelector = executorFunctionSelector;
		this.executorFunctionInputAbi = executorFunctionInputAbi;
	}

	getInitializerCallData(
		initializerFunctionInputParameters: AbiInputValue[],
	): BytesLike {
		const callData = getCallData(
			this.initializerFunctionSelector,
			this.initializerFunctionInputAbi,
			initializerFunctionInputParameters,
		);
		return callData;
	}

	getExecutorCallData(
		executorFunctionInputParameters: AbiInputValue[],
	): BytesLike {
		const callData = getCallData(
			this.executorFunctionSelector,
			this.executorFunctionInputAbi,
			executorFunctionInputParameters,
		);
		return callData;
	}

	getProxyAddress(
		initializerCallData: BytesLike,
		factoryAddress: string,
		c2Nonce: BigNumberish,
	): string {
		const salt = keccak256(
			solidityPacked(
				["bytes32", "uint256"],
				[keccak256(initializerCallData), c2Nonce],
			),
		);

		const initHash = keccak256(
			solidityPacked(
				["bytes", "uint256"],
				[this.proxyByteCode, this.singletonAddress],
			),
		);

		const proxyAdd = solidityPackedKeccak256(
			["bytes1", "address", "bytes32", "bytes32"],
			["0xff", factoryAddress, salt, initHash],
		).slice(-40);
		return "0x" + proxyAdd;
	}
}
