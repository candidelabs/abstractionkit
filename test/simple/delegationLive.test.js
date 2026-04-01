const ak = require('../../dist/index.umd');
require('dotenv').config();

jest.setTimeout(300000);

const chainId = BigInt(process.env.CHAIN_ID);
const jsonRpcNodeProvider = process.env.JSON_RPC_NODE_PROVIDER;
const bundlerUrl = process.env.BUNDLER_URL;
const paymasterRPC = process.env.PAYMASTER_RPC;

const eoaDelegatorAddress = process.env.PUBLIC_ADDRESS1;
const eoaDelegatorPrivateKey = process.env.PRIVATE_KEY1;

/**
 * Poll for a transaction receipt with a bounded number of retries.
 */
async function waitForReceipt(txHash, maxRetries = 60) {
    for (let i = 0; i < maxRetries; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const receipt = await ak.sendJsonRpcRequest(
            jsonRpcNodeProvider, "eth_getTransactionReceipt", [txHash]
        );
        if (receipt !== null) return receipt;
    }
    throw new Error(`Transaction ${txHash} not mined after ${maxRetries * 2}s`);
}

describe('EIP-7702 delegation lifecycle (live)', () => {

    test('account funded', async () => {
        const balance = await ak.sendJsonRpcRequest(
            jsonRpcNodeProvider, "eth_getBalance",
            [eoaDelegatorAddress, "latest"]
        );
        expect(BigInt(balance)).toBeGreaterThan(0n);
    });

    test('getDelegatedAddress and isDelegatedToThisAccount before delegation', async () => {
        // If account was previously delegated from a prior test run,
        // undelegate it first
        const existingDelegation = await ak.getDelegatedAddress(
            eoaDelegatorAddress, jsonRpcNodeProvider
        );

        if (existingDelegation !== null) {
            // Use the matching account class based on which delegatee
            // the account is currently delegated to
            const v9Default = ak.Simple7702AccountV09.DEFAULT_DELEGATEE_ADDRESS;
            const smartAccount = existingDelegation.toLowerCase() === v9Default.toLowerCase()
                ? new ak.Simple7702AccountV09(eoaDelegatorAddress)
                : new ak.Simple7702Account(eoaDelegatorAddress, {
                    delegateeAddress: existingDelegation,
                });
            const rawTx = await smartAccount.createRevokeDelegationTransaction(
                eoaDelegatorPrivateKey,
                jsonRpcNodeProvider,
            );
            const txHash = await ak.sendJsonRpcRequest(
                jsonRpcNodeProvider, "eth_sendRawTransaction", [rawTx]
            );
            await waitForReceipt(txHash);
        }

        const address = await ak.getDelegatedAddress(
            eoaDelegatorAddress, jsonRpcNodeProvider
        );
        expect(address).toBeNull();

        const smartAccount = new ak.Simple7702Account(eoaDelegatorAddress);
        const isDelegatedToThisAccount = await smartAccount.isDelegatedToThisAccount(jsonRpcNodeProvider);
        expect(isDelegatedToThisAccount).toBe(false);
    });

    test('delegate via sponsored UserOp and verify', async () => {
        const smartAccount = new ak.Simple7702Account(eoaDelegatorAddress);
        const paymaster = new ak.CandidePaymaster(paymasterRPC);

        // Mint NFT to verify execution works
        const nftContractAddress = "0x9a7af758aE5d7B6aAE84fe4C5Ba67c041dFE5336";
        const mintFunctionSelector = ak.getFunctionSelector('mint(address)');
        const mintCallData = ak.createCallData(
            mintFunctionSelector,
            ["address"],
            [smartAccount.accountAddress]
        );

        let userOperation = await smartAccount.createUserOperation(
            [{ to: nftContractAddress, value: 0n, data: mintCallData }],
            jsonRpcNodeProvider,
            bundlerUrl,
            { eip7702Auth: { chainId: BigInt(chainId) } }
        );

        // First UserOp should include eip7702Auth
        expect(userOperation.eip7702Auth).not.toBeNull();
        expect(userOperation.factory).toBe('0x7702');

        // Sign delegation authorization
        userOperation.eip7702Auth = ak.createAndSignEip7702DelegationAuthorization(
            BigInt(userOperation.eip7702Auth.chainId),
            userOperation.eip7702Auth.address,
            BigInt(userOperation.eip7702Auth.nonce),
            eoaDelegatorPrivateKey
        );

        // Sponsor gas
        const [sponsoredOp] = await paymaster.createSponsorPaymasterUserOperation(
            smartAccount,
            userOperation,
            bundlerUrl
        );
        userOperation = sponsoredOp;

        // Sign UserOp
        userOperation.signature = smartAccount.signUserOperation(
            userOperation, eoaDelegatorPrivateKey, chainId
        );

        const response = await smartAccount.sendUserOperation(
            userOperation, bundlerUrl
        );
        const receipt = await response.included();
        expect(receipt.success).toBe(true);

        // Verify delegation
        const delegatedAddress = await ak.getDelegatedAddress(
            eoaDelegatorAddress, jsonRpcNodeProvider
        );
        expect(delegatedAddress).not.toBeNull();

        const isDelegatedToThisAccount = await smartAccount.isDelegatedToThisAccount(jsonRpcNodeProvider);
        expect(isDelegatedToThisAccount).toBe(true);
    });

    test('auto-check skips eip7702Auth on second UserOp', async () => {
        const smartAccount = new ak.Simple7702Account(eoaDelegatorAddress);
        const paymaster = new ak.CandidePaymaster(paymasterRPC);

        const nftContractAddress = "0x9a7af758aE5d7B6aAE84fe4C5Ba67c041dFE5336";
        const mintFunctionSelector = ak.getFunctionSelector('mint(address)');
        const mintCallData = ak.createCallData(
            mintFunctionSelector,
            ["address"],
            [smartAccount.accountAddress]
        );

        // Pass eip7702Auth again — auto-check should skip it
        let userOperation = await smartAccount.createUserOperation(
            [{ to: nftContractAddress, value: 0n, data: mintCallData }],
            jsonRpcNodeProvider,
            bundlerUrl,
            { eip7702Auth: { chainId: BigInt(chainId) } }
        );

        // Auto-check should have detected existing delegation and skipped
        expect(userOperation.eip7702Auth).toBeNull();
        expect(userOperation.factory).toBeNull();

        // Sponsor gas
        const [sponsoredOp] = await paymaster.createSponsorPaymasterUserOperation(
            smartAccount,
            userOperation,
            bundlerUrl
        );
        userOperation = sponsoredOp;

        // Sign and send
        userOperation.signature = smartAccount.signUserOperation(
            userOperation, eoaDelegatorPrivateKey, chainId
        );

        const response = await smartAccount.sendUserOperation(
            userOperation, bundlerUrl
        );
        const receipt = await response.included();
        expect(receipt.success).toBe(true);
    });

    test('undelegate and verify', async () => {
        const smartAccount = new ak.Simple7702Account(eoaDelegatorAddress);

        const rawTx = await smartAccount.createRevokeDelegationTransaction(
            eoaDelegatorPrivateKey,
            jsonRpcNodeProvider,
        );

        expect(rawTx.startsWith('0x04')).toBe(true);

        // Broadcast
        const txHash = await ak.sendJsonRpcRequest(
            jsonRpcNodeProvider, "eth_sendRawTransaction", [rawTx]
        );
        expect(txHash).toBeDefined();

        // Wait for tx to be mined
        await waitForReceipt(txHash);

        // Verify undelegation
        const address = await ak.getDelegatedAddress(
            eoaDelegatorAddress, jsonRpcNodeProvider
        );
        expect(address).toBeNull();

        const isDelegatedToThisAccount = await smartAccount.isDelegatedToThisAccount(jsonRpcNodeProvider);
        expect(isDelegatedToThisAccount).toBe(false);
    });

    test('revoke throws when not delegated', async () => {
        const smartAccount = new ak.Simple7702Account(eoaDelegatorAddress);

        await expect(
            smartAccount.createRevokeDelegationTransaction(
                eoaDelegatorPrivateKey,
                jsonRpcNodeProvider,
            )
        ).rejects.toThrow('not delegated');
    });
});

