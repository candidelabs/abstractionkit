import * as dotenv from 'dotenv'
import * as ethers from 'ethers'

import { 
    SafeAccountV0_3_0 as SafeAccount,
    MetaTransaction,
    CandidePaymaster,
    getFunctionSelector,
    createCallData,
    WebauthPublicKey,
    WebauthSignatureData,
    SignerSignaturePair,
    WebauthDummySignerSignaturePair
} from "abstractionkit";
import {UserVerificationRequirement, WebAuthnCredentials, extractClientDataFields, extractPublicKey, extractSignature } from './webauthn';

async function main(): Promise<void> {
    //get values from .env
    dotenv.config()
    const chainId = BigInt(process.env.CHAIN_ID as string)
    const bundlerUrl = process.env.BUNDLER_URL as string
    const jsonRpcNodeProvider = process.env.JSON_RPC_NODE_PROVIDER as string
    const paymasterRPC = process.env.PAYMASTER_RPC as string;

    const navigator = {
        credentials: new WebAuthnCredentials(),
    }

    const credential = navigator.credentials.create({
        publicKey: {
          rp: {
            name: 'Safe',
            id: 'safe.global',
          },
          user: {
            id: ethers.getBytes(ethers.id('chucknorris')),
            name: 'chucknorris',
            displayName: 'Chuck Norris',
          },
          challenge: ethers.toBeArray(Date.now()),
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        },
      })

   
    const publicKey = extractPublicKey(credential.response)

    const webauthPublicKey: WebauthPublicKey = {
      x:publicKey.x,
      y:publicKey.y,
    }

    //initializeNewAccount only needed when the smart account
    //have not been deployed yet for its first useroperation.
    //You can store the accountAddress to use it to initialize 
    //the SafeAccount object for the following useroperations
    let smartAccount = SafeAccount.initializeNewAccount(
      [webauthPublicKey]
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
            transaction1, //transaction2,
        ],
        jsonRpcNodeProvider, //the node rpc is used to fetch the current nonce and fetch gas prices.
        bundlerUrl, //the bundler rpc is used to estimate the gas limits.
        {
          dummySignatures:[WebauthDummySignerSignaturePair]
        }
    )
  
    let paymaster: CandidePaymaster = new CandidePaymaster(
        paymasterRPC,// "v2"
    )
    console.log(userOperation)
    let [paymasterUserOperation, _sponsorMetadata] = await paymaster.createSponsorPaymasterUserOperation(
        userOperation,
        bundlerUrl,
        //{
        //    verificationGasLimitPercentageMultiplier:130
        //}
    )
    userOperation = paymasterUserOperation; 

    const safeInitOpHash = SafeAccount.getUserOperationEip712Hash(
			userOperation,
			chainId,
		)
    
    const assertion = navigator.credentials.get({
      publicKey: {
        challenge: ethers.getBytes(safeInitOpHash),
        rpId: 'safe.global',
        allowCredentials: [{ type: 'public-key', id: new Uint8Array(credential.rawId) }],
        userVerification: UserVerificationRequirement.required,
      },
    })

    const webauthSignatureData:WebauthSignatureData = {
      authenticatorData: assertion.response.authenticatorData,
      clientDataFields: extractClientDataFields(assertion.response),
      rs: extractSignature(assertion.response),
    }

    const webauthSignature:string = SafeAccount.createWebAuthnSignature(
      webauthSignatureData
    )

    const SignerSignaturePair:SignerSignaturePair = {
      signer:webauthPublicKey,
      signature:webauthSignature,
    }

    userOperation.signature = SafeAccount.formatSignaturesToUseroperationSignature(
      [SignerSignaturePair],
      {isInit:userOperation.nonce == 0n}
    )

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
        console.log("Two Nfts were minted. The transaction hash is : " + userOperationReceiptResult.receipt.transactionHash)
    }else{
        console.log("Useroperation execution failed")
    }
}

main()
