import { defineConfig } from 'tsdown'

const nobleDependencies = [/^@noble\/hashes(?:\/|$)/, /^@noble\/curves(?:\/|$)/]

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['cjs', 'esm'],
    dts: true,
    clean: true,
    sourcemap: false,
    target: 'es2022',
    fixedExtension: true,
  },
  {
    entry: ['src/index.ts'],
    format: ['iife'],
    globalName: 'abstractionkit',
    dts: false,
    clean: false,
    sourcemap: false,
    target: 'es2022',
    platform: 'browser',
    deps: {
      alwaysBundle: nobleDependencies,
      onlyBundle: nobleDependencies,
    },
  },
])
