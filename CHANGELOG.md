# Changelog

## 0.3.4

### New Features

- **`SafeAccount.isDeployed(accountAddress, nodeRpcUrl)`**: static method that checks whether a Safe account is already deployed on-chain. Returns `true` when `accountAddress` has non-empty bytecode, `false` otherwise. Useful for branching between `new SafeAccountV0_3_0(address)` (existing account) and `SafeAccountV0_3_0.initializeNewAccount([owners])` (counterfactual) without inspecting `eth_getCode` manually.

## 0.3.3

### New Features

- **`TokenQuote` type** exported from the package root: `{ token: string; exchangeRate: bigint; tokenCost: bigint }`. Surfaces the exchange rate and maximum token cost the paymaster applied when paying gas with an ERC-20 token, so consumers can display the cost to users or log/meter it without a second RPC round-trip.
- **`CandidePaymaster.createTokenPaymasterUserOperation` and `Erc7677Paymaster.createPaymasterUserOperation` now return `tokenQuote`** alongside the UserOperation. Populated on the token-payment flow; absent on sponsored flows and on Candide's `signingPhase: "finalize"` path (no gas estimation → no cost computation).
- **`skipGasEstimation` flag on `createUserOperation` overrides** for `SafeAccount`, `Calibur7702Account`, and `Simple7702Account`. When set, the UserOperation is returned with a dummy signature and zero (or override-provided) gas limits, skipping the bundler's `eth_estimateUserOperationGas` roundtrip. Useful when gas estimation is run separately, for example by a paymaster sponsorship call that returns its own gas limits.
- **`SponsorInfo` type** exported from the package root. Represents the raw `{ name, icon? }` shape returned by paymasters per ERC-7677; `CandidePaymaster` normalizes it into the public `SponsorMetadata` shape.

### Breaking Changes

- **Three paymaster methods changed return shape** from a raw UserOperation / tuple to a named-field object. All now return `{ userOperation, tokenQuote? | sponsorMetadata? }`:
  - `CandidePaymaster.createTokenPaymasterUserOperation` — returns `{ userOperation, tokenQuote? }` (was `SameUserOp<T>`).
  - `CandidePaymaster.createSponsorPaymasterUserOperation` — returns `{ userOperation, sponsorMetadata? }` (was `[SameUserOp<T>, SponsorMetadata | undefined]`).
  - `Erc7677Paymaster.createPaymasterUserOperation` — returns `{ userOperation, tokenQuote? }` (was `SameUserOp<T>`).

  Migration:
  ```ts
  // Before
  const [sponsoredOp, sponsorMetadata] = await paymaster.createSponsorPaymasterUserOperation(...);
  const tokenOp = await paymaster.createTokenPaymasterUserOperation(...);
  const userOp = await erc7677.createPaymasterUserOperation(...);

  // After
  const { userOperation: sponsoredOp, sponsorMetadata } = await paymaster.createSponsorPaymasterUserOperation(...);
  const { userOperation: tokenOp, tokenQuote } = await paymaster.createTokenPaymasterUserOperation(...);
  const { userOperation, tokenQuote } = await erc7677.createPaymasterUserOperation(...);
  ```
