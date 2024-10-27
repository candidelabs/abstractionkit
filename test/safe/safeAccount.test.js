const accountAbstractionkit = require('../../dist/index.umd');
require('dotenv').config()

jest.setTimeout(300000);
const ownerPublicAddress=process.env.PUBLIC_ADDRESS1
const ownerPrivateKey=process.env.PRIVATE_KEY1
const chainId = process.env.CHAIN_ID
const jsonRpcNodeProvider=process.env.JSON_RPC_NODE_PROVIDER
const bundlerUrl=process.env.BUNDLER_URL
const safeAccountVersions = [
    accountAbstractionkit.SafeAccountV0_3_0,
    accountAbstractionkit.SafeAccountV0_2_0
]

describe('safe account', () => {
    let safeAccountVersionName;    
    safeAccountVersions.forEach((safeAccountVersion, index) => {
        if(index == 0){
            safeAccountVersionName = 'V3'
        }else{
            safeAccountVersionName = 'V2'
        }
        const expectedAccountAddress =
            safeAccountVersion.createAccountAddress(
            [ownerPublicAddress],
        )
        test('initialization - ' + safeAccountVersionName, () => {
            //initilize account
            //only needed if not deployed yet
            const smartAccount =
                safeAccountVersion.initializeNewAccount([ownerPublicAddress])
            expect(smartAccount.accountAddress).toBe(expectedAccountAddress);
        });
        
        test(
            'account funded - account needs to be funded with the chains native ' +
            'token for the following tests to succeed ' + expectedAccountAddress +
            ' - ' + safeAccountVersionName, async() => {
            const params = [
                expectedAccountAddress,
                "latest",
            ];

            const balance = await accountAbstractionkit.sendJsonRpcRequest(
                jsonRpcNodeProvider, "eth_getBalance", params);

            expect(BigInt(balance)).toBeGreaterThan(0n);
        });

        test('mint nft and deploy account if not deployed - ' +
            safeAccountVersionName, async() => {
            const smartAccount = new safeAccountVersion(
                expectedAccountAddress
            )

            //mint nft
            nftContractAddress = "0x9a7af758aE5d7B6aAE84fe4C5Ba67c041dFE5336";
            mintFunctionSignature =  'mint(address)';
            mintFunctionSelector =  accountAbstractionkit.getFunctionSelector(
                mintFunctionSignature);
            const mintTransactionCallData = accountAbstractionkit.createCallData(
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
                //    verificationGasLimitPercentageMultiplier:130
                //    maxFeePerGasPercentageMultiplier:130,
                //    maxPriorityFeePerGasPercentageMultiplier:130
                }
            )
            expect(userOperation.sender).toBe(smartAccount.accountAddress);
            
            const accountNonce =
                await accountAbstractionkit.fetchAccountNonce(
                    jsonRpcNodeProvider,
                    safeAccountVersion.DEFAULT_ENTRYPOINT_ADDRESS,
                    smartAccount.accountAddress,
                )
            userOperation.signature = smartAccount.signUserOperation(
                userOperation,
                [ownerPrivateKey],
                chainId,
                BigInt(Math.ceil(Date.now()/1000)-(5*60)), //after (5 minutes in the past)
                BigInt(Math.ceil(Date.now()/1000)+(50*60)) //until (50 minutes in the future)
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

            expect(accountNonce).toBe(userOperationReceiptResult.nonce);
        });
        
        async function removeOwner(
            jsonRpcNodeProvider,
            bundlerUrl,
            smartAccount,
            chainId,
            ownerPrivateKey,
            ownerPublicAddress,
        ) {
            //remove the owner first
            const removeOwnerMetaTransaction = 
                await smartAccount.createRemoveOwnerMetaTransaction(
                    jsonRpcNodeProvider,
                    ownerPublicAddress,
                    1
                )

            const removeOwnerUserOperation = await smartAccount.createUserOperation(
                [
                    removeOwnerMetaTransaction
                ],
                jsonRpcNodeProvider,
                bundlerUrl,
            )
            
            removeOwnerUserOperation.signature = smartAccount.signUserOperation(
                removeOwnerUserOperation,
                [ownerPrivateKey],
                chainId
            )

            sendUserOperationResponse = await smartAccount.sendUserOperation(
                removeOwnerUserOperation, bundlerUrl
            )

            await sendUserOperationResponse.included()
        }


        async function addOwner(
            jsonRpcNodeProvider,
            bundlerUrl,
            smartAccount,
            chainId,
            ownerPrivateKey,
            newOwnerPublicAddress,
        ) {
            const addOwnerMetaTransactions = 
                await smartAccount.createAddOwnerWithThresholdMetaTransactions(
                    newOwnerPublicAddress, 1
                )

            const addOwnerUserOperation = await smartAccount.createUserOperation(
                addOwnerMetaTransactions,
                jsonRpcNodeProvider,
                bundlerUrl,
            )
            
            addOwnerUserOperation.signature = smartAccount.signUserOperation(
                addOwnerUserOperation,
                [ownerPrivateKey],
                chainId
            )

            sendUserOperationResponse = await smartAccount.sendUserOperation(
                addOwnerUserOperation, bundlerUrl
            )

            await sendUserOperationResponse.included()
        }

        test('add owner - ' + safeAccountVersionName, async() => {
            const smartAccount = new safeAccountVersion(
                expectedAccountAddress
            )
            let owners = await smartAccount.getOwners(
                jsonRpcNodeProvider)
            
            const newOwnerPublicAddress=process.env.PUBLIC_ADDRESS2

            if(owners.includes(newOwnerPublicAddress)){
                await removeOwner(
                    jsonRpcNodeProvider,
                    bundlerUrl,
                    smartAccount,
                    chainId,
                    ownerPrivateKey,
                    newOwnerPublicAddress,
                )
            }
            await addOwner(
                jsonRpcNodeProvider,
                bundlerUrl,
                smartAccount,
                chainId,
                ownerPrivateKey,
                newOwnerPublicAddress,
            )

            owners = await smartAccount.getOwners(
                jsonRpcNodeProvider)

            expect(owners).toStrictEqual([newOwnerPublicAddress, ownerPublicAddress]);
         });
        
        test('swap owner - ' + safeAccountVersionName, async() => {
            const smartAccount = new safeAccountVersion(
                expectedAccountAddress
            )

            let owners = await smartAccount.getOwners(
                jsonRpcNodeProvider)
            
            const oldOwnerPublicAddress=process.env.PUBLIC_ADDRESS2

            if(!owners.includes(oldOwnerPublicAddress)){
                await addOwner(
                    jsonRpcNodeProvider,
                    bundlerUrl,
                    smartAccount,
                    chainId,
                    ownerPrivateKey,
                    oldOwnerPublicAddress,
                )
            }

            const swapOwnerPublicAddress=process.env.PUBLIC_ADDRESS3
            const swapOwnerMetaTransactions = 
                //notice createSwapOwnerMetaTransactions returns a list of MetaTransactions
                await smartAccount.createSwapOwnerMetaTransactions(
                    jsonRpcNodeProvider,
                    swapOwnerPublicAddress,
                    oldOwnerPublicAddress
                )

            const swapOwnerUserOperation = await smartAccount.createUserOperation(
                swapOwnerMetaTransactions,
                jsonRpcNodeProvider,
                bundlerUrl,
            )
            
            swapOwnerUserOperation.signature = smartAccount.signUserOperation(
                swapOwnerUserOperation,
                [ownerPrivateKey],
                chainId
            )

            sendUserOperationResponse = await smartAccount.sendUserOperation(
                swapOwnerUserOperation, bundlerUrl
            )

            await sendUserOperationResponse.included()
            owners = await smartAccount.getOwners(
                jsonRpcNodeProvider)

            expect(owners).toStrictEqual([swapOwnerPublicAddress, ownerPublicAddress]);
        });
        
        test('remove owner - ' + safeAccountVersionName, async() => {
            const smartAccount = new safeAccountVersion(
                expectedAccountAddress
            )

            let owners = await smartAccount.getOwners(
                jsonRpcNodeProvider)
            
            const removeOwnerPublicAddress=process.env.PUBLIC_ADDRESS3

            if(!owners.includes(removeOwnerPublicAddress)){
                await addOwner(
                    jsonRpcNodeProvider,
                    bundlerUrl,
                    smartAccount,
                    chainId,
                    ownerPrivateKey,
                    removeOwnerPublicAddress,
                )
            }

            const removeOwnerMetaTransaction = 
                await smartAccount.createRemoveOwnerMetaTransaction(
                    jsonRpcNodeProvider,
                    removeOwnerPublicAddress,
                    1
                )

            const removeOwnerUserOperation = await smartAccount.createUserOperation(
                [
                    removeOwnerMetaTransaction
                ],
                jsonRpcNodeProvider,
                bundlerUrl,
            )
            
            removeOwnerUserOperation.signature = smartAccount.signUserOperation(
                removeOwnerUserOperation,
                [ownerPrivateKey],
                chainId
            )

            sendUserOperationResponse = await smartAccount.sendUserOperation(
                removeOwnerUserOperation, bundlerUrl
            )

            await sendUserOperationResponse.included()
            
            owners = await smartAccount.getOwners(
                jsonRpcNodeProvider)

            expect(owners).toStrictEqual([ownerPublicAddress]);
        });
    });
});
