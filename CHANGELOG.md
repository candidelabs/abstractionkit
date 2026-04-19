# Changelog

## [Unreleased]

### New Features

- **`signUserOperationWithSigner`**: new method on `Calibur7702Account`, `Simple7702Account`, `Simple7702AccountV09`, `SafeAccountV0_2_0`, `SafeAccountV0_3_0`, and `SafeAccountV1_5_0_M_0_3_0` for integrating external signers (viem, ethers Signers, hardware wallets, MPC signers) without passing raw private keys.
- **Shared `SignerFunction` / `AddressedSignerFunction` / `SignerInput` / `SignerResult` / `SignerTypedData` types** exported from the package root. `SignerInput` carries `userOpHash`, the full `userOperation`, `chainId`, `entryPoint`, and — for Safe accounts — an EIP-712 `typedData` bundle so signers can use `signTypedData` for structured wallet display. Signers return `{ signerAddress?: string; signature: string }`. Safe accounts require the stricter `AddressedSignerFunction` (signer must declare its address) — signatures are ordered by signer address on-chain and ecrecover is unreliable for contract signers, WebAuthn-wrapped signatures, and `eth_sign`-flavored signatures with `v ∈ {31, 32}`.

### Breaking Changes

> **Note on versioning.** The `SignerFunction` shape change below is a breaking change, but it does not necessarily trigger a major version bump. `Calibur7702Account` is not yet in use in any production environment, and we're communicating directly with the developers currently building against it to coordinate the migration.

- **`Calibur7702Account` `SignerFunction` shape changed.** The callback now receives a `SignerInput` context object and returns `{ signerAddress?, signature }` instead of a bare signature string. Migration:
  ```ts
  // Before (0.3.1):
  const signer = (hash) => wallet.signingKey.sign(hash).serialized;
  // After (0.4.0):
  const signer = async ({ userOpHash }) => ({
    signature: wallet.signingKey.sign(userOpHash).serialized,
  });
  ```
  The recommended signing path is raw-hash ECDSA over `userOpHash` (viem: `walletClient.sign({ hash })`, ethers: `wallet.signingKey.sign(hash)`). Simple7702 and Calibur only accept the raw form; Safe additionally accepts EIP-191-wrapped signatures but only with `v ∈ {31, 32}`, which default `signMessage` tooling does not produce. For Safe, `walletClient.signTypedData(...)` with the supplied `typedData` is the structured-UX equivalent of raw signing.

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
