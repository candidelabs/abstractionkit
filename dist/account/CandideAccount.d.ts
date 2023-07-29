import { SmartAccount } from "./SmartAccount";
import type { BigNumberish, BytesLike } from "ethers";
import type { Operation } from "../types";
import { SmartAccountFactory } from "../factory/SmartAccountFactory";
export declare class CandideAccount extends SmartAccount {
	readonly entrypointAddress: string;
	readonly candideAccountFactory: SmartAccountFactory;
	constructor(
		singletonAddress?: string,
		entrypointAddress?: string,
		candideAccountFactory?: SmartAccountFactory,
	);
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
	createSendEthCallData(to: string, value: BigNumberish): BytesLike;
	createCallData(
		to: string,
		value: BigNumberish,
		data: BytesLike,
		operation: Operation,
		paymaster: string,
		approveToken: string,
		approveAmount: BigNumberish,
	): BytesLike;
}
//# sourceMappingURL=CandideAccount.d.ts.map
