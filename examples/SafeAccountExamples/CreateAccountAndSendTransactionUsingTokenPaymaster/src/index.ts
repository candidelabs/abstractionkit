import * as dotenv from 'dotenv'

import {
    SafeAccountV0_3_0 as SafeAccount,
    MetaTransaction,
    CandidePaymaster,
    getFunctionSelector,
    createCallData,
} from "abstractionkit";

async function main(): Promise<void> {
    //get values from .env
    dotenv.config()
    const chainId = BigInt(process.env.CHAIN_ID as string)
    const bundlerUrl = process.env.BUNDLER_URL as string
    const jsonRpcNodeProvider = process.env.JSON_RPC_NODE_PROVIDER as string
    const ownerPublicAddress = process.env.PUBLIC_ADDRESS as string
    const ownerPrivateKey = process.env.PRIVATE_KEY as string
    const paymasterRPC = process.env.PAYMASTER_RPC as string;
    const paymasterTokenAddress = process.env.PAYMASTER_TOKEN_ADDRESS as string;
    
    //initializeNewAccount only needed when the smart account
    //have not been deployed yet for its first useroperation.
    //You can store the accountAddress to use it to initialize 
    //the SafeAccount object for the following useroperations
    let smartAccount = SafeAccount.initializeNewAccount(
        [ownerPublicAddress],
    )

    //After the account contract is deployed, no need to call initializeNewAccount
    //let smartAccount = new SafeAccount(accountAddress)

    console.log("Account address(sender) : " + smartAccount.accountAddress)

    //create two meta transaction to mint two NFTs
    //you can use favorite method (like ethers.js) to construct the call data 
    const nftContractAddress = "0x9a7af758aE5d7B6aAE84fe4C5Ba67c041dFE5336";
    const mintFunctionSignature =  'mint(address)';
    const mintFunctionSelector =  getFunctionSelector(mintFunctionSignature);
    const mintTransactionCallData = createCallData(
        mintFunctionSelector, 
        ["address"],
        [smartAccount.accountAddress]
    );
    const transaction1 :MetaTransaction ={
        to: nftContractAddress,
        value: 0n,
        data: mintTransactionCallData,
    }

    const transaction2 :MetaTransaction ={
        to: nftContractAddress,
        value: 0n,
        data: mintTransactionCallData,
    }

    //createUserOperation will determine the nonce, fetch the gas prices,
    //estimate gas limits and return a useroperation to be signed.
    //you can override all these values using the overrides parameter.
    let userOperation = await smartAccount.createUserOperation(
		[
            //You can batch multiple transactions to be executed in one useroperation.
            transaction1, transaction2,
        ],
        jsonRpcNodeProvider, //the node rpc is used to fetch the current nonce and fetch gas prices.
        bundlerUrl, //the bundler rpc is used to estimate the gas limits.
        {
            //add some extra buffer to the estimated gas limits
            preVerificationGasPercentageMultiplier:130,
            callGasLimitPercentageMultiplier:130,
        
        //uncomment the following values for polygon or any chains where
        //gas prices change rapidly
        //    maxFeePerGasPercentageMultiplier:130,
        //    maxPriorityFeePerGasPercentageMultiplier:130
        }
	)

    let paymaster: CandidePaymaster = new CandidePaymaster(
        paymasterRPC,
    )

    userOperation = await paymaster.createTokenPaymasterUserOperation(
        smartAccount,
        userOperation,
        paymasterTokenAddress,
        bundlerUrl,
    )

    const cost = await paymaster.calculateUserOperationErc20TokenMaxGasCost(
        userOperation,
        paymasterTokenAddress
    )
    console.log("This useroperation may cost upto : " + cost + " wei in CTT token")
    console.log(
        "Please fund the sender account : " + 
        userOperation.sender +
        " with more than "+ cost + " wei CTT token"
    )
    console.log("This example uses a Candide token paymaster.")
    console.log("Please visit https://dashboard.candide.dev/ to get a token paymaster url.")
    console.log("Please visit our Discord to get some CTT token for testing")

    //Safe is a multisig that can have multiple owners/signers
    //signUserOperation will create a signature for the provided
    //privateKeys
    userOperation.signature = smartAccount.signUserOperation(
		userOperation,
        [ownerPrivateKey],
        chainId,
	)
    console.log(userOperation)

    //use the bundler rpc to send a useroperation
    //sendUserOperation will return a SendUseroperationResponse object
    //that can be awaited for the useroperation to be included onchain
    const sendUserOperationResponse = await smartAccount.sendUserOperation(
        userOperation, bundlerUrl
    )

    console.log("Useroperation sent. Waiting to be included ......")
    //included will return a UserOperationReceiptResult when 
    //useroperation is included onchain
    let userOperationReceiptResult = await sendUserOperationResponse.included()

    console.log("Useroperation receipt received.")
    console.log(userOperationReceiptResult)
    if(userOperationReceiptResult.success){
        console.log("Two Nfts were minted. The transaction hash is : " + userOperationReceiptResult.receipt.transactionHash)
    }else{
        console.log("Useroperation execution failed")
    }
}

main()
