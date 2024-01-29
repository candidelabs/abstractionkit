import { AbiCoder, getBytes, solidityPacked } from "ethers";
import { MetaTransaction, Operation } from "src/types";

/**
 * Encodes a Metatransaction to be executed by Safe contract
 * @param metaTransaction - metatransaction to be encoded
 * @returns  The encoded metatransaction
 */
function encodeMultiSendTransaction(metaTransaction: MetaTransaction): string {
	const operation = metaTransaction.operation ?? Operation.Call;

	const data = getBytes(metaTransaction.data);
	const encoded = solidityPacked(
		["uint8", "address", "uint256", "uint256", "bytes"],
		[operation, metaTransaction.to, metaTransaction.value, data.length, data],
	);
	return encoded.slice(2);
}

/**
 * Encodes a Metatransaction list to be batch executed by Safe contract
 * @param metaTransactions - metatransaction list to be encoded
 * @returns The encoded metatransaction
 */
export function encodeMultiSendCallData(
	metaTransactions: MetaTransaction[],
): string {
	return (
		"0x" + metaTransactions.map((tx) => encodeMultiSendTransaction(tx)).join("")
	);
}

export function decodeMultiSendCallData(callData: string): string {
	const abiCoder = AbiCoder.defaultAbiCoder();
	const decodedCalldata = abiCoder.decode(["bytes"], "0x" + callData.slice(10));
	return decodedCalldata[0] as string;
}
