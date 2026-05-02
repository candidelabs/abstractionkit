# Signers

AbstractionKit uses capability-oriented signers for account methods that accept external signing backends. A signer exposes an address and at least one signing method:

- `signHash(hash, context)` signs a raw 32-byte digest with no EIP-191 prefix.
- `signTypedData(data, context)` signs an EIP-712 payload.

Account implementations choose the best supported scheme for the operation. Safe accounts prefer typed data when available, while Simple7702, Calibur, and Safe multi-chain Merkle signing require raw hash signing.

## Built-in adapters

- `fromPrivateKey(privateKey)` exposes both hash and typed-data signing.
- `fromEthersWallet(wallet)` exposes both hash and typed-data signing.
- `fromViem(account)` exposes both hash and typed-data signing for viem local accounts.
- `fromViemWalletClient(client)` exposes typed-data signing only, which fits browser and JSON-RPC wallets.
- `fromSafeWebauthn(params)` exposes hash signing only and marks the signer as a Safe contract signer.

## Context

The SDK passes context whenever it invokes a signer through an account method. Single-operation paths receive `{ userOperation, chainId, entryPoint }`. Safe multi-chain Merkle signing receives `{ userOperations, entryPoint }`.

Use context in custom signers for policy checks, audit logs, user prompts, or telemetry. Built-in local-key adapters intentionally ignore context because they only adapt lower-level signing primitives.

## Safe Contract Signers

Safe WebAuthn and EIP-1271 signers must be tagged with `type: "contract"` so Safe signature formatting uses a dynamic contract-signature segment. EOA signers can omit `type` or set `type: "ecdsa"`.

For WebAuthn, pass the same account class and WebAuthn overrides used when the Safe was initialized. The signer address is the shared signer for init operations and the deterministic verifier proxy after deployment.
