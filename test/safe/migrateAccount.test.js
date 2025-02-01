const accountAbstractionkit = require('../../dist/index.umd');
const ethers = require('ethers')
require('dotenv').config()

jest.setTimeout(300000);
const chainId = process.env.CHAIN_ID
const jsonRpcNodeProvider=process.env.JSON_RPC_NODE_PROVIDER
const bundlerUrl=process.env.BUNDLER_URL
const paymasterRPC = process.env.PAYMASTER_RPC;

describe('safe account migration', () => {
    test('migrate account from entrypoint v0.06 to entrypoint v0.07', async() => {
        //create a test userop to deploy the account first as migration
        //will fail if account is not deployed yet
        const randomSigner = ethers.Wallet.createRandom();
        const accountToMigrate =
            accountAbstractionkit.SafeAccountV0_2_0.initializeNewAccount(
                [randomSigner.address]);

        const testMetaTransaction = {
            to: accountToMigrate.accountAddress,
            value: 0n,
            data: "0x",
        }

        let testUserOperation = await accountToMigrate.createUserOperation(
            [testMetaTransaction],
            jsonRpcNodeProvider,
            bundlerUrl,
        )

        let paymaster = new accountAbstractionkit.CandidePaymaster(
            paymasterRPC
        )

        let [paymasterUserOperation, _sponsorMetadata] = await paymaster.createSponsorPaymasterUserOperation(
            testUserOperation, bundlerUrl)
        testUserOperation = paymasterUserOperation; 

        testUserOperation.signature = accountToMigrate.signUserOperation(
            testUserOperation,
            [randomSigner.privateKey],
            chainId,
        )
        let sendUserOperationResponse = await accountToMigrate.sendUserOperation(
            testUserOperation, bundlerUrl
        )
        
        await sendUserOperationResponse.included()

        /*****************************************/
        //create the migration user operation
        const migrateMetaTransactions = await accountToMigrate.createMigrateToV07ModuleMetaTransactions(
            jsonRpcNodeProvider
        );
        
        let migrateUserOperation = await accountToMigrate.createUserOperation(
            migrateMetaTransactions,
            jsonRpcNodeProvider,
            bundlerUrl,
        )
        
        const [paymasterUserOperation2, _sponsorMetadata2] = await paymaster.createSponsorPaymasterUserOperation(
            migrateUserOperation, bundlerUrl)
        migrateUserOperation = paymasterUserOperation2;

        migrateUserOperation.signature = accountToMigrate.signUserOperation(
            migrateUserOperation,
            [randomSigner.privateKey],
            chainId,
        )
        
        let migrateUserOperationResponse = await accountToMigrate.sendUserOperation(
            migrateUserOperation, bundlerUrl
        )

        await migrateUserOperationResponse.included()

        /*****************************************/
        // should fail after migration if still using SafeAccountV0_2_0
        await expect(accountToMigrate.createUserOperation(
            [testMetaTransaction],
            jsonRpcNodeProvider,
            bundlerUrl,
        ))
        .rejects
        .toThrow();
        
        const migratedAccount = new accountAbstractionkit.SafeAccountV0_3_0(
            accountToMigrate.accountAddress);

        // should work after migration if using SafeAccountV0_3_0
        let afterMigrationUserOperation = await migratedAccount.createUserOperation(
            [testMetaTransaction],
            jsonRpcNodeProvider,
            bundlerUrl,
        )
        
        const [paymasterUserOperation3, _sponsorMetadata3] = await paymaster.createSponsorPaymasterUserOperation(
            afterMigrationUserOperation, bundlerUrl)
        afterMigrationUserOperation = paymasterUserOperation3;

        afterMigrationUserOperation.signature = migratedAccount.signUserOperation(
            afterMigrationUserOperation,
            [randomSigner.privateKey],
            chainId,
        )
        let afterMigrationUserOperationResponse = await migratedAccount.sendUserOperation(
            afterMigrationUserOperation, bundlerUrl
        )
        
        await afterMigrationUserOperationResponse.included()
    });
});