- **`CandidePaymasterContext` moved back to a dedicated parameter** on `CandidePaymaster.createSponsorPaymasterUserOperation` and `createTokenPaymasterUserOperation`. The `context` field was removed from `GasPaymasterUserOperationOverrides`, and `context` is now the second-to-last argument (optional) on both methods, with `overrides` as the last argument. Migration:
  ```ts
  // Before (0.3.2): context nested inside overrides
  await paymaster.createSponsorPaymasterUserOperation(
    smartAccount, userOp, bundlerRpc, sponsorshipPolicyId,
    { context: { signingPhase: "commit" }, maxFeePerGasMultiplier: 110n },
  );
  await paymaster.createTokenPaymasterUserOperation(
    smartAccount, userOp, tokenAddress, bundlerRpc,
    { context: { signingPhase: "commit" }, maxFeePerGasMultiplier: 110n },
  );

  // After (0.3.3): context is a dedicated argument
  await paymaster.createSponsorPaymasterUserOperation(
    smartAccount, userOp, bundlerRpc, sponsorshipPolicyId,
    { signingPhase: "commit" },
    { maxFeePerGasMultiplier: 110n },
  );
  // For createTokenPaymasterUserOperation, `context` is optional: the method
  // always derives `context.token` from the `tokenAddress` argument, so pass
  // `undefined` unless you need other context fields (e.g. `signingPhase`).
  await paymaster.createTokenPaymasterUserOperation(
    smartAccount, userOp, tokenAddress, bundlerRpc,
    undefined,
    { maxFeePerGasMultiplier: 110n },
  );
  ```

### Bug Fixes

- **`CandidePaymaster` now parses sponsor info per ERC-7677.** Paymasters return sponsor info under `sponsor: { name, icon? }` (singular `icon`); the previous code read a non-standard `sponsorMetadata` key and therefore always returned `undefined`. The raw response is now normalized into the public `SponsorMetadata` shape (`{ name, description, url, icons[] }`).

## 0.3.2

### New Features

- **`signUserOperationWithSigner(s)` + `ExternalSigner` (capability-oriented signing API)**: new async method on every account class for integrating viem, ethers Signers, hardware wallets, HSMs, MPC, WebAuthn, or Uint8Array-only signers without passing raw private keys. Each account declares its accepted schemes via a static `ACCEPTED_SIGNING_SCHEMES: ReadonlyArray<"hash" | "typedData">`, and incompatible signers fail offline with an actionable error. The method naming mirrors the parameter arity:
  - Safe accounts (multi-signer): `signUserOperationWithSigners(op, signers[], chainId)` — plural.
  - Simple7702 / Calibur (single signer): `signUserOperationWithSigner(op, signer, chainId)` — singular.

  Call-site is one line:
  ```ts
  import { fromViem } from "abstractionkit"
  userOp.signature = await safe.signUserOperationWithSigners(
      userOp, [fromViem(account)], chainId,
  )
  ```

