import { SmartAccount } from "./SmartAccount";
import type { BigNumberish, BytesLike } from "ethers";
import type { Operation } from "../types";
import {
	ZeroAddress,
	keccak256,
	solidityPacked,
	solidityPackedKeccak256,
} from "ethers";
import { CandideAccountFactory } from "../factory/CandideAccountFactory";
import { SmartAccountFactory } from "../factory/SmartAccountFactory";

export class CandideAccount extends SmartAccount {
	readonly entrypointAddress: string;
	readonly candideAccountFactory: SmartAccountFactory;

	constructor(
		singletonAddress: string = "0x3A0a17Bcc84576b099373ab3Eed9702b07D30402",
		entrypointAddress: string = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789",
		candideAccountFactory: SmartAccountFactory = new CandideAccountFactory(),
	) {
		const proxyByteCode =
			"0x608060405234801561001057600080fd5b5060405161017338038061017383398101604081905261002f916100b9565b6001600160a01b0381166100945760405162461bcd60e51b815260206004820152602260248201527f496e76616c69642073696e676c65746f6e20616464726573732070726f766964604482015261195960f21b606482015260840160405180910390fd5b600080546001600160a01b0319166001600160a01b03929092169190911790556100e9565b6000602082840312156100cb57600080fd5b81516001600160a01b03811681146100e257600080fd5b9392505050565b607c806100f76000396000f3fe6080604052600080546001600160a01b0316813563530ca43760e11b1415602857808252602082f35b3682833781823684845af490503d82833e806041573d82fd5b503d81f3fea2646970667358221220022b6bb97dd1e16cb867add83d4159f7550336cbb5b40514145e43f493c1377664736f6c634300080c0033";
		const initializerFunctionSelector = "0x6a1e9826";
		const initializerFunctionInputAbi = [
			"address[]",
			"uint256",
			"address",
			"bytes",
			"address",
			"address",
			"uint256",
			"address",
			"address",
		];

		const executorFunctionSelector = "0xf34308ef";
		const executorFunctionInputAbi = [
			"address",
			"uint256",
			"bytes",
			"uint8",
			"address",
			"address",
			"uint256",
		];
		super(
			singletonAddress,
			proxyByteCode,
			initializerFunctionSelector,
			initializerFunctionInputAbi,
			executorFunctionSelector,
			executorFunctionInputAbi,
		);
		this.entrypointAddress = entrypointAddress;
		this.candideAccountFactory = candideAccountFactory;
	}

	createNewAccount(
		owners: string[],
		threshold?: BigNumberish,
	): [string, BytesLike];
	createNewAccount(
		owners: string[],
		threshold: BigNumberish,
		c2nonce: BigNumberish,
	): [string, BytesLike];
	createNewAccount(
		owners: string[],
		threshold: BigNumberish,
		c2nonce: BigNumberish,
		fallbackHandler: string,
	): [string, BytesLike];
	createNewAccount(
		owners: string[],
		threshold: BigNumberish = 1,
		c2nonce: BigNumberish = 0,
		fallbackHandler: string = "0x2a15DE4410d4c8af0A7b6c12803120f43C42B820", //CompatibilityFallbackHandler
	): [string, BytesLike] {
		const initializerFunctionInputParameters = [
			owners, //_owners
			threshold, //_threshold
			ZeroAddress, //to Contract address for optional delegate call during initialization(Safe specific, can be ignored)
			"0x", //Data payload for optional delegate call during initialization(Safe specific, can be ignored)
			fallbackHandler, //fallbackHandler Handler for fallback calls to this contract
			ZeroAddress, //paymentToken (Safe specific, can be ignored)
			0, //payment (Safe specific, can be ignored)
			ZeroAddress, //paymentReceiver (Safe specific, can be ignored)
			this.entrypointAddress,
		];

		const initializerCallData = this.getInitializerCallData(
			initializerFunctionInputParameters,
		);

		const sender = this.getProxyAddress(
			initializerCallData,
			this.candideAccountFactory.address,
			c2nonce,
		);

		const generatorFunctionInputParameters = [
			this.singletonAddress,
			initializerCallData,
			c2nonce,
		];

		const factoryGeneratorFunctionCallData =
			this.candideAccountFactory.getFactoryGeneratorFunctionCallData(
				generatorFunctionInputParameters,
			);

		return [sender, factoryGeneratorFunctionCallData];
	}

	createSendEthCallData(to: string, value: BigNumberish): BytesLike {
		return this.createCallData(to, value, "0x", 0, ZeroAddress, ZeroAddress, 0);
	}
	createCallData(
		to: string,
		value: BigNumberish,
		data: BytesLike,
		operation: Operation,
		paymaster: string,
		approveToken: string,
		approveAmount: BigNumberish,
	): BytesLike {
		const executorFunctionCallData = this.getExecutorCallData([
			to,
			value,
			data,
			operation,
			paymaster,
			approveToken,
			approveAmount,
		]);
		return executorFunctionCallData;
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
