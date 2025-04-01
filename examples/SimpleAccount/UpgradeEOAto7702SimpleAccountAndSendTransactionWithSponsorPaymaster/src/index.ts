import * as dotenv from 'dotenv'
import {
    Simple7702Account,
    getFunctionSelector,
    createCallData,
    sendJsonRpcRequest,
    createAndSignEip7702DelegationAuthorization,
    CandidePaymaster,
} from "abstractionkit";
import { ethers } from 'ethers';

async function main(): Promise<void> {
    //get values from .env
    dotenv.config()
    const chainId = BigInt(process.env.CHAIN_ID as string)
    const bundlerUrl = process.env.BUNDLER_URL as string
    const jsonRpcNodeProvider = process.env.JSON_RPC_NODE_PROVIDER as string;
    
    const eoaDelegator = ethers.Wallet.createRandom();
    const eoaDelegatorPublicAddress = eoaDelegator.address;
    const eoaDelegatorPrivateKey = eoaDelegator.privateKey;
    const paymasterRPC = process.env.PAYMASTER_RPC as string;
    const sponsorshipPolicyId = process.env.SPONSORSHIP_POLICY_ID as string;


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
        paymasterRPC
    )

    let [paymasterUserOperation, _sponsorMetadata] = await paymaster.createSponsorPaymasterUserOperation(
        userOperation, bundlerUrl, sponsorshipPolicyId) // sponsorshipPolicyId will have no effect if empty
    userOperation = paymasterUserOperation; 

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
