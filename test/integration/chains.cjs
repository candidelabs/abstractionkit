module.exports = [
    {
        name: 'ethereum',
        chainId: 1,
        defaultForkUrl: 'https://ethereum-rpc.publicnode.com',
        forkUrlEnvVar: 'ETHEREUM_RPC',
        anvilHostPort: 8545,
        bundlerHostPort: 3000,
    },
    {
        name: 'optimism',
        chainId: 10,
        defaultForkUrl: 'https://optimism-rpc.publicnode.com',
        forkUrlEnvVar: 'OPTIMISM_RPC',
        anvilHostPort: 8546,
        bundlerHostPort: 3001,
    },
    // arbitrum is intentionally excluded: voltaire's L1 gas estimation calls
    // Arbitrum's NodeInterface precompile (Nitro runtime), which anvil cannot
    // emulate, so eth_sendUserOperation reverts during simulation.
    {
        name: 'base',
        chainId: 8453,
        defaultForkUrl: 'https://mainnet.base.org',
        forkUrlEnvVar: 'BASE_RPC',
        anvilHostPort: 8548,
        bundlerHostPort: 3003,
    },
];
