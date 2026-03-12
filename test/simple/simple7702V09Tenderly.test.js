const ak = require('../../dist/index.umd');
require('dotenv').config();

jest.setTimeout(300000);

const ENTRYPOINT_V9 = "0x433709009B8330FDa32311DF1C2AFA402eD8D009";

const chainId = process.env.CHAIN_ID;
const ownerPublicAddress = process.env.PUBLIC_ADDRESS1;
const ownerPrivateKey = process.env.PRIVATE_KEY1;
const jsonRpcNodeProvider = process.env.JSON_RPC_NODE_PROVIDER;
const bundlerUrl = process.env.BUNDLER_URL;
const tenderlyAccountSlug = process.env.TENDERLY_ACCOUNT_SLUG;
const tenderlyProjectSlug = process.env.TENDERLY_PROJECT_SLUG;
const tenderlyAccessKey = process.env.TENDERLY_ACCESS_KEY;

const nftContractAddress = "0x9a7af758aE5d7B6aAE84fe4C5Ba67c041dFE5336";

describe('Simple7702AccountV09 Tenderly live simulation', () => {
    let smartAccount;
    let userOperation;

    beforeAll(async () => {
        smartAccount = new ak.Simple7702AccountV09(ownerPublicAddress);

        const mintFunctionSelector = ak.getFunctionSelector('mint(address)');
        const mintCallData = ak.createCallData(
            mintFunctionSelector,
            ["address"],
            [smartAccount.accountAddress],
        );

        userOperation = await smartAccount.createUserOperation(
            [
                {
                    to: nftContractAddress,
                    value: 0n,
                    data: mintCallData,
                },
            ],
            jsonRpcNodeProvider,
            bundlerUrl,
            {
                eip7702Auth: {
                    chainId: BigInt(chainId),
                },
            },
        );

        userOperation.eip7702Auth = ak.createAndSignEip7702DelegationAuthorization(
            BigInt(userOperation.eip7702Auth.chainId),
            userOperation.eip7702Auth.address,
            BigInt(userOperation.eip7702Auth.nonce),
            ownerPrivateKey,
        );

        userOperation.signature = smartAccount.signUserOperation(
            userOperation,
            ownerPrivateKey,
            chainId,
        );
    });

    test('simulateUserOperationWithTenderlyAndCreateShareLink - V9', async () => {
        const result = await ak.simulateUserOperationWithTenderlyAndCreateShareLink(
            tenderlyAccountSlug,
            tenderlyProjectSlug,
            tenderlyAccessKey,
            BigInt(chainId),
            ENTRYPOINT_V9,
            userOperation,
        );

        console.log("handleOps simulation link:", result.simulationShareLink);

        expect(result.simulation).toBeDefined();
        expect(result.simulation.simulation).toBeDefined();
        expect(result.simulation.simulation.id).toBeTruthy();
        expect(result.simulationShareLink).toContain(
            'https://dashboard.tenderly.co/shared/simulation/'
        );
    });

    test('simulateUserOperationCallDataWithTenderlyAndCreateShareLink - V9', async () => {
        const result = await ak.simulateUserOperationCallDataWithTenderlyAndCreateShareLink(
            tenderlyAccountSlug,
            tenderlyProjectSlug,
            tenderlyAccessKey,
            BigInt(chainId),
            ENTRYPOINT_V9,
            userOperation,
        );

        console.log("callData simulation link:", result.callDataSimulationShareLink);
        if (result.accountDeploymentSimulationShareLink) {
            console.log("deployment simulation link:", result.accountDeploymentSimulationShareLink);
        }

        expect(result.simulation).toBeDefined();
        expect(result.callDataSimulationShareLink).toContain(
            'https://dashboard.tenderly.co/shared/simulation/'
        );
    });

    test('simulateUserOperationWithTenderly - V9 (no share link)', async () => {
        const result = await ak.simulateUserOperationWithTenderly(
            tenderlyAccountSlug,
            tenderlyProjectSlug,
            tenderlyAccessKey,
            BigInt(chainId),
            ENTRYPOINT_V9,
            userOperation,
        );

        expect(result.simulation).toBeDefined();
        expect(result.simulation.id).toBeTruthy();
        expect(result.simulation.status).toBeDefined();
    });

    test('simulateUserOperationCallDataWithTenderly - V9 (no share link)', async () => {
        const result = await ak.simulateUserOperationCallDataWithTenderly(
            tenderlyAccountSlug,
            tenderlyProjectSlug,
            tenderlyAccessKey,
            BigInt(chainId),
            ENTRYPOINT_V9,
            userOperation,
        );

        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBeGreaterThanOrEqual(1);
        expect(result[0].simulation).toBeDefined();
        expect(result[0].simulation.id).toBeTruthy();
    });

    test('simulateUserOperationCallDataWithTenderly handles factory:0x7702 sentinel', async () => {
        // EIP-7702 userOps have factory:"0x7702" + factoryData:null.
        // The simulation should normalize this to null and not throw.
        const result = await ak.simulateUserOperationCallDataWithTenderly(
            tenderlyAccountSlug,
            tenderlyProjectSlug,
            tenderlyAccessKey,
            BigInt(chainId),
            ENTRYPOINT_V9,
            userOperation, // has factory:"0x7702", factoryData:null
        );

        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(1); // no deployment sim since factory is normalized to null
        expect(result[0].simulation.id).toBeTruthy();
    });
});

