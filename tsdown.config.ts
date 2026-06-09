import { defineConfig } from 'tsdown'

const shared = {
  entry: ['src/index.ts'],
  sourcemap: false,
  target: 'es2022',
} as const

export default defineConfig([
  // Node / bundler builds (CJS + ESM). @noble/* stay external so npm consumers
  // resolve and dedupe a single copy from node_modules.
  {
    ...shared,
    format: ['cjs', 'esm'],
    dts: true,
    clean: true,
  },
  // Browser / CDN build (IIFE, the `unpkg` entry). A <script>/unpkg consumer
  // has no module resolver, so the runtime deps must be bundled in. Otherwise
  // @noble/hashes and @noble/curves are emitted as undefined globals
  // (`_noble_hashes_sha3`, `_noble_curves_secp256k1`) and loading the script
  // throws "ReferenceError: _noble_hashes_sha3 is not defined".
  {
    ...shared,
    format: ['iife'],
    globalName: 'abstractionkit',
    noExternal: [/^@noble\//],
    // Resolve the browser export conditions of @noble/* so its crypto shim uses
    // the global `crypto` (Web Crypto) instead of importing `node:crypto`, which
    // would otherwise be externalized as an undefined `node_crypto` global.
    platform: 'browser',
  },
])
