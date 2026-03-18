const accountAbstractionkit = require('../../dist/index.umd');
const crypto = require('crypto');
const { secp256k1 } = require('@noble/curves/secp256k1');
const { keccak_256 } = require('@noble/hashes/sha3');
const { ANVIL_RPC, ANVIL_CHAIN_ID, BUNDLER_RPC } = require('./anvil-setup');

jest.setTimeout(300000);

const ak = accountAbstractionkit;

// Generate a random owner keypair
const ownerPrivateKeyBytes = crypto.randomBytes(32);
const ownerPrivateKey = "0x" + ownerPrivateKeyBytes.toString("hex");
const pubKey = secp256k1.getPublicKey(ownerPrivateKeyBytes, false).slice(1);
const ownerPublicAddress = "0x" + Buffer.from(keccak_256(pubKey).slice(-20)).toString("hex");

const eoaDelegatorAddress = ownerPublicAddress;
const eoaDelegatorPrivateKey = ownerPrivateKey;

const chainId = ANVIL_CHAIN_ID;
const jsonRpcNodeProvider = ANVIL_RPC;
const bundlerUrl = BUNDLER_RPC;

let bundlerAvailable = false;

beforeAll(async () => {
    try {
        const res = await fetch(bundlerUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                jsonrpc: "2.0",
                method: "eth_chainId",
                params: [],
                id: 1,
            }),
        });
        const data = await res.json();
        bundlerAvailable = !!data.result;
    } catch {
        bundlerAvailable = false;
    }
    if (!bundlerAvailable) {
        console.warn("Voltaire bundler not reachable — skipping simple EIP-7702 tests");
        return;
    }

    // Fund the EOA delegator via anvil_setBalance
    await fetch(ANVIL_RPC, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            jsonrpc: "2.0",
            method: "anvil_setBalance",
            params: [eoaDelegatorAddress, "0x4563918244F40000"], // 5 ETH
            id: 1,
        }),
    });
});

describe('simple account', () => {
    test(
        'account funded',
    async() => {
        

        const balance = await ak.sendJsonRpcRequest(
            jsonRpcNodeProvider, "eth_getBalance", [eoaDelegatorAddress, "latest"]);

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

        const userOperation = await smartAccount.createUserOperation(
            [transaction1, transaction2],
            jsonRpcNodeProvider,
            bundlerUrl,
            {
                eip7702Auth:{
                    chainId:BigInt(chainId)
                },
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

        let sendUserOperationResponse = await smartAccount.sendUserOperation(
            userOperation, bundlerUrl
        )

        let userOperationReceiptResult = await sendUserOperationResponse.included()

        expect(userOperationReceiptResult.success).toBe(true);
    });
});
