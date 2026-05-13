const { spawnSync } = require('node:child_process');
const chains = require('./chains.cjs');
const { SUPPORTED_ENTRYPOINTS } = require('./_entrypoints.cjs');

const NETWORK = 'abstractionkit-integration';

module.exports = async function globalTeardown() {
    const containers = chains.flatMap((c) => [
        `abstractionkit-anvil-${c.name}`,
        ...SUPPORTED_ENTRYPOINTS.map((ep) => `abstractionkit-voltaire-${c.name}-${ep}`),
    ]);
    spawnSync('docker', ['rm', '-f', ...containers], { stdio: 'ignore' });
    spawnSync('docker', ['network', 'rm', NETWORK], { stdio: 'ignore' });
};
