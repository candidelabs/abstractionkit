const { execSync } = require('child_process');
const crypto = require('crypto');
const { secp256k1 } = require('@noble/curves/secp256k1');
const { keccak_256 } = require('@noble/hashes/sha3');

function toChecksumAddress(address) {
  const addr = address.toLowerCase().replace('0x', '');
  const hash = Buffer.from(keccak_256(Buffer.from(addr, 'utf8'))).toString('hex');
  let checksummed = '0x';
  for (let i = 0; i < 40; i++) {
    checksummed += parseInt(hash[i], 16) >= 8 ? addr[i].toUpperCase() : addr[i];
  }
  return checksummed;
}

function generateKey() {
  const key = crypto.randomBytes(32).toString('hex');
  const pubKey = secp256k1.getPublicKey(key, false).slice(1);
  const rawAddr = '0x' + Buffer.from(keccak_256(pubKey)).slice(-20).toString('hex');
  return { privateKey: `0x${key}`, address: toChecksumAddress(rawAddr) };
}

async function setBalance(rpcUrl, address, balanceHex) {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'anvil_setBalance',
      params: [address, balanceHex],
      id: 1,
    }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`Failed to fund ${address}: ${JSON.stringify(json.error)}`);
}

module.exports = async function globalSetup() {
  const sepoliaRpc = process.env.SEPOLIA_RPC;
  if (!sepoliaRpc) {
    throw new Error('SEPOLIA_RPC env var is required (Sepolia RPC URL to fork from)');
  }

  const anvilPort = process.env.ANVIL_PORT || '8545';
  const bundlerPort = process.env.BUNDLER_PORT || '3000';
  const anvilUrl = `http://localhost:${anvilPort}`;

  // Generate fresh bundler signer key
  const bundler = generateKey();
  console.log(`Bundler signer: ${bundler.address}`);

  // Tear down any previous run
  try { execSync('docker compose -f docker-compose.test.yml down', { stdio: 'pipe' }); } catch {}

  const composeEnv = {
    ...process.env,
    SEPOLIA_RPC: sepoliaRpc,
    ANVIL_PORT: anvilPort,
    BUNDLER_PORT: bundlerPort,
    BUNDLER_SECRET: bundler.privateKey,
  };

  // 1. Start Anvil only and wait for it to be healthy
  console.log('Starting Anvil...');
  execSync('docker compose -f docker-compose.test.yml up -d anvil --wait', {
    stdio: 'inherit',
    env: composeEnv,
  });

  // 2. Fund bundler signer BEFORE voltaire starts
  await setBalance(anvilUrl, bundler.address, '0x56BC75E2D63100000');
  console.log('Bundler signer funded:', bundler.address);

  // 3. Now start Voltaire (bundler already has balance)
  console.log('Starting Voltaire...');
  execSync('docker compose -f docker-compose.test.yml up -d voltaire --wait', {
    stdio: 'inherit',
    env: composeEnv,
  });

  // 4. Build project (tests import from dist/)
  console.log('Building project...');
  execSync('yarn build', { stdio: 'inherit' });
};