describe('Simple7702AccountV09 Tenderly live simulation with AllowAllPaymaster', () => {
    let smartAccount;
    let userOperation;

    beforeAll(async () => {
        smartAccount = new ak.Simple7702AccountV09(ownerPublicAddress);
        const paymaster = new ak.AllowAllPaymaster();

        const paymasterInitFields = await paymaster.getPaymasterFieldsInitValues(
            BigInt(chainId),
        );

        const mintFunctionSelector = ak.getFunctionSelector('mint(address)');
        const mintCallData = ak.createCallData(
            mintFunctionSelector,
            ["address"],
            [smartAccount.accountAddress],
        );

        userOperation = await smartAccount.createUserOperation(
            [
                {
                    to: nftContractAddress,
                    value: 0n,
                    data: mintCallData,
                },
            ],
            jsonRpcNodeProvider,
            bundlerUrl,
            {
                eip7702Auth: {
                    chainId: BigInt(chainId),
                },
            },
        );

        // Set paymaster init fields (short magic data for gas estimation)
        userOperation.paymaster = paymasterInitFields.paymaster;
        userOperation.paymasterVerificationGasLimit = paymasterInitFields.paymasterVerificationGasLimit;
        userOperation.paymasterPostOpGasLimit = paymasterInitFields.paymasterPostOpGasLimit;
        userOperation.paymasterData = paymasterInitFields.paymasterData;

        // Re-estimate gas with paymaster fields set
        const [preVerificationGas, verificationGasLimit, callGasLimit] =
            await smartAccount.estimateUserOperationGas(
                userOperation,
                bundlerUrl,
            );
        userOperation.preVerificationGas = preVerificationGas;
        userOperation.verificationGasLimit = verificationGasLimit + 55000n;
        userOperation.callGasLimit = callGasLimit;

        userOperation.eip7702Auth = ak.createAndSignEip7702DelegationAuthorization(
            BigInt(userOperation.eip7702Auth.chainId),
            userOperation.eip7702Auth.address,
            BigInt(userOperation.eip7702Auth.nonce),
            ownerPrivateKey,
        );

        // Sign BEFORE setting approved paymaster data.
        // V9 paymasterDataKeccakV9 truncates at the PAYMASTER_SIG_MAGIC boundary,
        // so the hash is the same whether we use init or approved paymasterData.
        userOperation.signature = smartAccount.signUserOperation(
            userOperation,
            ownerPrivateKey,
            chainId,
        );

        // Set approved paymaster data AFTER signing
        userOperation.paymasterData = await paymaster.getApprovedPaymasterData(userOperation);
    });

    test('simulateUserOperationWithTenderlyAndCreateShareLink - V9 with paymaster', async () => {
        const result = await ak.simulateUserOperationWithTenderlyAndCreateShareLink(
            tenderlyAccountSlug,
            tenderlyProjectSlug,
            tenderlyAccessKey,
            BigInt(chainId),
            ENTRYPOINT_V9,
            userOperation,
        );

        console.log("handleOps with paymaster simulation link:", result.simulationShareLink);

        expect(result.simulation).toBeDefined();
        expect(result.simulation.simulation).toBeDefined();
        expect(result.simulation.simulation.id).toBeTruthy();
        expect(result.simulationShareLink).toContain(
            'https://dashboard.tenderly.co/shared/simulation/'
        );
    });

    test('simulateUserOperationCallDataWithTenderlyAndCreateShareLink - V9 with paymaster', async () => {
        const result = await ak.simulateUserOperationCallDataWithTenderlyAndCreateShareLink(
            tenderlyAccountSlug,
            tenderlyProjectSlug,
            tenderlyAccessKey,
            BigInt(chainId),
            ENTRYPOINT_V9,
            userOperation,
        );

        console.log("callData with paymaster simulation link:", result.callDataSimulationShareLink);

        expect(result.simulation).toBeDefined();
        expect(result.callDataSimulationShareLink).toContain(
            'https://dashboard.tenderly.co/shared/simulation/'
        );
    });
});
