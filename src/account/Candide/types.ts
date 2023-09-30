import { BigNumberish, BytesLike } from "ethers";
import type { Operation } from "../../types";

export interface MetaTransaction {
    to: string;
    value: BigNumberish;
    data: BytesLike;
    operation: Operation;
}