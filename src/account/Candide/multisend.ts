import { ethers } from "ethers";
import { MetaTransaction } from "./types";

function encodeMultiSendTransaction(tx: MetaTransaction): string {
    const data = ethers.getBytes(tx.data);
    const encoded = ethers.solidityPacked(
        ["uint8", "address", "uint256", "uint256", "bytes"],
        [tx.operation, tx.to, tx.value, data.length, data],
    );
    return encoded.slice(2);
}

export function encodeMultiSendCallData(txs: MetaTransaction[]): string {
    return "0x" + txs.map((tx) => encodeMultiSendTransaction(tx)).join("");
}