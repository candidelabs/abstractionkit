const { spawnSync } = require('node:child_process');
const chains = require('./chains.cjs');

const NETWORK = 'abstractionkit-integration';

module.exports = async function globalTeardown() {
    const containers = chains.flatMap((c) => [
        `abstractionkit-anvil-${c.name}`,
        `abstractionkit-voltaire-${c.name}`,
    ]);
    spawnSync('docker', ['rm', '-f', ...containers], { stdio: 'ignore' });
    spawnSync('docker', ['network', 'rm', NETWORK], { stdio: 'ignore' });
};
