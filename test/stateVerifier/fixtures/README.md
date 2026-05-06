# State Verifier Fixtures

Captured JSON-RPC responses from Ethereum mainnet used by unit tests.

## Regenerate

```bash
RPC_URL=https://ethereum-rpc.publicnode.com node test/stateVerifier/fixtures/capture.js
```

Fixtures are pinned to a specific block. Tests must not call `eth_*` methods themselves.
