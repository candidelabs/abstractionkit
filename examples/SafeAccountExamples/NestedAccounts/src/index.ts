import * as dotenv from 'dotenv'
import * as ethers from 'ethers'

import {
    SafeAccountV0_3_0 as SafeAccount,
    MetaTransaction,
    CandidePaymaster,
    getFunctionSelector,
    createCallData,
    SendUseroperationResponse,
} from "abstractionkit";

async function main(): Promise<void> {
    //get values from .env
    dotenv.config()
    const chainId = BigInt(process.env.CHAIN_ID as string)
    const bundlerUrl = process.env.BUNDLER_URL as string
    const jsonRpcNodeProvider = process.env.JSON_RPC_NODE_PROVIDER as string
    const paymasterRPC = process.env.PAYMASTER_RPC as string;
    const sponsorshipPolicyId = process.env.SPONSORSHIP_POLICY_ID as string;

    /*subaccount1 signers*/
    const signer1Subaccount1 = ethers.Wallet.createRandom();
    const signer2Subaccount1 = ethers.Wallet.createRandom();
    /*subaccount2 signers*/
    const signer1Subaccount2 = ethers.Wallet.createRandom();
    const signer2Subaccount2 = ethers.Wallet.createRandom();

    /* initialize subaccounts */ 
    const subAccount1 = SafeAccount.initializeNewAccount(
        [signer1Subaccount1.address, signer2Subaccount1.address],
        {threshold:2}
    )
    const subAccount2 = SafeAccount.initializeNewAccount(
        [signer1Subaccount2.address, signer2Subaccount2.address],
        {threshold:2}
    )
    /*****************************************************/
    //calculate main account factory data
    const mainAccountFactoryData = SafeAccount.createFactoryAddressAndData(
        [subAccount1.accountAddress, subAccount2.accountAddress],
        {threshold:2}
    )
    const factoryAddress = mainAccountFactoryData[0];
    const factoryData = mainAccountFactoryData[1];

    //use subaccount1 to deploy the main account
    //any account can deploy the account using a 4337 userop or using
    //a normal transaction
    //using a userop from subaccount1 to be able to use a 4337 paymaster
    const deployMainAccountMetaTransaction = {
        to:factoryAddress,
        data:factoryData,
        value: 0n,
    }
    let subAccount1DeployMainAccountUserOperation = await subAccount1.createUserOperation(
		[deployMainAccountMetaTransaction],
        jsonRpcNodeProvider,
        bundlerUrl,
	)
    let paymaster: CandidePaymaster = new CandidePaymaster(
        paymasterRPC
    )

    const [paymasterSubAccount1UserOperation, _sponsorMetadata] = await paymaster.createSponsorPaymasterUserOperation(
        subAccount1DeployMainAccountUserOperation, bundlerUrl, sponsorshipPolicyId) // sponsorshipPolicyId will have no effect if empty
    subAccount1DeployMainAccountUserOperation = paymasterSubAccount1UserOperation; 

    subAccount1DeployMainAccountUserOperation.signature = subAccount1.signUserOperation(
		subAccount1DeployMainAccountUserOperation,
        [signer1Subaccount1.privateKey, signer2Subaccount1.privateKey],
        chainId,
	)
    
    const subAccount1UserOperationResponse1 = await subAccount1.sendUserOperation(
        subAccount1DeployMainAccountUserOperation, bundlerUrl
    )

    console.log("Deploy Main account through subaccount1. Waiting to be included ......")
    await subAccount1UserOperationResponse1.included()
    console.log("Useroperation receipt received.")
    /*****************************************************/
    //create main account without initialization as it was already deployed
    const mainAccountAddress = SafeAccount.createAccountAddress(
        [subAccount1.accountAddress, subAccount2.accountAddress],
        {threshold:2}
    )

    const mainAccount = new SafeAccount(mainAccountAddress);

    console.log("Main Account address(sender) : " + mainAccount.accountAddress)
    console.log("Subaccount1 address(sender) : " + subAccount1.accountAddress)
    console.log("Subaccount2 address(sender) : " + subAccount2.accountAddress)

    
    //create a meta transaction to mint an NFT for the main account
    const nftContractAddress = "0x9a7af758aE5d7B6aAE84fe4C5Ba67c041dFE5336";
    const mintFunctionSignature =  'mint(address)';
    const mintFunctionSelector =  getFunctionSelector(mintFunctionSignature);
    const mintTransactionCallData = createCallData(
        mintFunctionSelector, 
        ["address"],
        [mainAccount.accountAddress]
    );
    const transaction1 :MetaTransaction ={
        to: nftContractAddress,
        value: 0n,
        data: mintTransactionCallData,
    }

    //approved hash signature for suncontract1
    const subContract1Sig =
        "0x000000000000000000000000" + subAccount1.accountAddress.slice(2) +
        "000000000000000000000000000000000000000000000000000000000000000001"

    //approved hash signature for suncontract2
    const subContract2Sig =
        "0x000000000000000000000000" + subAccount2.accountAddress.slice(2) +
        "000000000000000000000000000000000000000000000000000000000000000001"

    const subAccount1SignerSignaturePair = {
        signer: subAccount1.accountAddress,
        signature: subContract1Sig
    }
    const subAccount2SignerSignaturePair = {
        signer: subAccount2.accountAddress,
        signature: subContract2Sig
    }

    let mainAccountUserOperation = await mainAccount.createUserOperation(
		[
            transaction1,
        ],
        jsonRpcNodeProvider,
        bundlerUrl,
        {
            dummySignerSignaturePairs:[
                subAccount1SignerSignaturePair,
                subAccount2SignerSignaturePair
            ]
        }
	)
    
    let [paymasterUserOperation1, _sponsorMetadata1] = await paymaster.createSponsorPaymasterUserOperation(
        mainAccountUserOperation, bundlerUrl, sponsorshipPolicyId) // sponsorshipPolicyId will have no effect if empty
    mainAccountUserOperation = paymasterUserOperation1; 
    
    mainAccountUserOperation.signature = SafeAccount.formatSignaturesToUseroperationSignature(
        [subAccount1SignerSignaturePair, subAccount2SignerSignaturePair]
    )
    /***********************************/
    //create approveHash metaTransaction
    const userOperationEip712Hash = SafeAccount.getUserOperationEip712Hash(
        mainAccountUserOperation,
        chainId,
    );
    const approveHashFunctionSelector =  "0xd4d9bdcd"; //approveHash(bytes32)
    const approveHashTransactionCallData = createCallData(
        approveHashFunctionSelector, 
        ["bytes32"],
        [userOperationEip712Hash]
    );
    const approveHashMetaTransaction :MetaTransaction ={
        to: mainAccount.accountAddress,
        value: 0n,
        data: approveHashTransactionCallData,
    }
    /***********************************/
    //create two userops to approveHash for each subaccount
    let subAccount1UserOperation = await subAccount1.createUserOperation(
		[approveHashMetaTransaction],
        jsonRpcNodeProvider,
        bundlerUrl,
	)
    const [paymasterSubAccount1UserOperation11, _sponsorMetadata11] = await paymaster.createSponsorPaymasterUserOperation(
        subAccount1UserOperation, bundlerUrl, sponsorshipPolicyId) // sponsorshipPolicyId will have no effect if empty
    subAccount1UserOperation = paymasterSubAccount1UserOperation11; 

    subAccount1UserOperation.signature = subAccount1.signUserOperation(
		subAccount1UserOperation,
        [signer1Subaccount1.privateKey, signer2Subaccount1.privateKey],
        chainId,
	)
    let subAccount2UserOperation = await subAccount2.createUserOperation(
		[approveHashMetaTransaction],
        jsonRpcNodeProvider,
        bundlerUrl,
	)
    const [paymasterSubAccount2UserOperation, _sponsorMetadata2] = await paymaster.createSponsorPaymasterUserOperation(
        subAccount2UserOperation, bundlerUrl, sponsorshipPolicyId) // sponsorshipPolicyId will have no effect if empty
    subAccount2UserOperation = paymasterSubAccount2UserOperation;

    subAccount2UserOperation.signature = subAccount2.signUserOperation(
		subAccount2UserOperation,
        [signer1Subaccount2.privateKey, signer2Subaccount2.privateKey],
        chainId,
	)
    /***********************************/
    console.log("Sending approve hash userops for subaccounts")
    const subAccount1UserOperationResponseOp = subAccount1.sendUserOperation(
        subAccount1UserOperation, bundlerUrl
    )
    const subAccount2UserOperationResponseOp = subAccount2.sendUserOperation(
        subAccount2UserOperation, bundlerUrl
    )

    let subAccount1UserOperationResponse:SendUseroperationResponse;
    let subAccount2UserOperationResponse:SendUseroperationResponse;
    await Promise.all(
        [subAccount1UserOperationResponseOp, subAccount2UserOperationResponseOp]
    ).then((values) => {
        subAccount1UserOperationResponse = values[0];
        subAccount2UserOperationResponse = values[1]; 
    }).catch((err) => {
        console.log(
            "userops for approving hash for subaccounts failed " +
            "with error:"
        )
        console.log(err)
        return
    });
    /***********************************/
    console.log("Waiting for approve hash userops for subaccounts to be included")
    await Promise.all(
        [
            subAccount1UserOperationResponse!.included(),
            subAccount2UserOperationResponse!.included(),
        ]
    ).catch((err) => {
        console.log(
            "userops for approving hash for subaccounts failed " +
            "waiting for inclusion with error:"
        )
        console.log(err)
        return
    });
    /***********************************/
    console.log("Sending main account userop")
    const sendMainAccountUserOperationResponse = await mainAccount.sendUserOperation(
        mainAccountUserOperation, bundlerUrl
    )

    console.log("Main useroperation sent. Waiting to be included ......")
    let userOperationReceiptResult = await sendMainAccountUserOperationResponse.included()

    console.log("Useroperation receipt received.")
    console.log(userOperationReceiptResult)
    if(userOperationReceiptResult.success){
        console.log(
            "Two Nfts were minted. The transaction hash is : " +
            userOperationReceiptResult.receipt.transactionHash
        )
    }else{
        console.log("Useroperation execution failed")
    }
}

main()
