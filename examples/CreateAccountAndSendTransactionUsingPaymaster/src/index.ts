import * as dotenv from 'dotenv'
import {ZeroAddress, Wallet, JsonRpcProvider, getBytes, BytesLike} from "ethers"

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
    dotenv.config()
    const chainId = process.env.CHAIN_ID as string //goerli
    const bundlerUrl = process.env.BUNDLER_URL as string
    const jsonRpcNodeProvider = process.env.JSON_RPC_NODE_PROVIDER as string
    const entrypointAddress = process.env.ENTRYPOINT_ADDRESS as string
    const privateKey = process.env.PRIVATE_KEY as string
    const paymasterRPC = process.env.PAYMASTER_RPC as string
    const candidePaymasterAddress = process.env.CANDIDE_PAYMASTER_ADDRESS as string
    const erc20TokenAddress = process.env.TOKEN_ADDRESS as string
    
    let bundler: Bundler = new Bundler(
        bundlerUrl,
        entrypointAddress
    );

    let eoaSigner = new Wallet(privateKey);

    let smartAccount = new CandideAccount()
    
    //create a new smart account, only needed for the first useroperation for a new account
    let [newAccountAddress, initCode] = smartAccount.createNewAccount([eoaSigner.address])

    console.log("Account address(sender) : " + newAccountAddress)

    //send 5 wei to 0x1a02592A3484c2077d2E5D24482497F85e1980C6 
    let callData = smartAccount.createCallData(
		"0x1a02592A3484c2077d2E5D24482497F85e1980C6", //to
        5, //value
		"0x", //data
		0, //operation
		candidePaymasterAddress, //candide paymaster address
		erc20TokenAddress, //approveToken
        "0xffd4fdfb6ee21e", //approveAmount for the paymaster- to pay for gas using erc20 token
	)

    const provider = new JsonRpcProvider(jsonRpcNodeProvider);

    let user_operation :UserOperation={
        ...UserOperationDummyValues,
        sender:newAccountAddress,
        nonce: "0x00",
        initCode:initCode,//only needed for the first useroperation for a new account
        callData:callData,
    }

     //fetch gas price - use your prefered source
     const feeData = await provider.getFeeData()
     user_operation.maxFeePerGas = "0x" + feeData.maxFeePerGas?.toString(16)
     user_operation.maxPriorityFeePerGas = "0x" + feeData.maxPriorityFeePerGas?.toString(16)

   
    let estimation = await bundler.estimateUserOperationGas(user_operation)
    console.log(estimation)
    if("code" in estimation){
        return
    }
    //either multiply gas limit with a factor to compensate for the missing paymasterAndData and signature during gas estimation
    //or supply dummy values that will not cause the useroperation to revert
    //for the most accurate values, estimate gas again after acquiring the initial gas limits
    //and a valide paymasterAndData and signature
    estimation = estimation as GasEstimationResult
    user_operation.preVerificationGas = "0x" + Math.ceil(Number(estimation.preVerificationGas)*1.2).toString(16)
    user_operation.verificationGasLimit = "0x" + Math.ceil(Number(estimation.verificationGasLimit)*1.5).toString(16)
    user_operation.callGasLimit = "0x" + Math.ceil(Number(estimation.callGasLimit)*1.2).toString(16)

    //get early access to Candide's paymaster by visiting our discord https://discord.gg/KJSzy2Rqtg 
    let paymaster: CandideValidationPaymaster = new CandideValidationPaymaster(
        entrypointAddress,
        paymasterRPC
    )
    let paymasterAndDataResult = await paymaster.getPaymasterCallDataForPayingGasWithErc20(user_operation, erc20TokenAddress)
    console.log(paymasterAndDataResult)
    if("code" in paymasterAndDataResult){
        const errorresult = paymasterAndDataResult as JsonRpcError
        const errorMessage = errorresult.message
        if(errorMessage.includes("validator: token balance lower than the required")){
            console.log("Please fund the new account address(sender) with some CTT to pay for gas. visit our discord to get some test tokens https://discord.gg/KJSzy2Rqtg")
        }
        return
    }
    paymasterAndDataResult = paymasterAndDataResult as {paymasterAndData:BytesLike} //only needed id using a paymaster
    user_operation.paymasterAndData = paymasterAndDataResult.paymasterAndData as BytesLike

    //sign the user operation hash
    let user_operation_hash = getUserOperationHash(
        user_operation, entrypointAddress, chainId
    )
    user_operation.signature = await eoaSigner.signMessage(getBytes(user_operation_hash))

    let bundlerResponse = await bundler.sendUserOperation(user_operation)

    console.log(bundlerResponse)
}

main()