import * as dotenv from 'dotenv'

import { 
    SafeAccountV0_3_0,
    MetaTransaction,
    calculateUserOperationMaxGasCost,
    getFunctionSelector,
    createCallData,
    simulateUserOperationWithTenderlyAndCreateShareLink
} from "abstractionkit";

async function main(): Promise<void> {
    //get values from .env
    dotenv.config()
    const chainId = BigInt(process.env.CHAIN_ID as string)
    const bundlerUrl = process.env.BUNDLER_URL as string
    const jsonRpcNodeProvider = process.env.JSON_RPC_NODE_PROVIDER as string
    const ownerPublicAddress = process.env.PUBLIC_ADDRESS as string
    const ownerPrivateKey = process.env.PRIVATE_KEY as string
    const tenderlyAccountSlug = process.env.TENDERLYACCOUNTSLUG as string
    const tenderlyProjectSlug = process.env.TENDERLYPROJECTSlUG as string
    const tenderlyAccessKey = process.env.TENDERLYACCESSKEY as string

    //initializeNewAccount only needed when the smart account
    //have not been deployed yet for its first useroperation.
    //You can store the accountAddress to use it to initialize 
    //the SafeAccount object for the following useroperations
    let smartAccount = SafeAccountV0_3_0.initializeNewAccount(
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
    const callDataSim = await smartAccount.simulateCallDataWithTenderlyAndCreateShareLink(
        tenderlyAccountSlug,
        tenderlyProjectSlug,
        tenderlyAccessKey,
        jsonRpcNodeProvider,
        chainId,
        [transaction1, transaction2], 
       )
   console.log("calldata simulation link: ",  callDataSim.callDataSimulationShareLink)

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
        //uncomment the following values for polygon or any chains where
        //gas prices change rapidly
        {
        //    verificationGasLimitPercentageMultiplier:130
        //    maxFeePerGasPercentageMultiplier:130,
        //    maxPriorityFeePerGasPercentageMultiplier:130
        }
	)
    
    const cost = calculateUserOperationMaxGasCost(userOperation)
    console.log("This useroperation may cost upto : " + cost + " wei")
    console.log(
        "Please fund the sender account : " + 
        userOperation.sender +
        " with more than " + cost + " wei"
    )
 
    //Safe is a multisig that can have multiple owners/signers
    //signUserOperation will create a signature for the provided
    //privateKeys
    userOperation.signature = smartAccount.signUserOperation(
		userOperation,
        [ownerPrivateKey],
        chainId
	)
    const userOpSim = await simulateUserOperationWithTenderlyAndCreateShareLink(
        tenderlyAccountSlug,
        tenderlyProjectSlug,
        tenderlyAccessKey,
        chainId,
        smartAccount.entrypointAddress,
        userOperation
   )
    console.log("useroperation simulation link: ", userOpSim.simulationShareLink)
    console.log(userOperation)
}

main()
