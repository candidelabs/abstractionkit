const ak = require('../../dist/index.umd');
require('dotenv').config();

jest.setTimeout(300000);

let chainId;
const providerRpc = process.env.JSON_RPC_NODE_PROVIDER;
const bundlerRpc = process.env.BUNDLER_URL;
const eoaPrivateKey = process.env.PRIVATE_KEY1;
const eoaAddress = process.env.PUBLIC_ADDRESS1;

describe('Calibur7702Account on Sepolia', () => {

    beforeAll(() => {
        if (!process.env.CHAIN_ID || !providerRpc || !bundlerRpc || !eoaPrivateKey || !eoaAddress) {
            throw new Error(
                'Missing required env vars: CHAIN_ID, JSON_RPC_NODE_PROVIDER, BUNDLER_URL, PRIVATE_KEY1, PUBLIC_ADDRESS1'
            );
        }
        chainId = BigInt(process.env.CHAIN_ID);
    });

    test('send 0-value transfer via Calibur 7702 account', async () => {
        // 1. Create Calibur account for our EOA
        const account = new ak.Calibur7702Account(eoaAddress);
        expect(account.accountAddress).toBe(eoaAddress);

        // 2. Create the UserOperation (with EIP-7702 auth for first-time delegation)
        const userOperation = await account.createUserOperation(
            [{ to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', value: 0n, data: '0x' }],
            providerRpc,
            bundlerRpc,
            {
                eip7702Auth: {
                    chainId: chainId,
                },
            },
        );

        expect(userOperation.sender).toBe(account.accountAddress);
        expect(userOperation.eip7702Auth).not.toBeNull();
        expect(userOperation.callGasLimit).toBeGreaterThan(0n);
        expect(userOperation.verificationGasLimit).toBeGreaterThan(0n);
        expect(userOperation.preVerificationGas).toBeGreaterThan(0n);

        // 3. Sign the EIP-7702 delegation authorization
        userOperation.eip7702Auth = ak.createAndSignEip7702DelegationAuthorization(
            BigInt(userOperation.eip7702Auth.chainId),
            userOperation.eip7702Auth.address,
            BigInt(userOperation.eip7702Auth.nonce),
            eoaPrivateKey,
        );

        // 4. Sign the UserOperation
        userOperation.signature = account.signUserOperation(
            userOperation,
            eoaPrivateKey,
            chainId,
        );

        // 5. Send and wait for inclusion
        const sendResponse = await account.sendUserOperation(
            userOperation,
            bundlerRpc,
        );

        const receipt = await sendResponse.included();
        console.log('UserOp hash:', receipt.userOpHash);
        console.log('Tx hash:', receipt.receipt.transactionHash);
        console.log('Success:', receipt.success);

        expect(receipt).not.toBeNull();
        expect(receipt.success).toBe(true);
    });
});
