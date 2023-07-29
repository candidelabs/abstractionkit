import { SmartAccountFactory } from "./SmartAccountFactory";
export class CandideAccountFactory extends SmartAccountFactory {
	constructor(address: string = "0xb73Eb505Abc30d0e7e15B73A492863235B3F4309") {
		const generatorFunctionSelector = "0x1688f0b9";
		const generatorFunctionInputAbi = ["address", "bytes", "uint256"];
		super(address, generatorFunctionSelector, generatorFunctionInputAbi);
	}
}
