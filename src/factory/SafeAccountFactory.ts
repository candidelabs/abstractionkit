import { SmartAccountFactory } from "./SmartAccountFactory";
export class SafeAccountFactory extends SmartAccountFactory {
	constructor(address: string = "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67") {
		const generatorFunctionSelector = "0x1688f0b9"; //createProxyWithNonce
		const generatorFunctionInputAbi = [
			"address", //_singleton
			"bytes", //initializer
			"uint256", //saltNonce
		];
		super(address, generatorFunctionSelector, generatorFunctionInputAbi);
	}
}
