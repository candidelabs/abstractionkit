import { AbiCoder, getBytes, solidityPacked } from "ethers";
import { type MetaTransaction, Operation } from "src/types";

/**
 * Pack a single MetaTransaction into the MultiSend byte layout
 * (operation, to, value, dataLength, data).
 * @param metaTransaction - The transaction to encode
 * @returns The encoded transaction bytes (without 0x prefix)
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
 * Encode a list of MetaTransactions into the `multiSend` argument for batch execution.
 * @param metaTransactions - The transactions to batch
 * @returns The concatenated encoded transactions as a 0x-prefixed hex string
 */
export function encodeMultiSendCallData(metaTransactions: MetaTransaction[]): string {
	return `0x${metaTransactions.map((tx) => encodeMultiSendTransaction(tx)).join("")}`;
}

/**
 * Decodes a MultiSend callData back into its packed transaction bytes.
 * Strips the function selector and ABI-decodes the inner bytes payload.
 * @param callData - The full MultiSend callData (with 0x prefix and function selector).
 * @returns The decoded packed transaction bytes as a hex string.
 */
export function decodeMultiSendCallData(callData: string): string {
	const abiCoder = AbiCoder.defaultAbiCoder();
	const decodedCalldata = abiCoder.decode(["bytes"], `0x${callData.slice(10)}`);
	return decodedCalldata[0] as string;
}
