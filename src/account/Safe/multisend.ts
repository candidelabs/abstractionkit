import { decodeAbiParameters, getBytes, solidityPacked } from "../../ethereUtils";
import { AbstractionKitError } from "src/errors";
import { type MetaTransaction, Operation } from "src/types";

/**
 * Official Safe MultiSend and MultiSendCallOnly deployments (v1.3.0 canonical,
 * eip155 and zkSync, v1.4.1 canonical and zkSync, v1.5.0 canonical), from
 * github.com/safe-global/safe-deployments. Lowercased for comparison.
 */
export const SAFE_MULTISEND_DEPLOYMENTS: readonly string[] = [
	"0xa238cbeb142c10ef7ad8442c6d1f9e89e07e7761", // MultiSend v1.3.0
	"0x998739bfdaadde7c933b942a68053933098f9eda", // MultiSend v1.3.0 eip155
	"0x0dfcccb95225ffb03c6fbb2559b530c2b7c8a912", // MultiSend v1.3.0 zkSync
	"0x40a2accbd92bca938b02010e17a5b8929b49130d", // MultiSendCallOnly v1.3.0
	"0xa1dabef33b3b82c7814b6d82a79e50f4ac44102b", // MultiSendCallOnly v1.3.0 eip155
	"0xf220d3b4dfb23c4ade8c88e526c1353abacbc38f", // MultiSendCallOnly v1.3.0 zkSync
	"0x38869bf66a61cf6bdb996a6ae40d5853fd43b526", // MultiSend v1.4.1
	"0x309d0b190fecca8e1d5d8309a16f7e3cb133e885", // MultiSend v1.4.1 zkSync
	"0x9641d764fc13c8b624c04430c7356c1c7c8102e2", // MultiSendCallOnly v1.4.1
	"0x0408ef011960d02349d50286d20531229bcef773", // MultiSendCallOnly v1.4.1 zkSync
	"0x218543288004cd07832472d464648173c77d7eb7", // MultiSend v1.5.0
	"0xa83c336b20401af773b6219ba5027174338d1836", // MultiSendCallOnly v1.5.0
];

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
