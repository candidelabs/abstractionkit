import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm', 'iife'],
  globalName: 'abstractionkit',
  dts: true,
  clean: true,
  sourcemap: false,
  target: 'es2022',
  deps: { neverBundle: ['ethers'] },
})
