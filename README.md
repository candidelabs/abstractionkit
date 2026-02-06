<!-- PROJECT LOGO -->
<div align="center">
<img src="https://github.com/user-attachments/assets/ad202256-d3c2-40d3-ac70-c458f9ab0c1c">
</div>

A Typescript Library to easily build standard Ethereum Smart Wallets, with first class support for Safe Accounts.

AbstractionKit is agnostic of:
- **Ethereum interface libraries**: ethers, web3.js, viem/wagmi
- **Bundlers**: Plug and play a Bundler URL from any provider, or self-host your own
- **Paymasters**: Candide Paymaster is supported, but you can use any 3rd party paymaster to sponsor gas
- **Accounts**: The Safe Account is first class supported, but you can use Bundlers and Paymasters with any account

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

### Which version to use?

| Class | EntryPoint | When to use |
|---|---|---|
| `SafeAccountV0_3_0` | v0.7 | Recommended for new projects |
| `SafeAccountV0_2_0` | v0.6 | Legacy support |

### Safe Account

AbstractionKit features the Safe Account. It uses the original Safe Singleton and adds ERC-4337 functionality using a fallback handler module. The contracts have been developed by the Safe Team. It has been audited by Ackee Blockchain. To learn more about the contracts and audits, visit [safe-global/safe-modules](https://github.com/safe-global/safe-modules/tree/main/modules/4337).


```typescript
import { SafeAccountV0_3_0 as SafeAccount } from "abstractionkit";

const ownerPublicAddress = "0xBdbc5FBC9cA8C3F514D073eC3de840Ac84FC6D31";
const smartAccount = SafeAccount.initializeNewAccount([ownerPublicAddress]);

```
Then you can consume account methods:
```typescript
const safeAddress = smartAccount.accountAddress;
```

### Bundler

Initialize a Bundler with a bundler RPC url. Get an API key from the [dashboard](https://dashboard.candide.dev), or use the public endpoint (no key required).
```typescript
import { Bundler } from "abstractionkit";

// Authenticated (get YOUR_API_KEY from https://dashboard.candide.dev)
const bundlerRpc = "https://api.candide.dev/api/v3/11155111/YOUR_API_KEY";

// Or public (no key required)
// const bundlerRpc = "https://api.candide.dev/public/v3/11155111";

const bundler = new Bundler(bundlerRpc);
```
Then you can consume Bundler methods:

```typescript
const entrypointAddresses = await bundler.supportedEntryPoints();
```

### Paymaster
Initialize a Candide Paymaster with your RPC url. Get an API key from the [dashboard](https://dashboard.candide.dev).
```typescript
import { CandidePaymaster } from "abstractionkit";

// Authenticated
const paymasterRpc = "https://api.candide.dev/api/v3/11155111/YOUR_API_KEY";

// Or public (no key required)
// const paymasterRpc = "https://api.candide.dev/public/v3/11155111";

const paymaster = new CandidePaymaster(paymasterRpc);
```
Then you can consume Paymaster methods:

```typescript
const supportedERC20TokensAndPaymasterMetadata = await paymaster.fetchSupportedERC20TokensAndPaymasterMetadata();
```

## Recipes

Copy-paste patterns for common tasks. Examples use `SafeAccountV0_3_0` (EntryPoint v0.7). For EntryPoint v0.6, replace with `SafeAccountV0_2_0`.

### Send ETH from a new Safe account

```typescript
import { SafeAccountV0_3_0 } from "abstractionkit";

const ownerPublicAddress = "0xOwner";
const ownerPrivateKey = "0xPrivateKey";
const nodeRpc = "https://rpc.example.com";
const bundlerRpc = "https://bundler.example.com";
const chainId = 11155111n; // Sepolia

// Initialize new account (deploys on first UserOp)
const smartAccount = SafeAccountV0_3_0.initializeNewAccount([ownerPublicAddress]);
console.log("Account address:", smartAccount.accountAddress);
// Fund this address with ETH before sending the first UserOp

// Create UserOp
const userOp = await smartAccount.createUserOperation(
  [{ to: "0xRecipient", value: 1000000000000000n, data: "0x" }], // 0.001 ETH
  nodeRpc,
  bundlerRpc,
);

// Sign
userOp.signature = smartAccount.signUserOperation(userOp, [ownerPrivateKey], chainId);

// Send and wait for receipt
const response = await smartAccount.sendUserOperation(userOp, bundlerRpc);
const receipt = await response.included();
console.log("Tx hash:", receipt?.receipt.transactionHash);
```

### Send an ERC-20 token transfer

```typescript
import { SafeAccountV0_3_0, createCallData, getFunctionSelector } from "abstractionkit";

// Encode ERC-20 transfer(address,uint256)
const transferSelector = getFunctionSelector("transfer(address,uint256)");
const transferCallData = createCallData(
  transferSelector,
  ["address", "uint256"],
  ["0xRecipient", 1000000n], // amount in token's smallest unit
);

const userOp = await smartAccount.createUserOperation(
  [{ to: "0xTokenContractAddress", value: 0n, data: transferCallData }],
  nodeRpc,
  bundlerRpc,
);
```

### Sponsor gas with CandidePaymaster

```typescript
import { SafeAccountV0_3_0, CandidePaymaster } from "abstractionkit";

const paymaster = new CandidePaymaster("https://paymaster.example.com/rpc");

// Create the UserOp first (without paymaster)
const userOp = await smartAccount.createUserOperation(
  [{ to: "0xRecipient", value: 1000000000000000n, data: "0x" }],
  nodeRpc,
  bundlerRpc,
);

// Sponsor it — sets paymaster fields and re-estimates gas
const [sponsoredOp] = await paymaster.createSponsorPaymasterUserOperation(
  userOp,
  bundlerRpc,
);

// Sign and send as usual
sponsoredOp.signature = smartAccount.signUserOperation(sponsoredOp, [ownerPrivateKey], chainId);
const response = await smartAccount.sendUserOperation(sponsoredOp, bundlerRpc);
```

### Pay gas with ERC-20 tokens

```typescript
import { SafeAccountV0_3_0, CandidePaymaster } from "abstractionkit";

const paymaster = new CandidePaymaster("https://paymaster.example.com/rpc");
const gasTokenAddress = "0xERC20TokenAddress"; // must be supported by paymaster

const userOp = await smartAccount.createUserOperation(
  [{ to: "0xRecipient", value: 0n, data: "0x" }],
  nodeRpc,
  bundlerRpc,
);

// Automatically prepends token approval + sets paymaster fields
const tokenOp = await paymaster.createTokenPaymasterUserOperation(
  smartAccount,
  userOp,
  gasTokenAddress,
  bundlerRpc,
);

tokenOp.signature = smartAccount.signUserOperation(tokenOp, [ownerPrivateKey], chainId);
const response = await smartAccount.sendUserOperation(tokenOp, bundlerRpc);
```

### Batch multiple transactions

```typescript
import { SafeAccountV0_3_0, MetaTransaction } from "abstractionkit";

// Pass an array of MetaTransactions — automatically encoded via MultiSend
const transactions: MetaTransaction[] = [
  { to: "0xRecipientA", value: 1000000000000000n, data: "0x" },
  { to: "0xRecipientB", value: 2000000000000000n, data: "0x" },
  { to: "0xTokenContract", value: 0n, data: transferCallData },
];

const userOp = await smartAccount.createUserOperation(
  transactions, // automatically batched via MultiSend when length > 1
  nodeRpc,
  bundlerRpc,
);
```

### Connect to an existing (deployed) account

```typescript
import { SafeAccountV0_3_0 } from "abstractionkit";

// Use the constructor for an already-deployed account
const smartAccount = new SafeAccountV0_3_0("0xYourDeployedSafeAddress");

// vs. initializeNewAccount which sets factory data for first-time deployment
const newAccount = SafeAccountV0_3_0.initializeNewAccount(["0xOwnerAddress"]);
// newAccount.accountAddress is the counterfactual address
// First UserOp will deploy it automatically
```

### Common error codes and solutions

| Error Code | Meaning | Fix |
|---|---|---|
| `AA10` | Sender already constructed (initCode not needed) | Use `new SafeAccountV0_3_0(address)` instead of `initializeNewAccount` for deployed accounts |
| `AA21` | Didn't pay prefund | Fund the sender address with enough ETH to cover gas, or use a paymaster |
| `AA25` | Nonce mismatch | Don't override nonce, or fetch latest via `fetchAccountNonce()` |
| `AA40` | Paymaster deposit too low | Contact paymaster provider or use a different paymaster |
| `AA41` | Paymaster `postOp` reverted | Check paymaster-specific requirements (token balance, approval amount) |

## Guides
| Title | Description |
| -----------------------------------------------------------------------------------------| -------------------------------------------------------------------------------- |
| [Send your first user operation](https://docs.candide.dev/wallet/guides/getting-started) | Learn how to create a smart wallet and to send your first user operation         |
| [Send a Gasless Transaction](https://docs.candide.dev/wallet/guides/send-gasless-tx)     | Learn how to send gasless transactions using a paymaster                         |
| [Pay Gas in ERC-20](https://docs.candide.dev/wallet/guides/pay-gas-in-erc20)             | Learn how to offer the ability for users to pay gas in ERC-20s using a Paymaster |

## AI Agent Integration

If you use [Claude Code](https://claude.ai/code), you can import this README into your project's CLAUDE.md for better AI assistance:

```markdown
@node_modules/abstractionkit/README.md
```

## npm package
<a href="https://www.npmjs.com/package/abstractionkit">npm</a>

<!-- LICENSE -->
## License

MIT

<!-- ACKNOWLEDGMENTS -->
## Acknowledgments

* <a href='https://eips.ethereum.org/EIPS/eip-4337'>EIP-4337: Account Abstraction via Entry Point Contract specification </a>
* <a href='https://safe.global/'>Safe Accounts, Modules, and SGP</a>
