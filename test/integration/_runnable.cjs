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
    Calibur7702Account,
    Simple7702Account,
    Simple7702AccountV09,
} = require('../../dist/index.cjs');
const { SUPPORTED_ENTRYPOINTS } = require('./_entrypoints.cjs');

// `entrypoint` selects which per-chain voltaire instance to route through —
// each (chain × entrypoint) pair has its own bundler EOA and so its own nonce
// sequence. V0_3_0 and V1_5_0_M_0_3_0 share v7, and MultiChainSigV1 and
// SimpleAccountV09 share v9; voltaire serialises bundles per instance so the
// shared EOA's nonce sequence is fine. v8 is used only by the 7702 accounts.
//
// `isSafeMultiSig` flags accounts that use Safe's multi-owner calling
// convention — `Account.initializeNewAccount([owner])` and
// `signUserOperation(userOp, [pk], chainId)`. Accounts without the flag (the
// 7702 ones) construct from a single EOA address, take a single private key,
// and need an eip7702Auth in the first userOp to delegate the EOA. Tests that
// share a flow across both branch on the flag inline; tests that exercise
// Safe-only surfaces filter the matrix down to `isSafeMultiSig` entries.
const accountVersions = [
    { name: 'V0_2_0', accountClass: SafeAccountV0_2_0, entrypoint: 'v6', isSafeMultiSig: true },
    { name: 'V0_3_0', accountClass: SafeAccountV0_3_0, entrypoint: 'v7', isSafeMultiSig: true },
    { name: 'V1_5_0_M_0_3_0', accountClass: SafeAccountV1_5_0_M_0_3_0, entrypoint: 'v7', isSafeMultiSig: true },
    { name: 'MultiChainSigV1', accountClass: SafeMultiChainSigAccountV1, entrypoint: 'v9', isSafeMultiSig: true },
    { name: 'Calibur', accountClass: Calibur7702Account, entrypoint: 'v8' },
    { name: 'SimpleAccount', accountClass: Simple7702Account, entrypoint: 'v8' },
    { name: 'SimpleAccountV09', accountClass: Simple7702AccountV09, entrypoint: 'v9' },
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
            isSafeMultiSig: v.isSafeMultiSig === true,
        })),
    );

// Tests that exercise Safe-only surfaces (multi-owner factory options, multi-
// key signing, Safe-specific signature wrappers) skip the 7702 entries.
const safeMultiSigMatrix = () =>
    runnableMatrix(accountVersions.filter((v) => v.isSafeMultiSig));

module.exports = {
    chains,
    runnable,
    unrunnable,
    accountVersions,
    runnableMatrix,
    safeMultiSigMatrix,
    SUPPORTED_ENTRYPOINTS,
    nodeUrl: (entry) => `http://127.0.0.1:${entry.anvilHostPort}`,
    bundlerUrl: (entry) => {
        const ep = entry.entrypoint ?? 'v7';
        return `http://127.0.0.1:${entry.bundlerHostPortByEntrypoint[ep]}/rpc`;
    },
};
