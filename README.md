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

- **Safe Accounts** with passkey authentication, social recovery, multisig, and allowance management
- **EIP-7702** support via `Calibur7702Account` and `Simple7702Account`
- **Gas abstraction** with sponsored UserOperations and ERC-20 gas payment via `CandidePaymaster`
- **Multichain signatures** via `SafeMultiChainSigAccountV1` (sign once, replay across chains)
- **Bundler client** compatible with standard ERC-4337 methods
- **EntryPoint v0.6, v0.7, v0.8, and v0.9** support with a version-safe account/UserOp mapping

## Docs

For full detailed documentation visit our [docs page](https://docs.candide.dev/wallet/abstractionkit/introduction).

## Installation

Requires Node.js 18 or later.

```bash
npm install abstractionkit
```

### Upgrading to v0.3.0

v0.3.0 is a major release. The following API changes are likely to break existing paymaster code:

- `CandidePaymaster.createSponsorPaymasterUserOperation(...)` now takes `smartAccount` as the **first** argument: `(smartAccount, userOp, bundlerRpc, sponsorshipPolicyId?, context?, overrides?)`.
- `CandidePaymaster.createTokenPaymasterUserOperation(...)` adds a dedicated `context?` argument before `overrides?`: `(smartAccount, userOp, tokenAddress, bundlerRpc, context?, overrides?)`. Callers that previously passed `overrides` positionally at argument 5 must insert `undefined` (or an explicit context) so `overrides` shifts to argument 6.

See [CHANGELOG.md](./CHANGELOG.md) for the full list of new features, renames, type export changes, and fixes.

## Quickstart

### Which account class to use?

| Class | EntryPoint | Account Type | When to use |
|---|---|---|---|
| `SafeAccountV0_3_0` | EP v0.7 | Safe (counterfactual) | Recommended for most new projects |
| `SafeAccountV1_5_0_M_0_3_0` | EP v0.7 | Safe v1.5.0 (counterfactual) | Safe v1.5.0 with EIP-7951 / Daimo P256 verifier for WebAuthn |
| `SafeAccountV0_2_0` | EP v0.6 | Safe (counterfactual) | Legacy support for EntryPoint v0.6 |
| `SafeMultiChainSigAccountV1` | EP v0.9 | Safe multichain | Sign once, replay across chains. |
| `Calibur7702Account` | EP v0.8 | EIP-7702 (Uniswap Calibur) | Upgrade an EOA in place. Supports EOA, P256, and WebAuthn keys |
| `Simple7702Account` | EP v0.8 | EIP-7702 (minimal) | Minimal reference EIP-7702 account |
| `Simple7702AccountV09` | EP v0.9 | EIP-7702 (minimal, parallel paymaster) | EntryPoint v0.9 with parallel paymaster signing |

### Endpoints

Candide hosts both bundler and paymaster under the same base URL. Get an API key from the [dashboard](https://dashboard.candide.dev), or use the public endpoint (rate-limited, no key required).

```typescript
// Authenticated
const rpc = "https://api.candide.dev/api/v3/11155111/YOUR_API_KEY";

// Or public (no key required)
// const rpc = "https://api.candide.dev/public/v3/11155111";
```

## Recipes

Copy paste patterns for common tasks. Examples use `SafeAccountV0_3_0` (EntryPoint v0.7). For EntryPoint v0.6, replace with `SafeAccountV0_2_0`.

### Send ETH from a new Safe account

```typescript
import { SafeAccountV0_3_0 } from "abstractionkit";

const ownerPublicAddress = "0xOwner";
const ownerPrivateKey = "0xPrivateKey";
const nodeRpc = "https://rpc.example.com";
const bundlerRpc = "https://api.candide.dev/api/v3/11155111/YOUR_API_KEY";
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

const paymaster = new CandidePaymaster("https://api.candide.dev/api/v3/11155111/YOUR_API_KEY");

// Create the UserOp first (without paymaster)
const userOp = await smartAccount.createUserOperation(
  [{ to: "0xRecipient", value: 1000000000000000n, data: "0x" }],
  nodeRpc,
  bundlerRpc,
);

// Sponsor it. Sets paymaster fields and re-estimates gas.
// Note: as of v0.3.0, smartAccount is the first argument.
const { userOperation: sponsoredOp, sponsorMetadata } = await paymaster.createSponsorPaymasterUserOperation(
  smartAccount,
  userOp,
  bundlerRpc,
  sponsorshipPolicyId,
  // context (optional — e.g. { signingPhase: "commit" } for EP v0.9 parallel signing)
  // overrides (optional — gas limits and multipliers)
);

// Sign and send as usual
sponsoredOp.signature = smartAccount.signUserOperation(sponsoredOp, [ownerPrivateKey], chainId);
const response = await smartAccount.sendUserOperation(sponsoredOp, bundlerRpc);
```

### Pay gas with ERC-20 tokens

```typescript
import { SafeAccountV0_3_0, CandidePaymaster } from "abstractionkit";

const paymaster = new CandidePaymaster("https://api.candide.dev/api/v3/11155111/YOUR_API_KEY");
const gasTokenAddress = "0xERC20TokenAddress"; // must be supported by paymaster

const userOp = await smartAccount.createUserOperation(
  [{ to: "0xRecipient", value: 0n, data: "0x" }],
  nodeRpc,
  bundlerRpc,
);

// Automatically prepends token approval + sets paymaster fields.
// For tokens like USDT that require resetting allowance to 0 first, pass
// { resetApproval: true } in the overrides.
// `tokenQuote` carries the exchange rate and max token cost used for the approval.
const { userOperation: tokenOp, tokenQuote } = await paymaster.createTokenPaymasterUserOperation(
  smartAccount,
  userOp,
  gasTokenAddress,
  bundlerRpc,
  // context (optional)
  // overrides (optional — gas limits, multipliers, resetApproval)
);

tokenOp.signature = smartAccount.signUserOperation(tokenOp, [ownerPrivateKey], chainId);
const response = await smartAccount.sendUserOperation(tokenOp, bundlerRpc);
```

### Pass paymaster context (sponsorship policy, parallel signing)

`CandidePaymasterContext` is passed as its own argument, separate from gas overrides.

```typescript
const { userOperation: sponsoredOp } = await paymaster.createSponsorPaymasterUserOperation(
  smartAccount,
  userOp,
  bundlerRpc,
  sponsorshipPolicyId,
  {
    // For EntryPoint v0.9 parallel signing flows:
    // signingPhase: "commit" | "finalize",
  },
  {
    // gas overrides:
    callGasLimitPercentageMultiplier: 110,
  },
);
```

### Batch multiple transactions

```typescript
import { SafeAccountV0_3_0, MetaTransaction } from "abstractionkit";

// Pass an array of MetaTransactions. Automatically encoded via MultiSend.
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

### Calibur 7702: delegate an EOA and send a transfer

`Calibur7702Account` is Uniswap's EIP-7702 smart account. It upgrades a regular EOA in place so the same address becomes a programmable smart account on EntryPoint v0.8.

```typescript
import {
  Calibur7702Account,
  createAndSignEip7702DelegationAuthorization,
} from "abstractionkit";

const eoaAddress = "0xYourEOA";
const privateKey = "0xYourPrivateKey";
const nodeRpc = "https://rpc.example.com";
const bundlerRpc = "https://api.candide.dev/api/v3/11155111/YOUR_API_KEY";
const chainId = 11155111n;

// The EOA address becomes the smart account address after delegation.
const account = new Calibur7702Account(eoaAddress);

// Create UserOp with EIP-7702 delegation (only required the first time).
const userOp = await account.createUserOperation(
  [{ to: "0xRecipient", value: 1000000000000000n, data: "0x" }],
  nodeRpc,
  bundlerRpc,
  { eip7702Auth: { chainId } },
);

// Sign the delegation authorization.
userOp.eip7702Auth = createAndSignEip7702DelegationAuthorization(
  BigInt(userOp.eip7702Auth.chainId),
  userOp.eip7702Auth.address,
  BigInt(userOp.eip7702Auth.nonce),
  privateKey,
);

// Sign and send.
userOp.signature = account.signUserOperation(userOp, privateKey, chainId);
const response = await account.sendUserOperation(userOp, bundlerRpc);
const receipt = await response.included();
```

After the first UserOp deploys the delegation, subsequent UserOps no longer need `eip7702Auth`. Use `getDelegatedAddress(eoaAddress, nodeRpc)` to check delegation status.

### Calibur 7702: register a WebAuthn passkey

```typescript
import { Calibur7702Account } from "abstractionkit";

// Build a P256 key from the WebAuthn public key coordinates.
const webAuthnKey = Calibur7702Account.createWebAuthnP256Key(pubKeyX, pubKeyY);
const keyHash = Calibur7702Account.getKeyHash(webAuthnKey);

// Register with a 1-year expiration.
const registerTxs = Calibur7702Account.createRegisterKeyMetaTransactions(
  webAuthnKey,
  { expiration: Math.floor(Date.now() / 1000) + 86400 * 365 },
);

const userOp = await account.createUserOperation(registerTxs, nodeRpc, bundlerRpc);
userOp.signature = account.signUserOperation(userOp, privateKey, chainId);
const response = await account.sendUserOperation(userOp, bundlerRpc);
```

### Calibur 7702: sign a UserOp with a registered passkey

```typescript
import { Calibur7702Account, createUserOperationHash } from "abstractionkit";

// Use a WebAuthn dummy signature for accurate gas estimation.
const dummySig = Calibur7702Account.createDummyWebAuthnSignature(keyHash);

const userOp = await account.createUserOperation(
  [{ to: "0xRecipient", value: 0n, data: "0x" }],
  nodeRpc,
  bundlerRpc,
  { dummySignature: dummySig },
);

// Compute the hash, sign with the passkey off-chain, then format the signature.
const userOpHash = createUserOperationHash(userOp, entryPointAddress, chainId);
userOp.signature = account.formatWebAuthnSignature(keyHash, {
  authenticatorData,
  clientDataJSON,
  challengeIndex,
  typeIndex,
  r,
  s, // P256 signature components
});

const response = await account.sendUserOperation(userOp, bundlerRpc);
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
* <a href='https://github.com/Uniswap/calibur'>Uniswap Calibur Account</a>

