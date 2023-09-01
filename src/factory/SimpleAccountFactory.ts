import { SmartAccountFactory } from "./SmartAccountFactory";
export class SimpleAccountFactory extends SmartAccountFactory {
	constructor(address: string = "0x9406Cc6185a346906296840746125a0E44976454") {
		const generatorFunctionSelector = "0x5fbfb9cf"; //createAccount
		const generatorFunctionInputAbi = ["address", "uint256"];
		super(address, generatorFunctionSelector, generatorFunctionInputAbi);
	}
}
