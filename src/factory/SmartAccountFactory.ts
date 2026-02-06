import type { AbiInputValue } from "../types";
import { createCallData } from "../utils";

/**
 * Generic factory for deploying smart account proxy contracts.
 * Encodes the factory address and createProxyWithNonce calldata into
 * the `initCode` field of a UserOperation.
 */
export class SmartAccountFactory {
	/** On-chain address of the factory contract */
	readonly address: string;
	/** 4-byte function selector for the factory's proxy creation method */
	readonly generatorFunctionSelector: string;
	/** ABI types for the proxy creation function parameters */
	readonly generatorFunctionInputAbi: string[];

	/**
	 * @param address - On-chain address of the factory contract
	 * @param generatorFunctionSelector - 4-byte hex selector for the proxy creation function
	 * @param generatorFunctionInputAbi - ABI type strings for the proxy creation function parameters
	 */
	constructor(
		address: string,
		generatorFunctionSelector: string,
		generatorFunctionInputAbi: string[],
	) {
		this.address = address;
		this.generatorFunctionSelector = generatorFunctionSelector;
		this.generatorFunctionInputAbi = generatorFunctionInputAbi;
	}

	/**
	 * Encode the factory address + calldata into the initCode format
	 * expected by the EntryPoint (factory address concatenated with calldata).
	 *
	 * @param generatorFunctionInputParameters - Values to ABI-encode as the factory function parameters
	 * @returns The full initCode string: factory address + ABI-encoded calldata (without "0x" prefix on the calldata portion)
	 */
	getFactoryGeneratorFunctionCallData(
		generatorFunctionInputParameters: AbiInputValue[],
	): string {
		const callData = createCallData(
			this.generatorFunctionSelector,
			this.generatorFunctionInputAbi,
			generatorFunctionInputParameters,
		);
		const res: string = this.address + callData.slice(2);

		return res;
	}
}
