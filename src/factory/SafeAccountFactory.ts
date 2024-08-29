import { SmartAccountFactory } from "./SmartAccountFactory";
export class SafeAccountFactory extends SmartAccountFactory {
	static readonly DEFAULT_FACTORY_ADDRESS =
		"0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67";
	constructor(address: string = SafeAccountFactory.DEFAULT_FACTORY_ADDRESS) {
		const generatorFunctionSelector = "0x1688f0b9"; //createProxyWithNonce
		const generatorFunctionInputAbi = [
			"address", //_singleton
			"bytes", //initializer
			"uint256", //saltNonce
		];
		super(address, generatorFunctionSelector, generatorFunctionInputAbi);
	}
}
