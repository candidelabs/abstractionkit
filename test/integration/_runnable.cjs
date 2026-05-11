require('dotenv').config();
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const chains = require('./chains.cjs');

const STATUS_FILE = path.join(os.tmpdir(), 'abstractionkit-integration-status.json');
const okByName = Object.fromEntries(
    JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8')).map((s) => [s.name, s.ok === true]),
);

module.exports = {
    chains,
    runnable: chains.filter((c) => okByName[c.name]),
    unrunnable: chains.filter((c) => !okByName[c.name]),
    nodeUrl: (chain) => `http://127.0.0.1:${chain.anvilHostPort}`,
    bundlerUrl: (chain) => `http://127.0.0.1:${chain.bundlerHostPort}/rpc`,
};