- **`ExternalSigner` interface**: `{ address, signHash?, signTypedData? }` discriminated union that enforces at least one of the two methods at compile time. Accepts any signer that matches the shape (viem local account, viem WalletClient, ethers Wallet, hardware wallet, MPC, WebAuthn, Uint8Array-held keys). The library has zero runtime dependency on viem or ethers for this surface.
- **`fromPrivateKey(pk)` / `fromViem(account)` / `fromEthersWallet(wallet)` / `fromViemWalletClient(client)` adapters**: one-line factories returning an `ExternalSigner`. Structural types only. `fromViem` / `fromViemWalletClient` require viem ≥ 2.0; `fromEthersWallet` requires ethers ≥ 6.0.
- **`SignHashFn` / `SignTypedDataFn` / `TypedData` / `SigningScheme` / `SignContext` / `MultiOpSignContext` types** exported from the package root for implementers of custom signers.
- **`SignContext` forwarded to signers, narrowly typed per signing path**: signers receive a context as the second arg of `signHash` / `signTypedData` so custom validator implementations can inspect the userOp. `Signer<C>` is generic over context (default `C = SignContext` for single-op `{userOperation, chainId, entryPoint}`; opt into `ExternalSigner<MultiOpSignContext>` for `signUserOperationsWithSigners`'s `{userOperations[], entryPoint}`). Built-in adapters return `Signer<unknown>` and work everywhere. See `src/signer/types.ts`.
- **`SafeMultiChainSigAccountV1.signUserOperationsWithSigners`**: new async multi-op variant that signs a Merkle-rooted bundle of UserOperations with a single signature across chains, using `ExternalSigner[]`.

### Breaking Changes

> **Note on versioning.** The callback-API removal below is a breaking change for callers of `signUserOperationWithSigner`'s prior callback shape on `Calibur7702Account`. Calibur is not yet in use in any production environment; we're communicating directly with the developers currently building against it to coordinate the migration.

- **`SafeAccount.baseSignSingleUserOperation` is now `protected static`.** Previously `public static`, which leaked an internal helper into the package surface. All callers should use the version-specific subclass methods that wrap it (`SafeAccountV0_2_0#signUserOperation`, `SafeAccountV0_3_0#signUserOperation`, etc.) — they auto-inject the correct entrypoint and 4337 module addresses. Migration:
  ```ts
  // Before:
  const sig = SafeAccount.baseSignSingleUserOperation(
    op, [pk], chainId,
    SafeAccountV0_3_0.DEFAULT_ENTRYPOINT_ADDRESS,
    SafeAccountV0_3_0.DEFAULT_SAFE_4337_MODULE_ADDRESS,
  );
  // After:
  const sig = safeV3.signUserOperation(op, [pk], chainId);
  ```
  `baseSignUserOperationWithSigners` (introduced earlier in this Unreleased window) is also `protected static` for the same reason; no migration needed since it was never on a released `latest` tag.
- **`ViemLocalAccountLike` / `ViemWalletClientLike` / `EthersWalletLike` are no longer exported.** They're internal structural shapes the adapters match against; pass concrete viem / ethers instances directly to `fromViem` / `fromViemWalletClient` / `fromEthersWallet`. If you need to type a wrapper, use `Parameters<typeof fromViem>[0]` (etc.).
- **Callback signing API removed.** `signUserOperationWithSigner(op, callback, chainId)` as introduced in the original signer PR is gone, along with the `SignerFunction`, `AddressedSignerFunction`, `SignerInput`, `SignerResult`, and `SignerTypedData` types. The callback method name is now reused for the new capability-oriented API on single-signer accounts (Simple7702, Calibur) with a different parameter shape. Migration:
  ```ts
  // Before:
  const signer = async ({ userOpHash }) => ({
    signature: wallet.signingKey.sign(userOpHash).serialized,
  });
  userOp.signature = await account.signUserOperationWithSigner(userOp, signer, chainId);

  // After — Simple7702 / Calibur (single signer):
  import { fromEthersWallet } from "abstractionkit";
  userOp.signature = await account.signUserOperationWithSigner(
    userOp, fromEthersWallet(wallet), chainId,
  );

  // After — Safe accounts (multi-signer, plural method name):
  userOp.signature = await safe.signUserOperationWithSigners(
    userOp, [fromEthersWallet(wallet)], chainId,
  );
  ```

### Migration: Signing with a raw private key

The existing sync `signUserOperation(op, pk[] | pk, chainId): string` method on every account **is untouched**. If your code passes a hex private-key string directly, no change needed. The new `signUserOperationWithSigner(s)` methods are Signers-only — they do NOT accept bare pk strings. To sign with a pk string via the new API, wrap explicitly:

```ts
import { fromPrivateKey } from "abstractionkit";
userOp.signature = await safe.signUserOperationWithSigners(
  userOp, [fromPrivateKey(pk)], chainId,
);
```

## 0.3.1

### New Features

- **`Erc7677Paymaster`**: provider-agnostic [ERC-7677](https://eips.ethereum.org/EIPS/eip-7677) paymaster client. Works with any compliant provider (Candide, Pimlico, Alchemy, ...). Auto-detects Candide/Pimlico from the URL and runs the full stub, estimate, and final pipeline in one call. Passing `{ token }` in context triggers the ERC-20 gas flow automatically.
- `Bundler.estimateUserOperationGas` now forwards `paymasterVerificationGasLimit` and `paymasterPostOpGasLimit` when returned by the bundler.

### Breaking Changes

- **`SafeMultiChainSigAccountV1.formatSignaturesToUseroperationsSignatures`**: the third `overrides` argument has been removed. Overrides are now per-operation via a new optional `overrides` field on each `UserOperationToSignWithOverrides` element of the first argument. Migration: `ops.map(op => ({ ...op, overrides: {...} }))` and drop the third argument.

### Other

- Minor type tightening across Calibur, Simple7702, and Tenderly helpers.

## 0.3.0

**This is a major release. The canonical upgrade path is from 0.2.30 (previous stable) to 0.3.0 (current stable).** Versions 0.2.31 through 0.2.41 were experimental pre-releases and are not on the `latest` dist-tag.

### Breaking Changes

#### Build & Runtime

- **Node.js >= 18 required.** Native `fetch` is now used; `isomorphic-unfetch` has been removed as a dependency.
- **Build system switched from microbundle to tsdown.** Dist output paths have changed. If you import from a subpath, update your references:
  - `dist/index.js` -> `dist/index.cjs`
  - `dist/index.m.js` -> `dist/index.mjs`
  - `dist/index.umd.js` -> `dist/index.iife.js`
  - `dist/index.d.ts` -> `dist/index.d.cts`
  - A proper `exports` map has been added to `package.json` for ESM/CJS resolution, so normal `import { X } from "abstractionkit"` consumers are unaffected.

#### Paymaster API

- **`CandidePaymaster.createSponsorPaymasterUserOperation(...)` signature changed.** The method now takes `smartAccount` as the **first** argument. Migration:
  ```ts
  // Before (0.2.30):
  await paymaster.createSponsorPaymasterUserOperation(userOp, bundlerRpc, sponsorshipPolicyId, overrides);

  // After (0.3.0):
  await paymaster.createSponsorPaymasterUserOperation(smartAccount, userOp, bundlerRpc, sponsorshipPolicyId, overrides);
  ```
  The `overrides` parameter type is also richer: it now accepts a `context?: CandidePaymasterContext` field for passing `sponsorshipPolicyId` and the new parallel-signing `signingPhase` option through overrides.
- **`createPaymasterUserOperation` has been removed.** Use `createSponsorPaymasterUserOperation` or `createTokenPaymasterUserOperation` directly.
- **CandidePaymaster now uses the `pm_getPaymasterData` JSON-RPC method** internally. Paymaster types have been unified and restructured.
- **`PaymasterInitValues` renamed to `ParallelPaymasterInitValues`.**

#### TypeScript Export Changes (`isolatedModules` compatibility)

Many interfaces and types are now exported with `export type` instead of `export`. This is only breaking if you re-export them yourself with `export { X } from "abstractionkit"`, in which case change to `export type { X }`. Affected identifiers include:

- `RecoveryRequest`, `RecoverySignaturePair`, `RecoveryRequestTypedDataDomain`, `RecoveryRequestTypedMessageValue`
- `Allowance`
- `DepositInfo`
- `Authorization7702Hex`, `Authorization7702`
- `CandidePaymasterContext`, `PrependTokenPaymasterApproveAccount`
- `UserOperationV6`, `UserOperationV7`, `UserOperationV8`, `UserOperationV9`, `AbiInputValue`, `JsonRpcParam`, `JsonRpcResponse`, `MetaTransaction`, `StateOverrideSet`, and other non-runtime types from `./types`
- `CreateUserOperationV6Overrides`, `CreateUserOperationV7Overrides`, `CreateUserOperationV9Overrides`, `ECDSAPublicAddress`, `InitCodeOverrides`, `SafeUserOperationTypedDataDomain`, `WebauthnPublicKey`, `WebauthnSignatureData`, `SignerSignaturePair`, `Signer`
- `SafeMessageTypedDataDomain`, `SafeMessageTypedMessageValue`

The wildcard re-export `export * from "./account/Safe/safeMessage"` has been replaced with explicit named exports (`SAFE_MESSAGE_PRIMARY_TYPE`, `SAFE_MESSAGE_MODULE_TYPE`, `getSafeMessageEip712Data`).

### New Features

#### New Account Classes

- **`Calibur7702Account`**: full-featured EIP-7702 smart account for EntryPoint v0.8, ported from Uniswap's Calibur. Supports secp256k1, P256, and WebAuthn P256 keys with per-key permissions and expirations. Includes key management (register, revoke, update settings via self-calls), automatic EIP-7702 delegation authoring and checking, and delegation revocation. Also exports `CaliburKeyType` and the `CaliburKey`, `CaliburKeySettings`, `CaliburKeySettingsResult`, `WebAuthnSignatureData`, `CaliburCreateUserOperationOverrides`, `CaliburSignatureOverrides`, and `SignerFunction` types.
- **`Simple7702AccountV09`**: minimal EIP-7702 account targeting EntryPoint v0.9, with parallel paymaster signing support.
- **`SafeMultiChainSigAccountV1`**: audited multi-chain signature account. Sign once, replay across chains via a merkle-proof structure. Promoted from experimental.
- **`SafeAccountV1_5_0_M_0_3_0`**: Safe contract v1.5.0 support with EIP-7951 and the Daimo P256 verifier for WebAuthn.

#### EntryPoint v0.8 and v0.9 Support

- `UserOperationV9` type and `CreateUserOperationV9Overrides` added.
- `ENTRYPOINT_V6`, `ENTRYPOINT_V7`, `ENTRYPOINT_V8`, `ENTRYPOINT_V9` address constants exported.
- Bundler, CandidePaymaster, and Tenderly simulation helpers updated to handle all four EntryPoint versions.
- Entrypoint version resolution has been centralized in `CandidePaymaster`: a new private `resolveEntrypoint` helper reads the target entrypoint from the smart account instance at the top of each public method, replacing the per-method `UserOperation vX.YZ is not supported` checks from 0.2.30. The guard itself is not new, but unsupported-version errors are now surfaced earlier and more consistently.

#### Parallel Paymaster Signing (EntryPoint v0.9)

- **`ExperimentalAllowAllParallelPaymaster`**: an experimental paymaster for the parallel-signing flow.
- **`signingPhase`** added to `CandidePaymasterContext`, with values `"commit"` and `"finalize"`. Enables parallel-signing flows where owner signing and the paymaster's final signature can happen independently, via the `PAYMASTER_SIG_MAGIC` convention on `paymasterData`. Works with EntryPoint v0.9 only.
- `CandidePaymaster` supports both v0.9 parallel flows and the existing sequential flow.

#### Safe Accounts

- **`createChangeThresholdMetaTransaction`**, **`createApproveHashMetaTransaction`**, and **`getThreshold`** added to `SafeAccount`. Makes multi-sig threshold management and offchain approval flows first-class.
- **Auto-prepend `approve(0)`** before setting a new ERC-20 allowance for tokens like USDT that disallow changing a non-zero allowance directly. Opt in via `{ resetApproval: true }` on the token paymaster overrides.
- **`MerkleTree`** helper utilities added for multi-chain operations.

#### AllowanceModule v1.0.0

- Allowance module updated to v1.0.0. The legacy address is exported as **`ALLOWANCE_MODULE_V0_1_0_ADDRESS`** for migration purposes.

#### Calibur Singleton Addresses

- **`CALIBUR_UNISWAP_V1_0_0_SINGLETON_ADDRESS`** and **`CALIBUR_CANDIDE_V0_1_0_SINGLETON_ADDRESS`** exported as constants.

#### EIP-7702 Delegation Helpers

- **`getDelegatedAddress(eoaAddress, nodeRpc)`** utility for checking the current EIP-7702 delegation target of an EOA.
- **Calibur delegation and key revocation**: `Calibur7702Account.createRevokeKeyMetaTransaction` and `createRevokeAllKeysMetaTransactions` for revoking individual or all registered keys, plus `createRevokeDelegationRawTransaction` for revoking the EIP-7702 delegation itself. Complements automatic delegation checking during UserOperation creation.

#### Utilities and Constants

- **EIP-2098** compact signature support in `parseRawSignature`.
- **`EIP712_SAFE_OPERATION_PRIMARY_TYPE`** and **`EIP712_MULTI_CHAIN_OPERATIONS_PRIMARY_TYPE`** constants added alongside the existing EIP-712 type constants.
- **`EIP712_MULTI_CHAIN_OPERATIONS_TYPE`** (previously `EIP712_MULTI_SAFE_OPERATIONS_TYPE`, renamed).
- New paymaster-type exports: **`AnyUserOperation`**, **`SameUserOp`**.

#### Tenderly

- Tenderly simulation helpers updated to support EntryPoint v0.9 and `IAccountExecute.executeUserOp` callData rewriting.

### Renames

| Before | After |
|--------|-------|
| `ExperimentalSafeMultiChainSigAccount` | `SafeMultiChainSigAccountV1` |
| `ExperimentalAllowAllPaymaster` | `ExperimentalAllowAllParallelPaymaster` |
| `EIP712_MULTI_SAFE_OPERATIONS_TYPE` | `EIP712_MULTI_CHAIN_OPERATIONS_TYPE` |
| `PaymasterInitValues` | `ParallelPaymasterInitValues` |
| `listKeys` (Calibur) | `getKeys` |

These renames only apply to code built on intermediate experimental versions (0.2.31 through 0.2.41). Code on 0.2.30 does not reference these identifiers.

### Bug Fixes

Fixes listed here apply to APIs that already existed at 0.2.30. Bugs that were fixed within new-in-0.3.0 features during their pre-release development are not listed separately; those features are shipped in their final form as part of the "New Features" section.

- **Gas estimation**: fixed gas overrides calculations, BigInt gas scaling, and handling of fractional percentage multipliers in `applyMultiplier`.
- **SafeAccount multisend**: fixed a bug where token paymaster approvals were prepended after existing calls instead of before them.
- **WebAuthn passkeys**: fixed compatibility with the v0.2.1 shared-signer contracts when using custom contract addresses.
- **EIP-7702 utilities**: fixed `CHAIN_ID` BigInt crash in signing helpers and exposed `DEFAULT_DELEGATEE_ADDRESS` as a static property.
- **Safe v0.3.0 account**: fixed `safeAccountSingleton` forwarding and added missing `webAuthnSignerProxyCreationCode` handling.
- **CandidePaymaster**: fixed `paymasterMetadata` hex-field normalization in `fetchSupportedERC20TokensAndPaymasterMetadata`; fixed several instances of in-place mutation via aliasing on the user-passed UserOperation.
- **Constructor forwarding and lifecycle**: fixed unhandled promises, timeout tracking, and constructor argument forwarding across pre-existing classes.
- **Miscellaneous**: typo fixes in error messages, removal of unused imports and dead guards, unused `safeV06PrevModuleAddress` removed, chainId validation tightened in pre-existing helpers.

### Internal

- Build system migrated from microbundle to tsdown. Output paths updated (see Breaking Changes).
- `Simple7702Account` refactored into a `BaseSimple7702Account` pattern to enable the new `Simple7702AccountV09` subclass. No user-facing API changes on `Simple7702Account` itself.
- Removed `isomorphic-unfetch` and `rimraf` dependencies; `rimraf` replaced with a cross-platform inline Node script.
- Added CI workflow (`.github/workflows/ci.yml`) using yarn.
- Added `SECURITY.md` with vulnerability reporting policy.
- Added `prepare` script for GitHub-based installs.
- Extensive JSDoc coverage added across public methods and types.
