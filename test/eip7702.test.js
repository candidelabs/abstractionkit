const accountAbstractionkit = require('../dist/index.umd');
const ak = require('abstractionkit');
const ethers = require('ethers');
require('dotenv').config()

jest.setTimeout(3000);

const eoaPrivateKey=process.env.PRIVATE_KEY1

describe('eip7702', () => {
    test('test1' , async() => {
        const chainId = 7078815900;
        const nodeRpc = "https://rpc.mekong.ethpandaops.io";
        const eoaWallet = new ethers.Wallet(eoaPrivateKey);

        const nonce = await ak.sendJsonRpcRequest(
            nodeRpc,
            "eth_getTransactionCount",
            [eoaWallet.address, "latest"]
        );
            
        const delegation = accountAbstractionkit.createAndSignEip7702DelegationAuthorization(
            chainId,
            "0xB52D62510cdcEBfedEd46aF5E99dC50DD352F25F", //delegation destination
            // if the delegator will be the transaction sender, increase the authorization nonce by one
            BigInt(nonce)+1n, 
            eoaPrivateKey
        );
        
        const tx = accountAbstractionkit.createAndSignEip7702RawTransaction(
            chainId,
            nonce,
            0xf078996n, // max priority fee per gas
            0xf078996n, //max fee per gas
            0x210000n, //max priority
            "0x0000000000000000000000000000000000000000",//destination
            0n,//value
            "0x",//data
            [], //access list
            [delegation], //authorization list
            eoaPrivateKey
        );
        const res = await ak.sendJsonRpcRequest(
            nodeRpc,
            "eth_sendRawTransaction",
            [tx]
        );
    });
})
