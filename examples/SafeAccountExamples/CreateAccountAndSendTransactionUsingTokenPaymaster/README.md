<!-- PROJECT LOGO -->

<div align="center">
  <h1 align="center">CreateAccountAndSendTransactionUsingPaymaster Example - AbstractionKit - Account Abstraction SDK by Candide</h2>
</div>

<div align="center">
<img src="https://github.com/candidelabs/abstractionkit/assets/7014833/6af73235-3f6b-4cb1-8a57-6b04ba2bf327">
</div>

# About

This example is on Sepolia testnet.

In this example you will need fund the new account address(sender) with some CTT to pay for gas.

Get a paymaster API key on our [dashboard](https://dashboard.candide.dev/).

Get test tokens by pinging us on Discord.

# How to use this example

### copy .env.example and add the paymaster values and a privatekey for signer
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
