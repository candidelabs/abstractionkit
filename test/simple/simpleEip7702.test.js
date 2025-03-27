const accountAbstractionkit = require('../../dist/index.umd');
require('dotenv').config()

jest.setTimeout(300000);
const ownerPublicAddress=process.env.PUBLIC_ADDRESS2
const ownerPrivateKey=process.env.PRIVATE_KEY2
const chainId = process.env.CHAIN_ID
const jsonRpcNodeProvider=process.env.JSON_RPC_NODE_PROVIDER
const bundlerUrl=process.env.BUNDLER_URL


const eoaDelegatorAddress=process.env.PUBLIC_ADDRESS2
const eoaDelegatorPrivateKey=process.env.PRIVATE_KEY2

const ak = accountAbstractionkit;

describe('simple account', () => {
    test(
        'account funded - account needs to be funded with the chains native ' +
        'token for the following tests to succeed ' + eoaDelegatorAddress , 
    async() => {
        const params = [
            eoaDelegatorAddress ,
            "latest",
        ];

        const balance = await ak.sendJsonRpcRequest(
            jsonRpcNodeProvider, "eth_getBalance", params);

        expect(BigInt(balance)).toBeGreaterThan(0n);
    });

    test('mint nft and deploy account' , async() => {
        const smartAccount = new ak.Simple7702Account(eoaDelegatorAddress)

        //mint nft
        nftContractAddress = "0x9a7af758aE5d7B6aAE84fe4C5Ba67c041dFE5336";
        mintFunctionSignature =  'mint(address)';
        mintFunctionSelector =  ak.getFunctionSelector(
            mintFunctionSignature);
        const mintTransactionCallData = ak.createCallData(
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
        //createUserOperation will determine the nonce, fetch the gas prices,
        //estimate gas limits and return a useroperation to be signed.
        //you can override all these values using the overrides parameter.
        const userOperation = await smartAccount.createUserOperation(
            [
                //You can batch multiple transactions to be executed in one useroperation.
                transaction1, transaction2,
            ],
            jsonRpcNodeProvider, //the node rpc is used to fetch the current nonce and fetch gas prices.
            bundlerUrl, //the bundler rpc is used to estimate the gas limits.
            //uncomment the following values for polygon or any chains where
            //gas prices change rapidly
            {
                eip7702Auth:{
                    chainId:BigInt(chainId)
                },
            //    verificationGasLimitPercentageMultiplier:130
            //    maxFeePerGasPercentageMultiplier:130,
            //    maxPriorityFeePerGasPercentageMultiplier:130
            }
        )
        expect(userOperation.sender).toBe(smartAccount.accountAddress);
        userOperation.eip7702Auth = ak.createAndSignEip7702DelegationAuthorization(
            BigInt(userOperation.eip7702Auth.chainId),
            userOperation.eip7702Auth.address,
            BigInt(userOperation.eip7702Auth.nonce),
            eoaDelegatorPrivateKey
        )
        userOperation.signature = smartAccount.signUserOperation(
            userOperation,
            ownerPrivateKey,
            chainId,
        )
        //use the bundler rpc to send a userOperation
        //sendUserOperation will return a SendUseroperationResponse object
        //that can be awaited for the useroperation to be included onchain
        let sendUserOperationResponse = await smartAccount.sendUserOperation(
            userOperation, bundlerUrl
        )
        
        //included will return a UserOperationReceiptResult when 
        //useroperation is included onchain
        let userOperationReceiptResult = await sendUserOperationResponse.included()

        expect(userOperationReceiptResult.success).toBe(true);
    });
});
