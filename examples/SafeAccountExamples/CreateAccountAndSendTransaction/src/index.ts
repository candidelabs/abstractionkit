import * as dotenv from 'dotenv'

import { 
    SafeAccount, 
    MetaTransaction,
    Operation,
    JsonRpcError,
    BundlerJsonRpcError,
} from "abstractionkit";

async function main(): Promise<void> {
    //get vlues from .env
    dotenv.config()
    const chainId = BigInt(process.env.CHAIN_ID as string)
    const bundlerUrl = process.env.BUNDLER_URL as string
    const jsonRpcNodeProvider = process.env.JSON_RPC_NODE_PROVIDER as string
    const ownerPublicAddress = process.env.PUBLIC_ADDRESS as string
    const privateKey = process.env.PRIVATE_KEY as string

    //calculateAccountAddressAndInitCode only needed when the smart account
    //have not been deployed yet for its first useroperation.
    //You can calculate the account address from its initilizer owners.
    //You can store the accountAddress to use it to initialize 
    //the SafeAccount object later after the safe account is deployed
    let [accountAddress, initCode] = SafeAccount.createAccountAddressAndInitCode(
        [ownerPublicAddress],
    )

    //Initialize a Safe account with the accountAddress address
    let smartAccount:SafeAccount = new SafeAccount(accountAddress)

    console.log("Account address(sender) : " + accountAddress)

    //create two meta transaction to mint two NFTs
    //use you favorite method (like ethers.js) to construct the call data 
    const transaction1 :MetaTransaction ={
        to: "0xD9de104e3386d9A45a61BcE269c43E48B534e4E7", //Nft contract address
        value: 0n,
        data: "0x1249c58b", //mint
    }

    const transaction2 :MetaTransaction ={
        to: "0xD9de104e3386d9A45a61BcE269c43E48B534e4E7", //Nft contract address
        value: 0n,
        data: "0x1249c58b", //mint
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
        // {
        //     initCode:initCode //only needed for the first useroperation
        // }
	)

    //error handling
    if("code" in userOperation){
        const error = userOperation as BundlerJsonRpcError | JsonRpcError
        console.log(error.message)
        return
    }
 
    //Safe is a multisig that can have multiple owners/signers
    //signUserOperation will create a signature for the provided
    //privateKeys
    userOperation.signature = smartAccount.signUserOperation(
		userOperation,
        [privateKey],
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
    let receipt = await sendUserOperationResponse.included()

    //error handling
    if("code" in receipt){
        const error = receipt as BundlerJsonRpcError
        console.log(error.message)
        return
    }
    console.log("Useroperation receipt received.")
    console.log(receipt)
    console.log("Two Nfts were mented. The transaction hash is : " + receipt['receipt']['transactionHash'])
}

main()