const accountAbstractionkit = require('../dist/index.umd');
const ak = accountAbstractionkit;
const ethers = require('ethers');
require('dotenv').config()

jest.setTimeout(3000);

const eoaWallet = ethers.Wallet.createRandom();
const eoaPrivateKey = eoaWallet.privateKey;

describe('eip7702', () => {
    test('creates valid delegation authorization and signed transaction' , async() => {
        const chainId = 11155111;
        const nonce = "0x0";

        const delegation = accountAbstractionkit.createAndSignEip7702DelegationAuthorization(
            chainId,
            "0xB52D62510cdcEBfedEd46aF5E99dC50DD352F25F", //delegation destination
            // if the delegator will be the transaction sender, increase the authorization nonce by one
            BigInt(nonce)+1n,
            eoaPrivateKey
        );

        expect(delegation).toBeDefined();
        expect(delegation.address).toBeDefined();

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

        expect(tx).toBeDefined();
        expect(tx).toMatch(/^0x04/); // EIP-7702 tx prefix
    });
})
