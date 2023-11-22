import { SmartAccountFactory } from "./SmartAccountFactory";
export class SafeAccountFactory extends SmartAccountFactory {
	constructor(address: string = "0x90B38403c783188D4BD080130881D3Ae6B6200cB"){
		const generatorFunctionSelector = "0xbdbce807";
		const generatorFunctionInputAbi = ["address[]", "uint256", "uint256"];
		super(address, generatorFunctionSelector, generatorFunctionInputAbi);
	}
}
