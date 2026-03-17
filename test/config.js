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

const account1 = generateKey();
const account2 = generateKey();
const account3 = generateKey();

const ANVIL_PORT = process.env.ANVIL_PORT || '8545';
const BUNDLER_PORT = process.env.BUNDLER_PORT || '3000';

// WETH on Sepolia — used as allowance test token
const WETH_ADDRESS = '0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9';

const config = {
  chainId: '11155111',
  jsonRpcNodeProvider: `http://localhost:${ANVIL_PORT}`,
  bundlerUrl: `http://localhost:${BUNDLER_PORT}/rpc`,

  account1,
  account2,
  account3,

  allowanceTokenAddress: WETH_ADDRESS,

  // Tenderly (manual env vars)
  tenderlyAccountSlug: process.env.TENDERLY_ACCOUNT_SLUG,
  tenderlyProjectSlug: process.env.TENDERLY_PROJECT_SLUG,
  tenderlyAccessKey: process.env.TENDERLY_ACCESS_KEY,
};

async function rpc(method, params) {
  const res = await fetch(config.jsonRpcNodeProvider, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`RPC ${method} failed: ${JSON.stringify(json.error)}`);
  return json.result;
}

async function setBalance(address, balanceHex) {
  await rpc('anvil_setBalance', [address, balanceHex]);
}

// Set ERC20 balance via storage slot manipulation
// WETH9 balanceOf mapping is at slot 3
function wethBalanceSlot(address) {
  const addr = address.toLowerCase().replace('0x', '').padStart(64, '0');
  const slot = '3'.padStart(64, '0');
  return '0x' + Buffer.from(keccak_256(Buffer.from(addr + slot, 'hex'))).toString('hex');
}

async function setWethBalance(account, amount) {
  const slot = wethBalanceSlot(account);
  const value = '0x' + amount.toString(16).padStart(64, '0');
  await rpc('anvil_setStorageAt', [WETH_ADDRESS, slot, value]);
}

let fundedPromise = null;

config.setBalance = setBalance;

config.ensureFunded = function () {
  if (fundedPromise) return fundedPromise;
  fundedPromise = (async () => {
    const balance = '0x56BC75E2D63100000'; // 100 ETH
    const ak = require('../dist/index.umd');

    // Fund EOAs
    for (const acct of [account1, account2, account3]) {
      await setBalance(acct.address, balance);
    }

    // Fund Safe smart account addresses (ETH + WETH)
    const safeVersions = [ak.SafeAccountV0_3_0, ak.SafeAccountV0_2_0];
    const wethAmount = 10n * 10n ** 18n; // 10 WETH
    for (const version of safeVersions) {
      for (const owner of [account1.address, account2.address]) {
        const safeAddr = version.createAccountAddress([owner]);
        await setBalance(safeAddr, balance);
        await setWethBalance(safeAddr, wethAmount);
      }
    }
  })();
  return fundedPromise;
};

module.exports = config;
