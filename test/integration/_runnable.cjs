require('dotenv').config();
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const chains = require('./chains.cjs');

const STATUS_FILE = path.join(os.tmpdir(), 'abstractionkit-integration-status.json');
const okByName = Object.fromEntries(
    JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8')).map((s) => [s.name, s.ok === true]),
);

const {
    SafeAccountV0_2_0,
    SafeAccountV0_3_0,
    SafeAccountV1_5_0_M_0_3_0,
    SafeMultiChainSigAccountV1,
} = require('../../dist/index.cjs');
const { SUPPORTED_ENTRYPOINTS } = require('./_entrypoints.cjs');

// `entrypoint` selects which per-chain voltaire instance to route through —
// each (chain × entrypoint) pair has its own bundler EOA and so its own nonce
// sequence. V0_3_0 and V1_5_0_M_0_3_0 share v7, which is fine; they don't race
// against V0_2_0 (v6) or MultiChainSigV1 (v9).
const accountVersions = [
    { name: 'V0_2_0', accountClass: SafeAccountV0_2_0, entrypoint: 'v6' },
    { name: 'V0_3_0', accountClass: SafeAccountV0_3_0, entrypoint: 'v7' },
    { name: 'V1_5_0_M_0_3_0', accountClass: SafeAccountV1_5_0_M_0_3_0, entrypoint: 'v7' },
    { name: 'MultiChainSigV1', accountClass: SafeMultiChainSigAccountV1, entrypoint: 'v9' },
];

const runnable = chains.filter((c) => okByName[c.name]);
const unrunnable = chains.filter((c) => !okByName[c.name]);

const runnableMatrix = (versions = accountVersions) =>
    runnable.flatMap((chain) =>
        versions.map((v) => ({
            ...chain,
            chainName: chain.name,
            accountClass: v.accountClass,
            accountVersion: v.name,
            entrypoint: v.entrypoint,
        })),
    );

module.exports = {
    chains,
    runnable,
    unrunnable,
    accountVersions,
    runnableMatrix,
    SUPPORTED_ENTRYPOINTS,
    nodeUrl: (entry) => `http://127.0.0.1:${entry.anvilHostPort}`,
    bundlerUrl: (entry) => {
        const ep = entry.entrypoint ?? 'v7';
        return `http://127.0.0.1:${entry.bundlerHostPortByEntrypoint[ep]}/rpc`;
    },
};
