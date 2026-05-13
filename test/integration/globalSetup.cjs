require('dotenv').config();
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Wallet } = require('ethers');
const chains = require('./chains.cjs');
const { SUPPORTED_ENTRYPOINTS } = require('./_entrypoints.cjs');

const NETWORK = 'abstractionkit-integration';
const ANVIL_IMAGE = 'ghcr.io/foundry-rs/foundry:v1.7.1';
const VOLTAIRE_IMAGE = 'ghcr.io/candidelabs/voltaire/voltaire-bundler:0.1.0a72';
const ANVIL_INTERNAL_PORT = '8545';
const VOLTAIRE_INTERNAL_PORT = '3000';
const TEN_ETH_HEX = '0x8ac7230489e80000';
const READY_TIMEOUT_MS = 90000;

const STATUS_FILE = path.join(os.tmpdir(), 'abstractionkit-integration-status.json');
const LOG_DIR = path.join(os.tmpdir(), 'abstractionkit-integration-logs');

// Per-repo anvil RPC cache, mounted into the foundry container so storage
// fetched from upstream (Infura, publicnode, ...) is reused across runs.
// Combined with a pinned --fork-block-number this brings repeat-run upstream
// traffic to near zero.
const ANVIL_CACHE_DIR = path.join(__dirname, '..', '..', '.anvil-cache');
const FORK_BLOCK_OFFSET = 5; // pin a few blocks behind latest so the same
// pinned block stays valid across consecutive runs (cache hits).

const anvilContainer = (name) => `abstractionkit-anvil-${name}`;
const voltaireContainer = (name, ep) => `abstractionkit-voltaire-${name}-${ep}`;
const forkUrlFor = (chain) => process.env[chain.forkUrlEnvVar] || chain.defaultForkUrl;
const anvilHostUrl = (chain) => `http://127.0.0.1:${chain.anvilHostPort}`;
const bundlerHostUrl = (chain, ep) =>
    `http://127.0.0.1:${chain.bundlerHostPortByEntrypoint[ep]}/rpc`;

async function rpc(url, method, params) {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
    });
    return res.json();
}

async function waitForChainId(url) {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    let lastErr;
    while (Date.now() < deadline) {
        try {
            const json = await rpc(url, 'eth_chainId', []);
            if (json.result) return;
            lastErr = new Error(JSON.stringify(json));
        } catch (e) {
            lastErr = e;
        }
        await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`${url} not ready within ${READY_TIMEOUT_MS}ms: ${lastErr}`);
}

function dockerRun(args) {
    const result = spawnSync('docker', args, { encoding: 'utf8' });
    if (result.status !== 0) {
        throw new Error(`docker ${args.slice(0, 6).join(' ')}... failed: ${result.stderr || result.stdout}`);
    }
    return result.stdout.trim();
}

function dumpLogs(container, logFile) {
    const fd = fs.openSync(logFile, 'w');
    spawnSync('docker', ['logs', container], { stdio: ['ignore', fd, fd] });
    fs.closeSync(fd);
}

function ensureNetwork() {
    const existing = spawnSync('docker', ['network', 'inspect', NETWORK], { stdio: 'ignore' }).status;
    if (existing !== 0) dockerRun(['network', 'create', NETWORK]);
}

async function latestBlockNumber(rpcUrl) {
    const json = await rpc(rpcUrl, 'eth_blockNumber', []);
    if (!json.result) throw new Error(`eth_blockNumber failed: ${JSON.stringify(json)}`);
    return Number.parseInt(json.result, 16);
}

