import { ethers } from "ethers";
import { MetaTransaction } from "./types";
import { Operation } from "src/types";

/**
 * Encodes a Metatransaction to be executed by Safe contract
 * @param metaTransaction - The metatransaction to encoded
 * @returns  The encoded metatransaction
 */
function encodeMultiSendTransaction(metaTransaction: MetaTransaction): string {
	const operation = metaTransaction.operation ?? Operation.Call

    const data = ethers.getBytes(metaTransaction.data);
    const encoded = ethers.solidityPacked(
        ["uint8", "address", "uint256", "uint256", "bytes"],
        [operation, metaTransaction.to, metaTransaction.value, data.length, data],
    );
    return encoded.slice(2);
}

/**
 * Encodes a Metatransaction list to be batch executed by Safe contract
 * @param metaTransactions - The metatransaction list to encoded
 * @returns The encoded metatransaction
 */
export function encodeMultiSendCallData(metaTransactions: MetaTransaction[]): string {
    return "0x" + metaTransactions.map((tx) => encodeMultiSendTransaction(tx)).join("");
}