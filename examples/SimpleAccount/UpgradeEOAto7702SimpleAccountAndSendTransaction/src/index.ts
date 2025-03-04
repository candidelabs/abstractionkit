import * as dotenv from 'dotenv'
import {
    Simple7702Account,
    getFunctionSelector,
    createCallData,
    sendJsonRpcRequest,
    createAndSignEip7702DelegationAuthorization,
} from "abstractionkit";

async function main(): Promise<void> {
    //get values from .env
    dotenv.config()
    const chainId = BigInt(process.env.CHAIN_ID as string)
    const bundlerUrl = process.env.BUNDLER_URL as string
    const jsonRpcNodeProvider = process.env.JSON_RPC_NODE_PROVIDER as string;

    const eoaDelegatorPublicKey = process.env.PUBLIC_ADDRESS as string;
    const eoaDelegatorPrivateKey = process.env.PRIVATE_KEY as string;

    // check balance of EOA before executing the upgrade userOp
    const balance = await sendJsonRpcRequest(
        jsonRpcNodeProvider,
        "eth_getBalance",
        [eoaDelegatorPublicKey, "latest",]
    ) as string; 

    if (BigInt(balance) === 0n) {
        console.log("Please fund the EOA Address with a sufficient balance of the native token to proceed");
        console.log("Address: ", eoaDelegatorPublicKey);
        return;
    }

    // initiate the smart account
    const smartAccount = new Simple7702Account(eoaDelegatorPublicKey);

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
            eip7702auth:{
                chainId: chainId, // chainId at which the account will be upgraded
            }
        }
    );

    userOperation.eip7702auth = createAndSignEip7702DelegationAuthorization(
        BigInt(userOperation.eip7702auth.chainId),
        userOperation.eip7702auth.address,
        BigInt(userOperation.eip7702auth.nonce),
        eoaDelegatorPrivateKey
    )

    userOperation.signature = smartAccount.signUserOperation(
        userOperation,
        eoaDelegatorPrivateKey,
        chainId,
    );

    console.log("userOperation: ", userOperation)

    let sendUserOperationResponse = await smartAccount.sendUserOperation(
        userOperation, bundlerUrl
    );

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