describe('EIP-7702 delegation lifecycle V09 (live)', () => {

    test('fresh state — not delegated', async () => {
        const address = await ak.getDelegatedAddress(
            eoaDelegatorAddress, jsonRpcNodeProvider
        );
        expect(address).toBeNull();

        const smartAccount = new ak.Simple7702AccountV09(eoaDelegatorAddress);
        const isDelegatedToThisAccount = await smartAccount.isDelegatedToThisAccount(jsonRpcNodeProvider);
        expect(isDelegatedToThisAccount).toBe(false);
    });

    test('delegate via UserOp and verify', async () => {
        const smartAccount = new ak.Simple7702AccountV09(eoaDelegatorAddress);

        const nftContractAddress = "0x9a7af758aE5d7B6aAE84fe4C5Ba67c041dFE5336";
        const mintFunctionSelector = ak.getFunctionSelector('mint(address)');
        const mintCallData = ak.createCallData(
            mintFunctionSelector,
            ["address"],
            [smartAccount.accountAddress]
        );

        let userOperation = await smartAccount.createUserOperation(
            [{ to: nftContractAddress, value: 0n, data: mintCallData }],
            jsonRpcNodeProvider,
            bundlerUrl,
            { eip7702Auth: { chainId } }
        );

        expect(userOperation.eip7702Auth).not.toBeNull();
        expect(userOperation.factory).toBe('0x7702');

        userOperation.eip7702Auth = ak.createAndSignEip7702DelegationAuthorization(
            BigInt(userOperation.eip7702Auth.chainId),
            userOperation.eip7702Auth.address,
            BigInt(userOperation.eip7702Auth.nonce),
            eoaDelegatorPrivateKey
        );

        userOperation.signature = smartAccount.signUserOperation(
            userOperation, eoaDelegatorPrivateKey, chainId
        );

        const response = await smartAccount.sendUserOperation(
            userOperation, bundlerUrl
        );
        const receipt = await response.included();
        expect(receipt.success).toBe(true);

        const delegatedAddress = await ak.getDelegatedAddress(
            eoaDelegatorAddress, jsonRpcNodeProvider
        );
        expect(delegatedAddress).not.toBeNull();

        const isDelegatedToThisAccount = await smartAccount.isDelegatedToThisAccount(jsonRpcNodeProvider);
        expect(isDelegatedToThisAccount).toBe(true);
    });

    test('auto-check skips eip7702Auth on second UserOp', async () => {
        const smartAccount = new ak.Simple7702AccountV09(eoaDelegatorAddress);

        const nftContractAddress = "0x9a7af758aE5d7B6aAE84fe4C5Ba67c041dFE5336";
        const mintFunctionSelector = ak.getFunctionSelector('mint(address)');
        const mintCallData = ak.createCallData(
            mintFunctionSelector,
            ["address"],
            [smartAccount.accountAddress]
        );

        let userOperation = await smartAccount.createUserOperation(
            [{ to: nftContractAddress, value: 0n, data: mintCallData }],
            jsonRpcNodeProvider,
            bundlerUrl,
            { eip7702Auth: { chainId } }
        );

        expect(userOperation.eip7702Auth).toBeNull();
        expect(userOperation.factory).toBeNull();

        userOperation.signature = smartAccount.signUserOperation(
            userOperation, eoaDelegatorPrivateKey, chainId
        );

        const response = await smartAccount.sendUserOperation(
            userOperation, bundlerUrl
        );
        const receipt = await response.included();
        expect(receipt.success).toBe(true);
    });

    test('revoke delegation and verify', async () => {
        const smartAccount = new ak.Simple7702AccountV09(eoaDelegatorAddress);

        const rawTx = await smartAccount.createRevokeDelegationTransaction(
            eoaDelegatorPrivateKey,
            jsonRpcNodeProvider,
        );

        expect(rawTx.startsWith('0x04')).toBe(true);

        const txHash = await ak.sendJsonRpcRequest(
            jsonRpcNodeProvider, "eth_sendRawTransaction", [rawTx]
        );
        expect(txHash).toBeDefined();

        await waitForReceipt(txHash);

        const address = await ak.getDelegatedAddress(
            eoaDelegatorAddress, jsonRpcNodeProvider
        );
        expect(address).toBeNull();

        const isDelegatedToThisAccount = await smartAccount.isDelegatedToThisAccount(jsonRpcNodeProvider);
        expect(isDelegatedToThisAccount).toBe(false);
    });
});
