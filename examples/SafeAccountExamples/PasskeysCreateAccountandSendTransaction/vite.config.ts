import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react-swc'
import mkcert from 'vite-plugin-mkcert'

const REQUIRED_ENV_VARS = ['VITE_CHAIN_ID', 'VITE_BUNDLER_URL', 'VITE_JSON_RPC_PROVIDER', 'VITE_PAYMASTER_URL']

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd())

  for (const key of REQUIRED_ENV_VARS) {
    if (!env[key]) {
      throw new Error(`Environment variable ${key} is missing`)
    }
  }

  return {
    plugins: [react(), mkcert()],
    server: { https: true }, // Not needed for Vite 5+
  }
})
