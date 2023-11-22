import { SmartAccount } from "../SmartAccount";
import type { BigNumberish, BytesLike } from "ethers";
import { Operation } from "../../types";
import { getCallData } from "../../utils";
import {
	ZeroAddress,
	AbiCoder,
	keccak256,
	solidityPacked,
	solidityPackedKeccak256,
} from "ethers";
import { SafeAccountFactory } from "../../factory/SafeAccountFactory";
import { SmartAccountFactory } from "../../factory/SmartAccountFactory";
import { MetaTransaction } from "../Candide/types";
import { encodeMultiSendCallData } from "../Candide/multisend";


export class SafeAccount extends SmartAccount {
	readonly entrypointAddress: string;
	readonly safeAccountFactory: SmartAccountFactory;

	constructor(
		singletonAddress: string = "0x41675C099F32341bf84BFc5382aF534df5C7461a",
		entrypointAddress: string = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789",
		safeAccountFactory: SmartAccountFactory = new SafeAccountFactory(),
	) {
		const proxyByteCode =
			"0x608060405234801561001057600080fd5b506040516101e63803806101e68339818101604052602081101561003357600080fd5b8101908080519060200190929190505050600073ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff1614156100ca576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004018080602001828103825260228152602001806101c46022913960400191505060405180910390fd5b806000806101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff1602179055505060ab806101196000396000f3fe608060405273ffffffffffffffffffffffffffffffffffffffff600054167fa619486e0000000000000000000000000000000000000000000000000000000060003514156050578060005260206000f35b3660008037600080366000845af43d6000803e60008114156070573d6000fd5b3d6000f3fea264697066735822122003d1488ee65e08fa41e58e888a9865554c535f2c77126a82cb4c0f917f31441364736f6c63430007060033496e76616c69642073696e676c65746f6e20616464726573732070726f7669646564";
		const initializerFunctionSelector = "0xb63e800d";
		const initializerFunctionInputAbi = [
			"address[]",
			"uint256",
			"address",
			"bytes",
			"address",
			"address",
			"uint256",
			"address",
		];

		const executorFunctionSelector = "0x940d3c60";
		const executorFunctionInputAbi = [
			"address",
			"uint256",
			"bytes",
			"uint8",
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
		this.safeAccountFactory = safeAccountFactory;
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
		fallbackManager: string,
	): [string, BytesLike];
	createNewAccount(
		owners: string[],
		threshold: BigNumberish = 1,
		c2nonce: BigNumberish = 0,
		fallbackManager: string = "0xDd1475348790061F1523978106162840A1Dc7c9a"
	): [string, BytesLike] {

		const setup4337Modules = getCallData(
			"0xd041593b", //setup4337Modules
			["address"],
			[fallbackManager],
		);

		const initializerFunctionInputParameters = [
			owners, //_owners
			threshold, //_threshold
			fallbackManager, //to Contract address for optional delegate call during initialization
			setup4337Modules, //Data payload for optional delegate call during initialization
			"0x180849A1713B834b9248Eaa4690cEc8aBaE58C95", //fallbackHandler Handler for fallback calls to this contract
			ZeroAddress, //paymentToken (Safe specific, can be ignored)
			0, //payment (Safe specific, can be ignored)
			ZeroAddress, //paymentReceiver (Safe specific, can be ignored)
		];

		const initializerCallData = this.getInitializerCallData(
			initializerFunctionInputParameters,
		);

		const generatorFunctionInputParameters = [
			owners,
			threshold,
			c2nonce,
		];

		const factoryGeneratorFunctionCallData =
			this.safeAccountFactory.getFactoryGeneratorFunctionCallData(
				generatorFunctionInputParameters,
			);
		
		const sender = this.getProxyAddress(
			initializerCallData,
			"0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
			c2nonce,
		);

		return [sender, factoryGeneratorFunctionCallData];
	}

	createSendEthCallData(to: string, value: BigNumberish): BytesLike {
		return this.createCallData(to, value, "0x", 0);
	}

	createCallData(
		to: string,
		value: BigNumberish,
		data: BytesLike,
		operation: Operation,
	): BytesLike {
		const executorFunctionCallData = this.getExecutorCallData([
			to,
			value,
			data,
			operation,
		]);
		return executorFunctionCallData;
	}

	getProxyAddress(
		initializerCallData: BytesLike,
		safeProxyAddress: string,
		c2Nonce: BigNumberish,
	): string {
		const abiCoder = AbiCoder.defaultAbiCoder();
		const salt = keccak256(solidityPacked(
			["bytes32","uint256"], 
			[keccak256(initializerCallData),c2Nonce]));
		const initData = abiCoder.encode(
			["uint256"],
			[this.singletonAddress],
		);

		const initHash = keccak256(
			solidityPacked(["bytes", "bytes"], [this.proxyByteCode, initData]),
		);

		const proxyAdd = solidityPackedKeccak256(
			["bytes1", "address", "bytes32", "bytes32"],
			["0xff", safeProxyAddress, salt, initHash],
		).slice(-40);
		return "0x" + proxyAdd;
	}

	createCallDataSingleTransactionWithPaymaster(
		tx: MetaTransaction,
	): BytesLike {
		const executorFunctionCallData = this.getExecutorCallData([
			tx.to,
			tx.value,
			tx.data,
			tx.operation,
		]);
		return executorFunctionCallData;
	}

	createCallDataSingleTransaction(
		tx: MetaTransaction
		): BytesLike{
			return this.createCallDataSingleTransactionWithPaymaster(
				tx);
		}

	createCallDataBatchTransactionWithPaymaster(
		txs: MetaTransaction[],
		paymaster: string,
		approveToken: string,
		approveAmount: BigNumberish,
		): BytesLike {
			const multisendContractAddress: string = "0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526"
			const multiData = encodeMultiSendCallData(txs);

			const mutisendSelector = "0x8d80ff0a";
			const multiSendCallData =  getCallData(
				mutisendSelector,
				["bytes"],
				[multiData]
				);

			const executorFunctionCallData = this.getExecutorCallData([
				multisendContractAddress,
				0,
				multiSendCallData,
				Operation.Delegate,
				paymaster,
				approveToken,
				approveAmount,
			]);

			return executorFunctionCallData;
	}

	createCallDataBatchTransaction(
		txs: MetaTransaction[]
		): BytesLike{
			return this.createCallDataBatchTransactionWithPaymaster(
				txs, ZeroAddress, ZeroAddress, 0);
		}
}
