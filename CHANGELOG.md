# Changelog

## 0.3.0

### Breaking Changes

#### Build & Runtime

- **Node.js >= 18 required** — native `fetch` is now used; `isomorphic-unfetch` has been removed as a dependency.
- **Build system switched from microbundle to tsdown** — dist output paths have changed:
  - `dist/index.js` → `dist/index.cjs`
  - `dist/index.m.js` → `dist/index.mjs`
  - `dist/index.umd.js` → `dist/index.iife.js`
  - `dist/index.d.ts` → `dist/index.d.cts`
  - Proper `exports` map added to `package.json` for ESM/CJS resolution.

#### API Changes

- **`signUserOperation` now only accepts a private key.** Use the new `signUserOperationWithSigner` method for external/custom signers.
- **`createPaymasterUserOperation` removed.** Use `CandidePaymaster` methods directly.
- **CandidePaymaster migrated to `pm_getPaymasterData` RPC** — paymaster types have been unified and restructured.
- **`PaymasterInitValues` renamed to `ParallelPaymasterInitValues`.**

#### Renames

| Before | After |
|--------|-------|
| `ExperimentalSafeMultiChainSigAccount` | `SafeMultiChainSigAccountV1` |
| `ExperimentalAllowAllPaymaster` | `ExperimentalAllowAllParallelPaymaster` |
| `EIP712_MULTI_SAFE_OPERATIONS_TYPE` | `EIP712_MULTI_CHAIN_OPERATIONS_TYPE` |
| `listKeys` (Calibur) | `getKeys` |

#### TypeScript Export Changes

Several interfaces and types are now exported as `export type` instead of `export` for `isolatedModules` compatibility. This is only breaking if you re-export them with `export { X } from "abstractionkit"` — change to `export type { X }`:

- `RecoveryRequest`, `RecoverySignaturePair`, `RecoveryRequestTypedDataDomain`, `RecoveryRequestTypedMessageValue`
- `Allowance`
- `DepositInfo`
- `Authorization7702Hex`, `Authorization7702`
- `CandidePaymasterContext`, `PrependTokenPaymasterApproveAccount`
- `UserOperationV6`, `UserOperationV7`, `UserOperationV8`, `AbiInputValue`, `JsonRpcParam`, `JsonRpcResponse`, `MetaTransaction`, `StateOverrideSet`, etc.
- `SafeMessageTypedDataDomain`, `SafeMessageTypedMessageValue`
- `SafeUserOperationTypedDataDomain`, `WebauthnPublicKey`, `WebauthnSignatureData`, `SignerSignaturePair`, `Signer`, etc.

The wildcard re-export `export * from "./account/Safe/safeMessage"` has been replaced with explicit named exports.

### New Features

#### EIP-7702 Support

- **`Simple7702Account`** — EIP-7702 account for EntryPoint v0.8.
- **`Simple7702AccountV09`** — EIP-7702 account for EntryPoint v0.9, with parallel paymaster support.
- **`Calibur7702Account`** — full-featured EIP-7702 account with WebAuthn/passkey support, key management, delegation auto-checking, and delegation revocation.
- **`getDelegatedAddress`** utility for checking EIP-7702 delegation status.
- **EIP-7702 delegation helpers** on `BaseSimple7702Account` (create, sign, and revoke delegation authorizations).
- **Tenderly simulation support** for EntryPoint v0.9.

#### Safe Accounts

- **`SafeAccountV1_5_0_M_0_3_0`** — Safe contract v1.5.0 support with EIP-7951 and Daimo P256 verifier for WebAuthn.
- **`SafeMultiChainSigAccountV1`** — multi-chain signature account (audited, promoted from experimental).
- `createChangeThresholdMetaTransaction`, `createApproveHashMetaTransaction`, and `getThreshold` methods.
- Auto-prepend `approve(0)` for ERC-20 tokens that require allowance reset before setting a new approval.

#### EntryPoint v0.9

- `UserOperationV9` type added.
- Version-entrypoint compatibility guard — mismatched UserOperation versions are now caught early.
- Entrypoint version is now resolved from the account instance.

#### Paymaster

- **`CandidePaymaster` now supports EntryPoint v0.9 and parallel signing flows.**
- **`ExperimentalAllowAllParallelPaymaster`** for parallel paymaster data flows.
- **Signing phases** added to the context object, with support in paymaster flows.
- Parallel paymaster support for `Simple7702AccountV09`.

#### Utilities

- `MerkleTree` helper functions for multi-chain operations.
- EIP-2098 compact signature support in `parseRawSignature`.
- `EIP712_SAFE_OPERATION_PRIMARY_TYPE` and `EIP712_MULTI_CHAIN_OPERATIONS_PRIMARY_TYPE` constants.
- Entrypoint address constants: `ENTRYPOINT_V6`, `ENTRYPOINT_V7`, `ENTRYPOINT_V8`, `ENTRYPOINT_V9`.
- `CALIBUR_UNISWAP_V1_0_0_SINGLETON_ADDRESS` and `CALIBUR_CANDIDE_V0_1_0_SINGLETON_ADDRESS` constants.
- Legacy `ALLOWANCE_MODULE_V0_1_0_ADDRESS` constant for migration.

### Bug Fixes

- Fix object mutation via aliasing in `SafeAccountV1_5_0_M_0_3_0` and `CandidePaymaster`.
- Fix object mutation, infinite recursion, and missing module address in multi-chain leaf hashes.
- Fix BigInt gas scaling, merkle proof forwarding, entrypoint dispatch, and missing override fields.
- Fix `CHAIN_ID` BigInt crash.
- Fix gas overrides calculations.
- Fix `formatSignaturesToUseroperationsSignatures` overrides and single-op case handling.
- Fix `paymasterAndData` packing and signing when `PAYMASTER_SIG_MAGIC` is appended (v0.9).
- Fix fractional percentage multipliers in `applyMultiplier`.
- Fix normalize `paymasterMetadata` hex fields in `fetchSupportedERC20TokensAndPaymasterMetadata`.
- Fix multi-chain sig account singleton forwarding, hash overrides, and type safety.
- Fix constructor forwarding, timeout tracking, and unhandled promises.
- Fix reverse proof order to match onchain verification order.
- Fix WebAuthn passkeys v0.2.1 compatibility for custom contract addresses.
- Fix token approval prepended before existing calls in SafeAccount multisend.
- Fix `IAccountExecute.executeUserOp` callData rewriting for Tenderly simulation.
- Fix multi-chain defaults in `formatSignaturesToUseroperationsSignatures`.

### Internal

- Build system migrated from microbundle to tsdown.
- Removed `isomorphic-unfetch` and `rimraf` dependencies.
- Added CI workflow (`.github/workflows/ci.yml`) using yarn.
- Added `SECURITY.md` with vulnerability reporting policy.
- Added `prepare` script for GitHub-based installs.
