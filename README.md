<!-- PROJECT LOGO -->
<div align="center">
<img src="https://github.com/user-attachments/assets/ad202256-d3c2-40d3-ac70-c458f9ab0c1c">
</div>

A Typescript Library to easily build standard Ethereum Smart Wallets, with first class support for Safe Accounts.

AbstractionKit is agnostic of:
- **Ethereum interface libraries**: ethers, web3.js, viem/wagmi
- **Bundlers**: Plug and play a Bundler URL from any provider, or self-host your own
- **Paymasters**: Candide Paymaster is supported , but you can use any 3rd party paymaster to sponsor gas
- **Accounts**: The Safe Account is first class supported, but you can use use Bundlers and Paymasters with any account

## Examples
<a href="https://github.com/candidelabs/abstractionkit-examples">Abstractionkit Example Projects</a>


## Features
### Safe Accounts
- Built on ERC-4337 account abstraction
- Passkeys Authentication for secure, passwordless access
- Social Recovery to regain access easily
- Multisig Support
- Allowance Management for controlled spending limits

### Gas Abstraction with Paymasters
- Full Gas Sponsorship for a seamless user experience
- Support for ERC-20 Tokens as gas payment options

### Bundler Support
- Compatibility with standard ERC-4337 Bundler Methods

### UserOperation Utilities
- A complete toolkit to construct, sign, and send UserOperations, enabling smooth integration

## Docs

For full detailed documentation visit our [docs page](https://docs.candide.dev/wallet/abstractionkit/introduction). 

## Installation

```bash
npm install abstractionkit
```

## Quickstart

### Safe Account

AbstractionKit features the Safe Account. It uses the original Safe Singleton and adds ERC-4337 functionality using a fallback handler module. The contracts have been developed by the Safe Team. It has been audited by Ackee Blockchain. To learn more about the contracts and audits, visit [safe-global/safe-modules](https://github.com/safe-global/safe-modules/tree/main/modules/4337).


```typescript
import { SafeAccountV0_3_0 as SafeAccount } from "abstractionkit";

const ownerPublicAddress = "0xBdbc5FBC9cA8C3F514D073eC3de840Ac84FC6D31";
const smartAccount = SafeAccount.initializeNewAccount([ownerPublicAddress]);

```
Then you can consume accout methods:
```typescript
const safeAddress = smartAccount.accountAddress;
```

### Bundler

Initialize a Bundler with your desired bundler RPC url. Get a bundler endpoint from the [dashboard](https://dashboard.candide.dev)
```typescript
import { Bundler } from "abstractionkit";

const bundlerRPC = "https://api.candide.dev/bundler/version/network/YOUR_API_KEY";

const bundler: Bundler = new Bundler(bundlerRPC);
```
Then you can consume Bundler methods:

```typescript
const entrypointAddresses = await bundler.supportedEntryPoints();
```

### Paymaster
Initialize a Candide Paymaster with your RPC url. Get one from the [dashboard](https://dashboard.candide.dev).
```typescript
import { CandidePaymaster } from "abstractionkit";

const paymasterRpc = "https://api.candide.dev/paymaster/$version/$network/$apikey";

const paymaster: CandidePaymaster = new CandidePaymaster(paymasterRPC);
```
Then you can consume Paymaster methods:

```typescript
const supportedERC20TokensAndPaymasterMetadata = await paymaster.fetchSupportedERC20TokensAndPaymasterMetadata();
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

<!-- ACKNOWLEDGMENTS -->
## Acknowledgments

* <a href='https://eips.ethereum.org/EIPS/eip-4337'>EIP-4337: Account Abstraction via Entry Point Contract specification </a>
* <a href='https://safe.global/'>Safe Accounts, Modules, and SGP</a>
