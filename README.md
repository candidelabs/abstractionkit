<!-- PROJECT LOGO -->
<div align="center">
<img src="https://github.com/candidelabs/abstractionkit/assets/7014833/6af73235-3f6b-4cb1-8a57-6b04ba2bf327">
</div>

<div align="center">
  <h3 align="center">Supported by Safe Grants</h3>
</div>

A Typescript Library to easily build and send ERC-4337 UserOperations, with first class support for Safe Accounts.

Abstraction Kit is agnostic of:
- Ethereum **interface libraries**: ethers, web3.js, viem/wagmi
- **Bundler** implentation: Plug and play from any bundler provider
- **Paymaster**: use any 3rd party paymaster to sponsor gas, or build your own
- **Accounts**: Safe Account are supported, but you can use use Bundlers and Paymasters with your own accounts

## Docs

For full detailed documentation visit our [docs page](https://docs.candide.dev/wallet/abstractionkit/introduction). 

## Installation

```bash
npm install abstractionkit
```

## Quickstart

### Smart Accounts

Abstraction Kit currently features the Candide Account, a compliant EIP-4337 smart contract account based on Safe v1.4.0 contracts.

In the next releases, it will feature Safe Accounts with the new architecture of Safe{Core}Protocol. 
```typescript
import { CandideAccount } from "abstractionkit";

const smartAccount = new CandideAccount();
```
Then you can consume accout methods:
```typescript
import { Wallet } from "ethers";

const eoaSigner = new Wallet(privateKey);
const [newAccountAddress, initCode] = smartAccount.createNewAccount([
  eoaSigner.address,
]);
```

### Bundler

Initialize a Bundler with your desired bundler RPC url 
```typescript
import { Bundler } from "abstractionkit";

const bundlerRPC = "https://sepolia.voltaire.candidewallet.com/rpc";
const entrypointAddress = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";

const bundler: Bundler = new Bundler(bundlerRPC, entrypointAddress);
```
Then you can consume Bundler methods:

```typescript
const entrypointAddresses = await bundler.supportedEntryPoints();
```

### Paymaster
Initialize a Paymaster with your RPC url
```typescript
import { CandideValidationPaymaster } from "abstractionkit";

const paymasterRpc = "https://api.candide.dev/paymaster/v1/$network/$apikey";
const entrypointAddress = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";

const paymaster: CandideValidationPaymaster = new CandideValidationPaymaster(
  entrypointAddress,
  paymasterRPC
);
```
Then you can consume Paymaster methods:

```typescript
const supportedGasTokens = await paymaster.getSupportedERC20Tokens();
```

## Guides
| Title | Description
| -----------------------------------------------------------------------------------------| -------------------------------------------------------------------------------- |
| [Send your first user operation](https://docs.candide.dev/wallet/guides/getting-started) | Learn how to create a smart wallet and to send your first user operation         |
| [Send a Gasless Transaction](https://docs.candide.dev/wallet/guides/send-gasless-tx)     | Learn how to send gasless transactions using a paymaster                         |
| [Pay Gas in ERC-20](https://docs.candide.dev/wallet/guides/pay-gas-in-erc20)             | Learn how to offer the ability for users to pay gas in ERC-20s using a Paymaster |

## npm package
<a href="https://www.npmjs.com/package/abstractionkit">npm</a>

<!-- LICENSE -->
## License

MIT
