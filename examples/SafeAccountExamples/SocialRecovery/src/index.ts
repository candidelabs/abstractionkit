import * as dotenv from 'dotenv'

import {
    SafeAccountV0_2_0 as SafeAccount,
    calculateUserOperationMaxGasCost,
    CandidePaymaster,
    SocialRecoveryModule,
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
    
    const guardianPublicAddress = process.env.GUARDIAN_PUBLIC_ADDRESS as string

    //initializeNewAccount only needed when the smart account
    //have not been deployed yet for its first useroperation.
    //You can store the accountAddress to use it to initialize 
    //the SafeAccount object for the following useroperations
    let smartAccount = SafeAccount.initializeNewAccount(
        [ownerPublicAddress],
    )

    console.log("Account address(sender) : " + smartAccount.accountAddress)
    
    const srm = new SocialRecoveryModule()

    const transction1 = srm.createEnableModuleMetaTransaction(
        smartAccount.accountAddress
    );
    const transction2 = srm.createAddGuardianWithThresholdMetaTransaction(
        smartAccount.accountAddress,
        guardianPublicAddress,
        1n //threshold
    );

    //createUserOperation will determine the nonce, fetch the gas prices,
    //estimate gas limits and return a useroperation to be signed.
    //you can override all these values using the overrides parameter.
    let userOperation = await smartAccount.createUserOperation(
		[
            //You can batch multiple transactions to be executed in one useroperation.
            transction1,
            transction2
        ],
        jsonRpcNodeProvider, //the node rpc is used to fetch the current nonce and fetch gas prices.
        bundlerUrl, //the bundler rpc is used to estimate the gas limits.
	)

    let paymaster: CandidePaymaster = new CandidePaymaster(
        paymasterRPC
    )

    userOperation = await paymaster.createSponsorPaymasterUserOperation(
        userOperation, bundlerUrl)

    const cost = calculateUserOperationMaxGasCost(userOperation)
    console.log("This useroperation may cost upto : " + cost + " wei")
    console.log("This example uses a Candide paymaster to sponsor the useroperation, so there is not need to fund the sender account.")
    console.log("Get early access to Candide's sponsor paymaster by visiting our Discord")

    //Safe is a multisig that can have multiple owners/signers
    //signUserOperation will create a signature for the provided
    //privateKeys
    userOperation.signature = smartAccount.signUserOperation(
		userOperation,
        [ownerPrivateKey],
        chainId,
	)
    console.log(userOperation)

    //use the bundler rpc to send a userOperation
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
        console.log("Successful Useroperation. The transaction hash is : " + userOperationReceiptResult.receipt.transactionHash)
        const isGuardian = await srm.isGuardian(
            jsonRpcNodeProvider,
            smartAccount.accountAddress, 
            guardianPublicAddress
        );
        if(isGuardian){
            console.log("Guardian added confirmed. Guardian address is : " + guardianPublicAddress)
        }else{
            console.log("Adding guardian failed.")
        }
    }else{
        console.log("Useroperation execution failed")
    }
}

main()
