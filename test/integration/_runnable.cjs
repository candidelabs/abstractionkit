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

const accountVersions = [
    { name: 'V0_2_0', accountClass: SafeAccountV0_2_0 },
    { name: 'V0_3_0', accountClass: SafeAccountV0_3_0 },
    { name: 'V1_5_0_M_0_3_0', accountClass: SafeAccountV1_5_0_M_0_3_0 },
    { name: 'MultiChainSigV1', accountClass: SafeMultiChainSigAccountV1 },
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
        })),
    );

module.exports = {
    chains,
    runnable,
    unrunnable,
    accountVersions,
    runnableMatrix,
    nodeUrl: (entry) => `http://127.0.0.1:${entry.anvilHostPort}`,
    bundlerUrl: (entry) => `http://127.0.0.1:${entry.bundlerHostPort}/rpc`,
};