async function startAnvil(chain) {
    spawnSync('docker', ['rm', '-f', anvilContainer(chain.name)], { stdio: 'ignore' });
    fs.mkdirSync(ANVIL_CACHE_DIR, { recursive: true });
    const forkUrl = forkUrlFor(chain);
    const pinnedBlock = (await latestBlockNumber(forkUrl)) - FORK_BLOCK_OFFSET;
    dockerRun([
        'run', '-d',
        '--name', anvilContainer(chain.name),
        '--network', NETWORK,
        '-p', `${chain.anvilHostPort}:${ANVIL_INTERNAL_PORT}`,
        '-v', `${ANVIL_CACHE_DIR}:/root/.foundry/cache`,
        '--entrypoint', 'anvil',
        ANVIL_IMAGE,
        '--fork-url', forkUrl,
        '--fork-block-number', String(pinnedBlock),
        '--compute-units-per-second', '100',
        '--chain-id', String(chain.chainId),
        '--host', '0.0.0.0',
        '--port', ANVIL_INTERNAL_PORT,
    ]);
}

function startVoltaire(chain, ep, bundlerSecret) {
    const containerName = voltaireContainer(chain.name, ep);
    const hostPort = chain.bundlerHostPortByEntrypoint[ep];
    spawnSync('docker', ['rm', '-f', containerName], { stdio: 'ignore' });
    dockerRun([
        'run', '-d',
        '--name', containerName,
        '--network', NETWORK,
        '-p', `${hostPort}:${VOLTAIRE_INTERNAL_PORT}`,
        VOLTAIRE_IMAGE,
        '--bundler_secret', bundlerSecret,
        '--chain_id', String(chain.chainId),
        '--ethereum_node_url', `http://${anvilContainer(chain.name)}:${ANVIL_INTERNAL_PORT}`,
        '--rpc_url', '0.0.0.0',
        '--rpc_port', VOLTAIRE_INTERNAL_PORT,
        '--disable_p2p', 'y',
        '--unsafe', 'y',
        '--logs_incremental_range', '100',
        '--logs_number_of_ranges', '1',
        '--enforce_gas_price_tolerance', '50',
        '--bundle_gas_estimation_multiplier', '3',
    ]);
}

async function setupChain(chain) {
    await startAnvil(chain);
    try {
        await waitForChainId(anvilHostUrl(chain));
    } catch (e) {
        dumpLogs(anvilContainer(chain.name), path.join(LOG_DIR, `${chain.name}-anvil.log`));
        throw new Error(`[${chain.name}] anvil: ${e.message}`);
    }

    // Each entrypoint gets its own voltaire instance with its own fresh
    // bundler EOA — independent nonce sequences avoid the "nonce too low"
    // races we saw when one EOA handled bundles for every EP version.
    for (const ep of SUPPORTED_ENTRYPOINTS) {
        const bundler = Wallet.createRandom();
        const fund = await rpc(anvilHostUrl(chain), 'anvil_setBalance', [
            bundler.address,
            TEN_ETH_HEX,
        ]);
        if (fund.error) {
            throw new Error(
                `[${chain.name}/${ep}] anvil_setBalance: ${JSON.stringify(fund.error)}`,
            );
        }
        startVoltaire(chain, ep, bundler.privateKey);
        try {
            await waitForChainId(bundlerHostUrl(chain, ep));
        } catch (e) {
            dumpLogs(
                voltaireContainer(chain.name, ep),
                path.join(LOG_DIR, `${chain.name}-voltaire-${ep}.log`),
            );
            throw new Error(`[${chain.name}/${ep}] voltaire: ${e.message}`);
        }
    }
}

module.exports = async function globalSetup() {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    ensureNetwork();

    const results = await Promise.allSettled(chains.map(setupChain));
    const status = chains.map((chain, i) => {
        const r = results[i];
        if (r.status === 'fulfilled') {
            return { name: chain.name, ok: true };
        }
        const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
        console.error(`[integration] ${chain.name} setup failed: ${msg}`);
        return { name: chain.name, ok: false, error: msg };
    });
    fs.writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2));

    const okCount = status.filter((s) => s.ok).length;
    console.log(`[integration] ${okCount}/${chains.length} chains ready (logs: ${LOG_DIR})`);
    if (okCount === 0) {
        throw new Error('all chains failed to start; aborting integration run');
    }
};
