import * as dotenv from 'dotenv'

import { 
    SafeAccountV0_2_0 as SafeAccount,
    MetaTransaction,
    JsonRpcError,
    BundlerJsonRpcError,
    UserOperationReceiptResult,
    calculateUserOperationMaxGasCostInWei,
    getFunctionSelector,
    createCallData,
} from "abstractionkit";

async function main(): Promise<void> {
    //get vlues from .env
    dotenv.config()
    const chainId = BigInt(process.env.CHAIN_ID as string)
    const bundlerUrl = process.env.BUNDLER_URL as string
    const jsonRpcNodeProvider = process.env.JSON_RPC_NODE_PROVIDER as string
    const ownerPublicAddress = process.env.PUBLIC_ADDRESS as string
    const ownerPrivateKey = process.env.PRIVATE_KEY as string

    //initializeNewAccount only needed when the smart account
    //have not been deployed yet for its first useroperation.
    //You can calculate the account address from its owners.
    //You can store the accountAddress to use it to initialize 
    //the SafeAccount object later after the safe account is deployed
    let smartAccount = SafeAccount.initializeNewAccount(
        [ownerPublicAddress],
    )

    //After calculating the accountAddress, you can create a SafeAccount
    //object with the accountAddress
    //let smartAccount:SafeAccount = new SafeAccount(accountAddress)

    console.log("Account address(sender) : " + smartAccount.accountAddress)

    //create two meta transaction to mint two NFTs
    //you can use favorite method (like ethers.js) to construct the call data 
    const nftContractAddress = "0xD9de104e3386d9A45a61BcE269c43E48B534e4E7";
    const mintFunctionSignature =  'mint()';
    const mintFunctionSelector =  getFunctionSelector(mintFunctionSignature);
    const mintTransactionCallData = createCallData(mintFunctionSelector, [], []);
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
            transaction1, transaction2
        ],
        jsonRpcNodeProvider, //the node rpc is used to fetch the current nonce and fetch gas prices.
        bundlerUrl, //the bundler rpc is used to estimate the gas limits.
	)

    //error handling
    if("code" in userOperation){
        const error = userOperation as BundlerJsonRpcError | JsonRpcError
        console.log(error.message)
        return
    }

    const cost = calculateUserOperationMaxGasCostInWei(userOperation)
    console.log("This useroperation may cost upto : " + cost + " wei")
    console.log(
        "Please fund the sender account : " + 
        userOperation.sender +
        " with more than "+ cost + " wei"
    )
 
    //Safe is a multisig that can have multiple owners/signers
    //signUserOperation will create a signature for the provided
    //privateKeys
    userOperation.signature = smartAccount.signUserOperation(
		userOperation,
        [ownerPrivateKey],
        chainId,
	)
    console.log(userOperation)

    //use the the bundler rpc to send a useroperation to the bunder
    //sendUserOperation will return a SendUseroperationResponse object
    //that can be awaited for the useroperation to be included onchain
    const sendUserOperationResponse = await smartAccount.sendUserOperation(
        userOperation, bundlerUrl
    )

    //error handling
    if("code" in sendUserOperationResponse){
        const error = sendUserOperationResponse as BundlerJsonRpcError
        console.log(error.message)
        return
    }

    console.log("Useroperation sent. Waiting to be included ......")
    //included will return a UserOperationReceiptResult when 
    //useroperation is included onchain
    let userOperationReceiptResult = await sendUserOperationResponse.included()

    //error handling
    if("code" in userOperationReceiptResult){
        const error = userOperationReceiptResult as BundlerJsonRpcError
        console.log(error.message)
        return
    }
    userOperationReceiptResult = userOperationReceiptResult as UserOperationReceiptResult
    console.log("Useroperation receipt received.")
    console.log(userOperationReceiptResult)
    if(userOperationReceiptResult.success){
        console.log("Two Nfts were mented. The transaction hash is : " + userOperationReceiptResult.receipt.transactionHash)
    }else{
        console.log("Useroperation execution failed")
    }
}

main()