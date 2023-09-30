import * as dotenv from 'dotenv'
import {Wallet, JsonRpcProvider, getBytes, id, ZeroAddress } from "ethers"

import { 
    Bundler, 
    CandideAccount, 
    GasEstimationResult, 
    UserOperation, 
    getUserOperationHash, 
    UserOperationDummyValues,
    getCallData,
    MetaTransaction,
    getFunctionSelector,
    Operation
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

    let smartAccount = new CandideAccount()
    
    //create a new smart account, only needed for the first useroperation for a new account
    let [newAccountAddress, initCode] = smartAccount.createNewAccount([eoaSigner.address])
    
    console.log("Account address(sender) : " + newAccountAddress)

    // 1st transction - create callData to deposit eth and get wEth in return
    const wEthTokenAddress = "0xB4FBF271143F4FBf7B91A5ded31805e42b2208d6";
    const depositFunctionSignature =  'deposit()';
    const depositFunctionSelector =  getFunctionSelector(depositFunctionSignature);
    const depositTransactionCallData = getCallData(depositFunctionSelector, [], []);

    const tx1 :MetaTransaction ={
        to: wEthTokenAddress,
        value: 10, //amount to deposit
        data: depositTransactionCallData,
        operation: Operation.Call
    }

    // 2nd transaction - approve allowance to uniswap router
    const uniswapV2RouterAddress = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
    const approveFunctionSignature =  'approve(address,uint256)';
    const approveFunctionSelector =  getFunctionSelector(approveFunctionSignature);
    const approveTransactionCallData = getCallData(
        approveFunctionSelector, 
        ["address", "uint256"], 
        [uniswapV2RouterAddress, 10]
    );

    const tx2 :MetaTransaction ={
        to: wEthTokenAddress,
        value: 0,
        data: approveTransactionCallData,
        operation: Operation.Call
    }

    // 3rd transaction - swap weth for usdc
    const token0 = "0xB4FBF271143F4FBf7B91A5ded31805e42b2208d6"; //weth
    const token1 = "0x9B2660A7BEcd0Bf3d90401D1C214d2CD36317da5"; //usdc
    const swapFunctionSignature =  'swapExactTokensForTokens(uint256,uint256,address[],address,uint256)';
    const swapFunctionSelector =  getFunctionSelector(swapFunctionSignature);
    const swapTransactionCallData = getCallData(swapFunctionSelector,
         ["uint256","uint256","address[]","address", "uint256"], //amountIn, amountOutMin, path, to, deadline
         [
            5, //amountIn
            1, //amountOutMin
            [token0, token1], //path
            newAccountAddress, //to
            Math.floor(Date.now() / 1000) + 60 * 20, // deadline - 20 minutes from the current Unix time
        ]
        );
    const tx3 :MetaTransaction ={
            to: uniswapV2RouterAddress,
            value: 0,
            data: swapTransactionCallData,
            operation: Operation.Call
        }

    let callData = smartAccount.createCallDataBatchTransaction([tx1, tx2, tx3]);

    const provider = new JsonRpcProvider(jsonRpcNodeProvider);

    let user_operation :UserOperation={
        ...UserOperationDummyValues,
        sender:newAccountAddress,
        nonce: "0x00",
        initCode:initCode,//only needed for the first useroperation for a new account
        callData:callData
    }

    //fetch gas price - use your prefered source
    const feeData = await provider.getFeeData()
    user_operation.maxFeePerGas = "0x" + Math.ceil(Number(feeData.maxFeePerGas)*1.5).toString(16)//convert to hex format
    user_operation.maxPriorityFeePerGas = "0x" + Math.ceil(Number(feeData.maxPriorityFeePerGas)*1.5).toString(16)//convert to hex format

    let estimation = await bundler.estimateUserOperationGas(user_operation)
    console.log("estimation")
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