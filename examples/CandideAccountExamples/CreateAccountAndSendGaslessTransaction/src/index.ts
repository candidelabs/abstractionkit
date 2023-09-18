import * as dotenv from "dotenv";
import { ZeroAddress, Wallet, JsonRpcProvider, getBytes } from "ethers";

import {
	Bundler,
	CandideAccount,
	GasEstimationResult,
	UserOperation,
	CandideValidationPaymaster,
	getUserOperationHash,
	UserOperationDummyValues,
	JsonRpcError,
} from "abstractionkit";

async function main(): Promise<void> {
	//get vlues from .env
	dotenv.config();
	const chainId = process.env.CHAIN_ID as string; //goerli
	const bundlerUrl = process.env.BUNDLER_URL as string;
	const jsonRpcNodeProvider = process.env.JSON_RPC_NODE_PROVIDER as string;
	const entrypointAddress = process.env.ENTRYPOINT_ADDRESS as string;
	const privateKey = process.env.PRIVATE_KEY as string;
	const paymasterRPC = process.env.PAYMASTER_RPC as string;

	const bundler: Bundler = new Bundler(bundlerUrl, entrypointAddress);
	const eoaSigner = new Wallet(privateKey);
	const smartAccount = new CandideAccount();

	//create a new smart account, only needed for the first useroperation for a new account
	const [accountAddress, initCode] = smartAccount.createNewAccount([
		eoaSigner.address,
	]);

	console.log("Account address(sender) : " + accountAddress);

	// create callData to transfer 0 ETH to a ZeroAddress
	const callData = smartAccount.createSendEthCallData(
		ZeroAddress, // to
		0, // value
	);

	let user_operation: UserOperation = {
		...UserOperationDummyValues,
		sender: accountAddress,
		nonce: "0x00",
		initCode, //only needed for the first useroperation for a new account
		callData,
	};

	const provider = new JsonRpcProvider(jsonRpcNodeProvider);

	//fetch gas price - use your prefered source
	const feeData = await provider.getFeeData();
	user_operation.maxFeePerGas = "0x" + feeData.maxFeePerGas?.toString(16); //convert to hex format
	user_operation.maxPriorityFeePerGas = "0x" + feeData.maxPriorityFeePerGas?.toString(16); //convert to hex format

	let estimation = await bundler.estimateUserOperationGas(user_operation);

	if ("code" in estimation) {
		console.log(estimation);
		return;
	}
	//either multiply gas limit with a factor to compensate for the missing paymasterAndData and signature during gas estimation
	//or supply dummy values that will not cause the useroperation to revert
	//for the most accurate values, estimate gas again after acquiring the initial gas limits
	//and a valide paymasterAndData and signature
	estimation = estimation as GasEstimationResult;
	user_operation.preVerificationGas = "0x" + Math.ceil(Number(estimation.preVerificationGas) * 1.2).toString(16);
	user_operation.verificationGasLimit = "0x" + Math.ceil(Number(estimation.verificationGasLimit) * 1.5).toString(16);
	user_operation.callGasLimit = "0x" + Math.ceil(Number(estimation.callGasLimit) * 1.2).toString(16);

	// get early access to Candide's paymaster by visiting our discord https://discord.gg/KJSzy2Rqtg
	const paymaster: CandideValidationPaymaster = new CandideValidationPaymaster(
		entrypointAddress,
		paymasterRPC,
	);
	const paymasterResult = await paymaster.getPaymasterCallDataForGaslessTx(
		user_operation,
	);

	if ("code" in paymasterResult) {
		const errorresult = paymasterResult as JsonRpcError;
		const errorMessage = errorresult.message;
		console.log(errorMessage);
		return;
	}

	if (user_operation.paymasterAndData) {
		user_operation.paymasterAndData = paymasterResult.paymasterAndData;

		// replace new gas fields if provided by paymaster Result
		user_operation.callGasLimit = paymasterResult.callGasLimit ?? user_operation.callGasLimit;
		user_operation.preVerificationGas = paymasterResult.preVerificationGas ?? user_operation.preVerificationGas;
		user_operation.verificationGasLimit = paymasterResult.verificationGasLimit ?? user_operation.verificationGasLimit;
		user_operation.maxFeePerGas = paymasterResult.maxFeePerGas ?? user_operation.maxFeePerGas;
		user_operation.maxPriorityFeePerGas = paymasterResult.maxPriorityFeePerGas ?? user_operation.maxPriorityFeePerGas;
	} else {
		console.log("Please add a gas policy to sponsor this user operation");
	}

	//sign the user operation hash
	const user_operation_hash = getUserOperationHash(
		user_operation,
		entrypointAddress,
		chainId,
	);
	user_operation.signature = await eoaSigner.signMessage(
		getBytes(user_operation_hash),
	);

	const bundlerResponse = await bundler.sendUserOperation(user_operation);

	console.log(bundlerResponse, "bundlerResponse");
}

main();
