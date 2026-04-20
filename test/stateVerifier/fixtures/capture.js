// Captures fixtures for state verifier tests.
// Usage:
//   RPC_URL=https://ethereum-rpc.publicnode.com node test/stateVerifier/fixtures/capture.js
// Output: 5 JSON files in this directory.

const fs = require('fs');
const path = require('path');

const RPC_URL = process.env.RPC_URL || 'https://ethereum-rpc.publicnode.com';

async function rpc(method, params) {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`${method}: ${JSON.stringify(data.error)}`);
  return data.result;
}

async function captureAt(name, address, slots, blockHex) {
  const block = await rpc('eth_getBlockByNumber', [blockHex, false]);
  const proof = await rpc('eth_getProof', [address, slots, blockHex]);
  const code = await rpc('eth_getCode', [address, blockHex]);
  const fixture = {
    rpcUrl: RPC_URL,
    blockNumber: blockHex,
    block: {
      number: block.number,
      hash: block.hash,
      stateRoot: block.stateRoot,
      parentHash: block.parentHash,
      timestamp: block.timestamp,
    },
    getProof: proof,
    getCode: code,
  };
  const out = path.join(__dirname, `${name}.json`);
  fs.writeFileSync(out, JSON.stringify(fixture, null, 2));
  console.log(`wrote ${out}`);
}

(async () => {
  const latest = BigInt(await rpc('eth_blockNumber', []));
  const target = latest - 10n;
  const blockHex = '0x' + target.toString(16);
  console.log(`Capturing at block ${target}`);

  // 1. EOA with history (Vitalik)
  await captureAt(
    'eoa-with-history',
    '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    [],
    blockHex,
  );

  // 2. Empty account (provably absent from the trie -- never funded, never used).
  // 0x000000000000000000000000000000000000dead has ~51 ETH on mainnet and is
  // therefore present in the trie. Use 0xCafecafecafecafecafecafecafecafecafecafe
  // instead: verified absent (branch exclusion proof, balance=0, nonce=0).
  await captureAt(
    'empty-account',
    '0xCafecafecafecafecafecafecafecafecafecafe',
    [],
    blockHex,
  );

  // 3. Safe 1.4.1 singleton on mainnet
  await captureAt(
    'safe-v141-singleton',
    '0x41675C099F32341bf84BFc5382aF534df5C7461a',
    ['0x0000000000000000000000000000000000000000000000000000000000000000'],
    blockHex,
  );

  // 4. USDC balance slot for Vitalik (balances mapping at slot 9)
  const usdc = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
  const vitalik = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
  const { AbiCoder, keccak256 } = require('ethers');
  const slot = keccak256(
    AbiCoder.defaultAbiCoder().encode(['address', 'uint256'], [vitalik, 9n]),
  );
  await captureAt('erc20-balance-slot', usdc, [slot], blockHex);

  // 5. EIP-7702 delegated EOA. The address below was delegated to
  // 0x4884d28f048e66a537762334937e01a044cbdfac on mainnet.
  // If it is not delegated at this block, try a different one or skip.
  try {
    await captureAt(
      'eip7702-delegated-eoa',
      '0x42121a15a6b3f67ba5c92eb0a5793fcaddce317c',
      [],
      blockHex,
    );
  } catch (e) {
    console.warn('Skipping eip7702-delegated-eoa fixture:', e.message);
  }

  console.log('Done.');
})();
