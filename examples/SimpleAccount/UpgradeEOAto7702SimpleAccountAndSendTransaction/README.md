<!-- PROJECT LOGO -->

<div align="center">
  <h1 align="center">Upgrade EOA to an EIP-7702 SimpleAccount using ERC-4337 User Operation</h2>
</div>

<div align="center">
<img src="https://github.com/candidelabs/abstractionkit/assets/7014833/6af73235-3f6b-4cb1-8a57-6b04ba2bf327">
</div>

# About

This examples demonstrate how to upgrade an EOA to a Smart Account with EIP-7702 and ERC-4337 User Operation. The scripts upgrades and batch mints 2 NFTs in a single user operation.

### Smart Account Contracts

[Simple7702Account.sol](https://github.com/eth-infinitism/account-abstraction/blob/develop/contracts/accounts/Simple7702Account.sol) is a fully audited minimalist smart contract account that can be safely authorized by any EOA. It adds full support for major smart account features like batching and gas sponsorship.

> [!NOTE]
This example runs on Sepolia, a testnet that supports EIP-7702 throught the Pectra upgrade. You will need to fund the EOA Account with sepETH first as no paymaster is used in this example. 


# How to use this example

### copy .env.example and add a privatekey for signer
```
cp .env.example .env
```

### install dependencies, build and run
```
yarn install
yarn build
node dist/index.js  
```

<!-- LICENSE -->
## License

MIT
