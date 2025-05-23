import * as dotenv from 'dotenv'
import {
    Simple7702Account,
    getFunctionSelector,
    createCallData,
    createAndSignEip7702DelegationAuthorization,
    CandidePaymaster,
} from "abstractionkit";

async function main(): Promise<void> {
    //get values from .env
    dotenv.config()
    const chainId = BigInt(process.env.CHAIN_ID as string)
    const bundlerUrl = process.env.BUNDLER_URL as string
    const jsonRpcNodeProvider = process.env.JSON_RPC_NODE_PROVIDER as string;
    
    const eoaDelegatorPublicAddress = process.env.PUBLIC_ADDRESS as string
    const eoaDelegatorPrivateKey = process.env.PRIVATE_KEY as string
    const paymasterUrl = process.env.PAYMASTER_URL as string;
    const paymasterTokenAddress = process.env.PAYMASTER_TOKEN_ADDRESS as string;

    // initiate the smart account
    const smartAccount = new Simple7702Account(eoaDelegatorPublicAddress);

    // We will be mitting two random NFTs in a single txs
    const nftContractAddress = "0x9a7af758aE5d7B6aAE84fe4C5Ba67c041dFE5336";
    const mintFunctionSignature = 'mint(address)';
    const mintFunctionSelector = getFunctionSelector(mintFunctionSignature);
    const mintTransactionCallData = createCallData(
        mintFunctionSelector,
        ["address"],
        [smartAccount.accountAddress]
    );
    const transaction1 = {
        to: nftContractAddress,
        value: 0n,
        data: mintTransactionCallData,
    }

    const transaction2 = {
        to: nftContractAddress,
        value: 0n,
        data: mintTransactionCallData,
    }

    let userOperation = await smartAccount.createUserOperation(
        [
            //You can batch multiple transactions to be executed in one useroperation.
            transaction1, transaction2,
        ],
        jsonRpcNodeProvider, //the node rpc is used to fetch the current nonce and fetch gas prices.
        bundlerUrl, //the bundler rpc is used to estimate the gas limits.
        {
            eip7702Auth:{
                chainId: chainId, // chainId at which the account will be upgraded
            }
        }
    );
    
    userOperation.eip7702Auth = createAndSignEip7702DelegationAuthorization(
        BigInt(userOperation.eip7702Auth.chainId),
        userOperation.eip7702Auth.address,
        BigInt(userOperation.eip7702Auth.nonce),
        eoaDelegatorPrivateKey
    )

    
    let paymaster: CandidePaymaster = new CandidePaymaster(
        paymasterUrl
    )

    const tokensSupported = await paymaster.fetchSupportedERC20TokensAndPaymasterMetadata();
    const tokenSelected = tokensSupported.tokens.find(token => token.address.toLocaleLowerCase() === paymasterTokenAddress.toLowerCase());

    console.log("This example uses Candide Token Paymaster");
    console.log("Please visit https://dashboard.candide.dev/ to get a Paymaster URL");
    console.log("Visit our Discord to get some CTT token for testing");

    if (tokenSelected) {
        userOperation = await paymaster.createTokenPaymasterUserOperation(
            smartAccount,
            userOperation,
            tokenSelected.address,
            bundlerUrl,
        )
        const cost = await paymaster.calculateUserOperationErc20TokenMaxGasCost(
            userOperation,
            tokenSelected.address,
        )
        console.log("This useroperation may cost upto : " + cost + " wei in " + tokenSelected.symbol + " token")
        console.log(
            "Please fund the sender account : " +
            userOperation.sender +
            " with more than " + cost + " wei CTT token"
        )
    }
    
    console.log("This example uses a Candide token paymaster.")
    console.log("Please visit https://dashboard.candide.dev/ to get a token paymaster url.")
    console.log("Please visit our Discord to get some CTT token for testing")

    userOperation.signature = smartAccount.signUserOperation(
        userOperation,
        eoaDelegatorPrivateKey,
        chainId,
    );
  
    
    let sendUserOperationResponse = await smartAccount.sendUserOperation(
        userOperation, bundlerUrl
    );

    console.log("userOperation: ", userOperation)
    console.log("userOp sent! Waiting for inclusion...");
    console.log("userOp Hash: ", sendUserOperationResponse.userOperationHash);

    let userOperationReceiptResult = await sendUserOperationResponse.included();

    console.log("Useroperation receipt received.")
    console.log(userOperationReceiptResult)
    if (userOperationReceiptResult.success) {
        console.log("EOA upgraded to a Smart Account and minted two Nfts! The transaction hash is : " + userOperationReceiptResult.receipt.transactionHash)
    } else {
        console.log("Useroperation execution failed")
    }
}

main()
