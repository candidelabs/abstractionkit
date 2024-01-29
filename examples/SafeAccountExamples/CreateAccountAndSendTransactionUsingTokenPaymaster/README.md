<!-- PROJECT LOGO -->

<div align="center">
  <h1 align="center">CreateAccountAndSendTransactionUsingPaymaster Example - AbstractionKit - Account Abstraction SDK by Candide</h2>
</div>

<div align="center">
<img src="https://user-images.githubusercontent.com/7014833/203773780-04a0c8c0-93a6-43a4-bb75-570cb951dfa0.png" height =200>
</div>

# About

CreateAccountAndSendTransactionUsingPaymaster Example - AbstractionKit - Account Abstraction SDK by Candide

This example is in the Sepolia chain.

In this example you will need fund the new account address(sender) with some CTT to pay for gas. Please visit our discord to get some test tokens https://discord.gg/KJSzy2Rqtg.Please visit https://dashboard.candide.dev/ to get a token paymaster url.

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
