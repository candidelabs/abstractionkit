const accountAbstractionkit = require('../../dist/index.umd');
require('dotenv').config()

jest.setTimeout(1000000);
const ownerPublicAddress=process.env.PUBLIC_ADDRESS1
const ownerPrivateKey=process.env.PRIVATE_KEY1
const delegateOwnerPublicAddress=process.env.PUBLIC_ADDRESS2
const delegateOwnerPrivateKey=process.env.PRIVATE_KEY2
const allowanceToken=process.env.ALLOWANCE_TOKEN_ADDRESS
const chainId = process.env.CHAIN_ID
const jsonRpcNodeProvider=process.env.JSON_RPC_NODE_PROVIDER
const bundlerUrl=process.env.BUNDLER_URL
const safeAccountVersions = [
    accountAbstractionkit.SafeAccountV0_3_0,
    accountAbstractionkit.SafeAccountV0_2_0
]

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('allowance module', () => {
    let safeAccountVersionName;    
    safeAccountVersions.forEach((safeAccountVersion, index) => {
        if(index == 0){
            safeAccountVersionName = 'V3'
        }else{
            safeAccountVersionName = 'V2'
        }
        const allowanceSourceExpectedAccountAddress =
            safeAccountVersion.createAccountAddress(
            [ownerPublicAddress],
        )
        let allowanceSourceAccount = new safeAccountVersion(
            allowanceSourceExpectedAccountAddress
        )
        
        const delegateExpectedAccountAddress =
            safeAccountVersion.createAccountAddress(
            [delegateOwnerPublicAddress],
        )
        let delegateAccount = new safeAccountVersion(
            delegateExpectedAccountAddress
        )
        console.log(
            "please fund the allowance source address : " + 
            allowanceSourceExpectedAccountAddress +
            " with eth and the target allowance token for the test to pass")
        
        console.log(
            "please fund the delegate address : " + 
            delegateExpectedAccountAddress +
            " with eth for the test to pass")

        const transferRecipient = "0x084178A5fD956e624FCb61C3c2209E3dcf42c8E8"
        const allowanceModule = new accountAbstractionkit.AllowanceModule()
        
        test('initialization and clear allowance - ' + safeAccountVersionName, async() => {
            //initilize account
            //only needed if not deployed yet
            allowanceSourceAccount =
                safeAccountVersion.initializeNewAccount([ownerPublicAddress])
            expect(allowanceSourceAccount.accountAddress).toBe(
                allowanceSourceExpectedAccountAddress);
            
            delegateAccount = safeAccountVersion.initializeNewAccount(
                    [delegateOwnerPublicAddress])
            expect(delegateAccount.accountAddress).toBe(
                delegateExpectedAccountAddress);
            
            const delegates = await allowanceModule.getDelegates(
                jsonRpcNodeProvider, allowanceSourceAccount.accountAddress)
            if(delegates.includes(delegateAccount.accountAddress)){
                const deleteAllowanceMetaTransaction = 
                    allowanceModule.createDeleteAllowanceMetaTransaction(
                        delegateAccount.accountAddress, allowanceToken
                    )
                const deleteAllowanceUserOperation =
                    await allowanceSourceAccount.createUserOperation(
                        [
                            deleteAllowanceMetaTransaction
                        ],
                        jsonRpcNodeProvider,
                        bundlerUrl,
                    )
                
                deleteAllowanceUserOperation.signature =
                    allowanceSourceAccount.signUserOperation(
                        deleteAllowanceUserOperation,
                        [ownerPrivateKey],
                        chainId
                    )
                 
                sendUserOperationResponse =
                    await allowanceSourceAccount.sendUserOperation(
                        deleteAllowanceUserOperation, bundlerUrl
                    )

                await sendUserOperationResponse.included()
            }
        });
        
        test(
            'should create one time allowance and execute transfer- ' + safeAccountVersionName
            , async() => {
            
            const addDelegateMetaTransaction = 
                allowanceModule.createAddDelegateMetaTransaction(
                    delegateAccount.accountAddress,
                )

            const setAllowanceMetaTransaction = 
                allowanceModule.createOneTimeAllowanceMetaTransaction(
                    delegateAccount.accountAddress,
                    allowanceToken,
                    1, //allowanceAmount
                    0 //startAfterInMinutes
                )
            
            let metaTransactionList = [
                addDelegateMetaTransaction,
                setAllowanceMetaTransaction
            ]
            
            const isAllowanceModuleEnabled = await allowanceSourceAccount.isModuleEnabled(
                jsonRpcNodeProvider, allowanceModule.moduleAddress
            )
            if(!isAllowanceModuleEnabled){
                const enableModule = allowanceModule.createEnableModuleMetaTransaction(
                    allowanceSourceAccount.accountAddress
                );
                metaTransactionList.unshift(enableModule)
            }

            const addDelegateAndSetAllowanceUserOperation =
                await allowanceSourceAccount.createUserOperation(
                    metaTransactionList,
                    jsonRpcNodeProvider,
                    bundlerUrl,
                )
            
            addDelegateAndSetAllowanceUserOperation.signature =
                allowanceSourceAccount.signUserOperation(
                    addDelegateAndSetAllowanceUserOperation,
                    [ownerPrivateKey],
                    chainId
                )
             
            sendUserOperationResponse =
                await allowanceSourceAccount.sendUserOperation(
                    addDelegateAndSetAllowanceUserOperation, bundlerUrl
                )

            await sendUserOperationResponse.included()
            
            const delegates = await allowanceModule.getDelegates(
                jsonRpcNodeProvider, allowanceSourceAccount.accountAddress)
            expect(delegates).toEqual(
                expect.arrayContaining([delegateAccount.accountAddress]));
            

            const tokenAllowance = await allowanceModule.getTokensAllowance(
                jsonRpcNodeProvider,
                allowanceSourceAccount.accountAddress,
                delegateAccount.accountAddress,
                allowanceToken 
            )
            expect(tokenAllowance).toEqual(expect.objectContaining({
                amount:1n,
                //spent:0n,
                resetTimeMin:0n,
            }))
            const allowanceTransferMetaTransaction =
                allowanceModule.createAllowanceTransferMetaTransaction(
                    allowanceSourceAccount.accountAddress,
                    allowanceToken,
                    transferRecipient,
                    1,
                    delegateAccount.accountAddress
                )
            
            const allowanceTransferUserOperation =
                await delegateAccount.createUserOperation(
                    [
                        allowanceTransferMetaTransaction,
                    ],
                    jsonRpcNodeProvider,
                    bundlerUrl,
                )
            
            allowanceTransferUserOperation.signature =
                delegateAccount.signUserOperation(
                    allowanceTransferUserOperation,
                    [delegateOwnerPrivateKey],
                    chainId
                )
            
            sendUserOperationResponse = await delegateAccount.sendUserOperation(
                allowanceTransferUserOperation, bundlerUrl
            )

            await sendUserOperationResponse.included()
        });
        
        test(
            'should fail if transfer for the second time with a one time allowance- ' + safeAccountVersionName
            , async() => {
            const allowanceTransferMetaTransaction =
                allowanceModule.createAllowanceTransferMetaTransaction(
                    allowanceSourceAccount.accountAddress,
                    allowanceToken,
                    transferRecipient,
                    1,
                    delegateAccount.accountAddress
                )

            //should fail as its is a one time allowance
            await expect(delegateAccount.createUserOperation(
                    [
                        allowanceTransferMetaTransaction,
                    ],
                    jsonRpcNodeProvider,
                    bundlerUrl,
                ))
            .rejects
            .toThrow();
        });
        
        test(
            'should pass after allowance is renewed- ' + safeAccountVersionName
            , async() => {
            const allowanceTransferMetaTransaction =
                allowanceModule.createAllowanceTransferMetaTransaction(
                    allowanceSourceAccount.accountAddress,
                    allowanceToken,
                    transferRecipient,
                    1,
                    delegateAccount.accountAddress
                )

            
            const renewAllowanceMetaTransaction =
                allowanceModule.createRenewAllowanceMetaTransaction(
                    delegateAccount.accountAddress,
                    allowanceToken,
                )

            const renewAllowanceUserOperation =
                await delegateAccount.createUserOperation(
                    [
                        renewAllowanceMetaTransaction,
                    ],
                    jsonRpcNodeProvider,
                    bundlerUrl,
                )
            
            renewAllowanceUserOperation.signature =
                delegateAccount.signUserOperation(
                    renewAllowanceUserOperation,
                    [delegateOwnerPrivateKey],
                    chainId
                )
            
            sendUserOperationResponse = await delegateAccount.sendUserOperation(
                renewAllowanceUserOperation, bundlerUrl
            )

            await sendUserOperationResponse.included()
            
            //should pass after allowance is renewed
            delegateAccount.createUserOperation(
                [
                    allowanceTransferMetaTransaction,
                ],
                jsonRpcNodeProvider,
                bundlerUrl,
            );
        });

        test(
            'should create recurrent allowance and execute transfer- ' + safeAccountVersionName
            , async() => {

            const addDelegateMetaTransaction = 
                allowanceModule.createAddDelegateMetaTransaction(
                    delegateAccount.accountAddress,
                )

            const setAllowanceMetaTransaction = 
                allowanceModule.createRecurringAllowanceMetaTransaction(
                    delegateAccount.accountAddress,
                    allowanceToken,
                    1, //allowanceAmount
                    3, //3 minutes
                    0 //startAfterInMinutes
                )
            
            let metaTransactionList = [
                addDelegateMetaTransaction,
                setAllowanceMetaTransaction
            ]
            
            const isAllowanceModuleEnabled = await allowanceSourceAccount.isModuleEnabled(
                jsonRpcNodeProvider, allowanceModule.moduleAddress
            )
            if(!isAllowanceModuleEnabled){
                const enableModule = allowanceModule.createEnableModuleMetaTransaction(
                    allowanceSourceAccount.accountAddress
                );
                metaTransactionList.unshift(enableModule)
            }

            const addDelegateAndSetAllowanceUserOperation =
                await allowanceSourceAccount.createUserOperation(
                    metaTransactionList,
                    jsonRpcNodeProvider,
                    bundlerUrl,
                )
            
            addDelegateAndSetAllowanceUserOperation.signature =
                allowanceSourceAccount.signUserOperation(
                    addDelegateAndSetAllowanceUserOperation,
                    [ownerPrivateKey],
                    chainId
                )
             
            sendUserOperationResponse =
                await allowanceSourceAccount.sendUserOperation(
                    addDelegateAndSetAllowanceUserOperation, bundlerUrl
                )

            await sendUserOperationResponse.included()
            
            const delegates = await allowanceModule.getDelegates(
                jsonRpcNodeProvider, allowanceSourceAccount.accountAddress)
            expect(delegates).toEqual(
                expect.arrayContaining([delegateAccount.accountAddress]));
            

            const tokenAllowance = await allowanceModule.getTokensAllowance(
                jsonRpcNodeProvider,
                allowanceSourceAccount.accountAddress,
                delegateAccount.accountAddress,
                allowanceToken 
            )
            expect(tokenAllowance).toEqual(expect.objectContaining({
                amount:1n,
                //spent:0n,
                resetTimeMin:3n,
            }))
        });
        
        test(
            'should fail if amount is more than authorized amount- ' + safeAccountVersionName
            , async() => {

            let transferRecipient = "0x084178A5fD956e624FCb61C3c2209E3dcf42c8E8"
            let allowanceTransferMetaTransaction =
                allowanceModule.createAllowanceTransferMetaTransaction(
                    allowanceSourceAccount.accountAddress,
                    allowanceToken,
                    transferRecipient,
                    2, //more than the authorized amount
                    delegateAccount.accountAddress
                )
            
            //should fail if amount is more than the authorized amount
            await expect(delegateAccount.createUserOperation(
                    [
                        allowanceTransferMetaTransaction,
                    ],
                    jsonRpcNodeProvider,
                    bundlerUrl,
                ))
            .rejects
            .toThrow();
        });
        
        test(
            'should pass if amount is less or equal authorized amount- ' + safeAccountVersionName
            , async() => {

            const allowanceTransferMetaTransaction =
                allowanceModule.createAllowanceTransferMetaTransaction(
                    allowanceSourceAccount.accountAddress,
                    allowanceToken,
                    transferRecipient,
                    1, //equal to the authorized amount
                    delegateAccount.accountAddress
                )
            //should pass if amount is less than or equal to the authorized amount
            const allowanceTransferUserOperation =
                await delegateAccount.createUserOperation(
                    [
                        allowanceTransferMetaTransaction,
                    ],
                    jsonRpcNodeProvider,
                    bundlerUrl,
                )
            
            allowanceTransferUserOperation.signature =
                delegateAccount.signUserOperation(
                    allowanceTransferUserOperation,
                    [delegateOwnerPrivateKey],
                    chainId
                )
            
            sendUserOperationResponse = await delegateAccount.sendUserOperation(
                allowanceTransferUserOperation, bundlerUrl
            )

            await sendUserOperationResponse.included()
        });
        
        test(
            'should fail if executed before recurringAllowanceValidityPeriod 3 minutes- ' + safeAccountVersionName
            , async() => {
            const allowanceTransferMetaTransaction =
                allowanceModule.createAllowanceTransferMetaTransaction(
                    allowanceSourceAccount.accountAddress,
                    allowanceToken,
                    transferRecipient,
                    1, //equal to the authorized amount
                    delegateAccount.accountAddress
                )

            //should fail if executed before recurringAllowanceValidityPeriod 3 minutes
            await expect(delegateAccount.createUserOperation(
                    [
                        allowanceTransferMetaTransaction,
                    ],
                    jsonRpcNodeProvider,
                    bundlerUrl,
                ))
            .rejects
            .toThrow();
            
            await delay(3 * 60 * 1000); //wait three minutes
        });
        
        test(
            'should pass if executed after recurringAllowanceValidityPeriod 3 minutes- ' + safeAccountVersionName
            , async() => {
            const allowanceTransferMetaTransaction =
                allowanceModule.createAllowanceTransferMetaTransaction(
                    allowanceSourceAccount.accountAddress,
                    allowanceToken,
                    transferRecipient,
                    1, //equal to the authorized amount
                    delegateAccount.accountAddress
                )

            //should pass if executed after recurringAllowanceValidityPeriod 3 minutes
            const recurrentTransferUserOperation = await delegateAccount.createUserOperation(
                [
                    allowanceTransferMetaTransaction,
                ],
                jsonRpcNodeProvider,
                bundlerUrl,
            );

            recurrentTransferUserOperation.signature =
                delegateAccount.signUserOperation(
                    recurrentTransferUserOperation,
                    [delegateOwnerPrivateKey],
                    chainId
                )
             
            sendUserOperationResponse = await delegateAccount.sendUserOperation(
                recurrentTransferUserOperation, bundlerUrl
            )
            
            await sendUserOperationResponse.included()
        });
        
        test(
            'should fail transfer if allowance was deleted- ' + safeAccountVersionName
            , async() => {
            const allowanceTransferMetaTransaction =
                allowanceModule.createAllowanceTransferMetaTransaction(
                    allowanceSourceAccount.accountAddress,
                    allowanceToken,
                    transferRecipient,
                    1, //equal to the authorized amount
                    delegateAccount.accountAddress
                )

            //wait 3 minutes for allowance to renew
            await delay(3 * 60 * 1000);

            //delete allowance
            const deleteAllowanceMetaTransaction = 
                allowanceModule.createDeleteAllowanceMetaTransaction(
                    delegateAccount.accountAddress, allowanceToken
                )
            const deleteAllowanceUserOperation =
                await allowanceSourceAccount.createUserOperation(
                    [
                        deleteAllowanceMetaTransaction
                    ],
                    jsonRpcNodeProvider,
                    bundlerUrl,
                )
            
            deleteAllowanceUserOperation.signature =
                allowanceSourceAccount.signUserOperation(
                    deleteAllowanceUserOperation,
                    [ownerPrivateKey],
                    chainId
                )
             
            sendUserOperationResponse =
                await allowanceSourceAccount.sendUserOperation(
                    deleteAllowanceUserOperation, bundlerUrl
                )

            await sendUserOperationResponse.included()

            //should fail as the allowance was deleted
            await expect(delegateAccount.createUserOperation(
                    [
                        allowanceTransferMetaTransaction,
                    ],
                    jsonRpcNodeProvider,
                    bundlerUrl,
                ))
            .rejects
            .toThrow();
        });
    });
});
