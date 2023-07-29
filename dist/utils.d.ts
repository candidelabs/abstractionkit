import type { AddressLike, BytesLike, BigNumberish } from "ethers";
import type { AbiInputValue, UserOperation } from "./types";
export declare function getUserOperationHash(
	useroperation: UserOperation,
	entrypointAddress: AddressLike,
	chainId: BigNumberish,
): BytesLike;
export declare function getPackedUserOperation(
	useroperation: UserOperation,
): BytesLike;
export declare function getCallData(
	functionSelector: string,
	functionInputAbi: string[],
	functionInputParameters: AbiInputValue[],
): BytesLike;
//# sourceMappingURL=utils.d.ts.map
