import * as dotenv from 'dotenv'
import {Wallet, JsonRpcProvider, getBytes, BigNumberish } from "ethers"

import { 
    Bundler, 
    SimpleAccount, 
    GasEstimationResult, 
    UserOperation, 
    getUserOperationHash, 
    UserOperationDummyValues 
} from "abstractionkit";

async function main(): Promise<void> {
    //get vlues from .env
    dotenv.config()
    const chainId = process.env.CHAIN_ID as string
    const bundlerUrl = process.env.BUNDLER_URL as string
    const jsonRpcNodeProvider = process.env.JSON_RPC_NODE_PROVIDER as string
    const entrypointAddress = process.env.ENTRYPOINT_ADDRESS as string
    const privateKey = process.env.PRIVATE_KEY as string
    
    let bundler: Bundler = new Bundler(
        bundlerUrl,
        entrypointAddress
    );

    let eoaSigner = new Wallet(privateKey);

    let smartAccount = new SimpleAccount()
    console.log(eoaSigner.address)
    //create a new smart account, only needed for the first useroperation for a new account
    let [newAccountAddress, initCode] = smartAccount.createNewAccount(eoaSigner.address)

    console.log("Account address(sender) : " + newAccountAddress)

    //send 5 wei to 0x1a02592A3484c2077d2E5D24482497F85e1980C6
    let callData = smartAccount.createSendEthCallData(
        "0x1a02592A3484c2077d2E5D24482497F85e1980C6",
        5
    )

    const provider = new JsonRpcProvider(jsonRpcNodeProvider);

    let user_operation :UserOperation={
        ...UserOperationDummyValues,
        sender:newAccountAddress,
        nonce: "0x00",
        initCode:initCode,//only needed for the first useroperation for a new account
        callData:callData,
        signature: "0xe117eb2fc0bbfa880bf08958342f5284cc6f0fbbbde2a65f0c296c67fd9d2feb0acfc1d859bb1cf50606e57dcbe321e762814005e1d9e47b16811b8100a9c0ce1b", //dummy signature
    }

    //fetch gas price - use your prefered source
    const feeData = await provider.getFeeData()
    user_operation.maxFeePerGas = "0x" + Number(feeData.maxFeePerGas).toString(16) as BigNumberish//convert to hex format
    user_operation.maxPriorityFeePerGas = "0x" + Number(feeData.maxPriorityFeePerGas).toString(16) as BigNumberish //convert to hex format

   
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

    //sign the user operation hash
    let user_operation_hash = getUserOperationHash(
        user_operation, entrypointAddress, chainId
    )
    user_operation.signature = await eoaSigner.signMessage(getBytes(user_operation_hash))
    
    //send the user operation to the bundler
    let bundlerResponse = await bundler.sendUserOperation(user_operation)
    console.log(bundlerResponse)
    if("message" in bundlerResponse && bundlerResponse.message as string == "AA21 didn't pay prefund"){
        console.log("Please fund the new account address with some eth to pay for gas : " + newAccountAddress)
    }
}

main()