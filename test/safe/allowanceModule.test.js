const accountAbstractionkit = require('../../dist/index.umd');
require('dotenv').config()

jest.setTimeout(300000);
const ownerPublicAddress=process.env.PUBLIC_ADDRESS1
const ownerPrivateKey=process.env.PRIVATE_KEY1
const delegateOwnerPublicAddress=process.env.PUBLIC_ADDRESS2
const delegateOwnerPrivateKey=process.env.PRIVATE_KEY2
const allowanceToken=process.env.ALLOWANCE_TOKEN_ADDRESS
const chainId = process.env.CHAIN_ID
const jsonRpcNodeProvider=process.env.JSON_RPC_NODE_PROVIDER
const bundlerUrl=process.env.BUNDLER_URL
const safeAccountVersions = [
    //accountAbstractionkit.SafeAccountV0_3_0,
    accountAbstractionkit.SafeAccountV0_2_0
]

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
                        delegateAccount.accountAddress,
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

            }
        });

        test('create allowance - ' + safeAccountVersionName, async() => {

            const enableModule = allowanceModule.createEnableModuleMetaTransaction(
                allowanceSourceAccount.accountAddress
            );

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

            const addDelegateAndSetAllowanceUserOperation =
                await allowanceSourceAccount.createUserOperation(
                    [
                        //enableModule,
                        addDelegateMetaTransaction,
                        setAllowanceMetaTransaction
                    ],
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
            let transferRecipient = "0x084178A5fD956e624FCb61C3c2209E3dcf42c8E8"
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
