const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const FORK_URL = 'https://ethereum-sepolia-rpc.publicnode.com';
const CHAIN_ID = '11155111';
const HOST = '127.0.0.1';
const PORT = '8545';
const READY_TIMEOUT_MS = 30000;
const PID_FILE = path.join(os.tmpdir(), 'abstractionkit-anvil.pid');

async function probe() {
    try {
        const res = await fetch(`http://${HOST}:${PORT}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 1 }),
        });
        const json = await res.json();
        return 'result' in json;
    } catch {
        return false;
    }
}

module.exports = async function globalSetup() {
    const logPath = path.join(os.tmpdir(), 'abstractionkit-anvil.log');
    const out = fs.openSync(logPath, 'w');
    const child = spawn(
        'anvil',
        ['--fork-url', FORK_URL, '--chain-id', CHAIN_ID, '--host', HOST, '--port', PORT],
        { detached: true, stdio: ['ignore', out, out] },
    );
    child.unref();
    fs.writeFileSync(PID_FILE, String(child.pid));

    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
        if (await probe()) return;
        await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`anvil did not become ready within ${READY_TIMEOUT_MS}ms (see ${logPath})`);
};
