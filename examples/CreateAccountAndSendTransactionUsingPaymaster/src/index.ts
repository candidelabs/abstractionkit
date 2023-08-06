import * as dotenv from 'dotenv'
import {Wallet, JsonRpcProvider, getBytes, BigNumberish, BytesLike, JsonRpcError} from "ethers"

import { 
    Bundler, 
    CandideAccount, 
    GasEstimationResult, 
    UserOperation, 
    CandideValidationPaymaster, 
    getUserOperationHash, 
    UserOperationEmptyValues 
} from "abstractionkit";

async function main(): Promise<void> {
    //get vlues from .env
    dotenv.config()
    const bundlerUrl = process.env.BUNDLER_URL as string
    const jsonRpcNodeProvider = process.env.JSON_RPC_NODE_PROVIDER as string
    const entrypointAddress = process.env.ENTRYPOINT_ADDRESS as string
    const privateKey = process.env.PRIVATE_KEY as string
    const paymasterRPC = process.env.PAYMASTER_RPC as string
    const erc20TokenAddress = process.env.TOKEN_ADDRESS as string
    
    let bundler: Bundler = new Bundler(
        bundlerUrl,
        entrypointAddress
    );

    let eoaSigner = new Wallet(privateKey);

    let smartAccount = new CandideAccount()
    
    //create a new smart account, only needed for the first useroperation for a new account
    let [newAccountAddress, initCode] = smartAccount.createNewAccount([eoaSigner.address])

    //send 5 wei to 0x1a02592A3484c2077d2E5D24482497F85e1980C6
    let callData = smartAccount.createSendEthCallData(
        "0x1a02592A3484c2077d2E5D24482497F85e1980C6",
        5
    )

    const provider = new JsonRpcProvider(jsonRpcNodeProvider);

    let user_operation :UserOperation={
        ...UserOperationEmptyValues,
        sender:newAccountAddress,
        nonce: "0x00",
        initCode:initCode,//only needed for the first useroperation for a new account
        callData:callData
    }

    let estimation = await bundler.estimateUserOperationGas(user_operation)
    
    console.log(estimation)

    if("code" in estimation){
        return
    }

    estimation = estimation as GasEstimationResult

    const feeData = await provider.getFeeData()
    user_operation.maxFeePerGas = "0x" + feeData.maxFeePerGas?.toString(16) //convert to hex format
    user_operation.maxPriorityFeePerGas = "0x" + feeData.maxPriorityFeePerGas?.toString(16) //convert to hex format

    user_operation.preVerificationGas = "0x" + estimation.preVerificationGas.toString(16) //convert to hex format
    user_operation.verificationGasLimit = "0x" + Math.round(Number(estimation.verificationGas) * 3).toString(16) //convert to hex format - multiply by three to avoid outofgas error during validation(can be removed when the bundler returns an accurate estimation)
    user_operation.callGasLimit = estimation.callGasLimit

    //get early access to Candide's paymaster by visiting our discord https://discord.gg/KJSzy2Rqtg 
    let paymaster: CandideValidationPaymaster = new CandideValidationPaymaster(
        entrypointAddress,
        paymasterRPC
    )

    let paymasterAndDataResult = await paymaster.getPaymasterCallDataForPayingGasWithErc20(user_operation, erc20TokenAddress)

    console.log(paymasterAndDataResult)

    if("code" in paymasterAndDataResult){
        return
    }

    paymasterAndDataResult = paymasterAndDataResult as {paymasterAndData:BytesLike} //only needed id using a paymaster

    user_operation.paymasterAndData = paymasterAndDataResult.paymasterAndData as BytesLike

    const chainId = 5
    let user_operation_hash = getUserOperationHash(
        user_operation, entrypointAddress, chainId
    )

    user_operation.signature = await eoaSigner.signMessage(getBytes(user_operation_hash))

    let response1 = await bundler.sendUserOperation(user_operation)

    console.log(response1)    
}

main()