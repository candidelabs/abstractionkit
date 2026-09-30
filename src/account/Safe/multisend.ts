import { decodeAbiParameters, getBytes, solidityPacked } from "../../ethereUtils";
import { AbstractionKitError } from "src/errors";
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
	const decodedCalldata = decodeAbiParameters<[string]>(["bytes"], `0x${callData.slice(10)}`);
	return decodedCalldata[0];
}

/**
 * Split packed MultiSend transaction bytes (the output of
 * {@link decodeMultiSendCallData}) back into MetaTransactions.
 * Inverse of {@link encodeMultiSendCallData}.
 * @param packed - Packed transactions as a 0x-prefixed hex string
 * @returns The transactions in execution order
 * @throws AbstractionKitError with code "BAD_DATA" if the bytes are truncated
 */
export function decodeMultiSendTransactions(packed: string): MetaTransaction[] {
	const hex = packed.startsWith("0x") ? packed.slice(2) : packed;
	// Byte offsets, doubled for hex characters: operation(1) to(20) value(32) dataLength(32)
	const headerLength = (1 + 20 + 32 + 32) * 2;
	const transactions: MetaTransaction[] = [];
	let offset = 0;
	while (offset < hex.length) {
		if (offset + headerLength > hex.length) {
			throw new AbstractionKitError("BAD_DATA", "truncated MultiSend transaction header", {
				context: { packed },
			});
		}
		const operation = Number.parseInt(hex.slice(offset, offset + 2), 16);
		const to = `0x${hex.slice(offset + 2, offset + 42)}`;
		const value = BigInt(`0x${hex.slice(offset + 42, offset + 106)}`);
		const dataLength = Number(BigInt(`0x${hex.slice(offset + 106, offset + 170)}`)) * 2;
		const dataStart = offset + headerLength;
		if (dataStart + dataLength > hex.length) {
			throw new AbstractionKitError("BAD_DATA", "truncated MultiSend transaction data", {
				context: { packed },
			});
		}
		transactions.push({
			to,
			value,
			data: `0x${hex.slice(dataStart, dataStart + dataLength)}`,
			operation,
		});
		offset = dataStart + dataLength;
	}
	return transactions;
}
