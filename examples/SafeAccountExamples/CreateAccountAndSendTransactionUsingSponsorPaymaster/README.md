<!-- PROJECT LOGO -->

<div align="center">
  <h1 align="center">CreateAccountAndSendTransactionUsingPaymaster Example - AbstractionKit - Account Abstraction SDK by Candide</h2>
</div>

<div align="center">
<img src="https://github.com/candidelabs/abstractionkit/assets/7014833/6af73235-3f6b-4cb1-8a57-6b04ba2bf327">
</div>

# About
This example is on Sepolia testnet.

This example uses a Candide paymaster to sponsor the useroperation, so there is not need to fund the sender account. Get early access to Candide's sponsor paymaster by visiting our discord https://discord.gg/KJSzy2Rqtg

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
