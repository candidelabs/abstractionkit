<!-- PROJECT LOGO -->

<div align="center">
  <h1 align="center">Create Account and send a Gasless Transaction - AbstractionKit - Account Abstraction SDK by Candide</h2>
</div>
A paymaster sponsor the complete transaction fee on behaf of the account.

<div align="center">
<img src="https://user-images.githubusercontent.com/7014833/203773780-04a0c8c0-93a6-43a4-bb75-570cb951dfa0.png" height =200>
</div>

# About

Deploy a Candide smart account and send a transaction using a paymaster. A paymaster sponsor the complete transaction fee on behaf of the account.

This example is on the Goerli chain.

In this example you will need an API key for the paymaster. Visit our discord to get one https://discord.gg/KJSzy2Rqtg

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
