module.exports = [
    {
        name: 'sepolia',
        chainId: 11155111,
        defaultForkUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
        forkUrlEnvVar: 'SEPOLIA_RPC',
        anvilHostPort: 8545,
        bundlerHostPort: 3000,
    },
    {
        name: 'optimism-sepolia',
        chainId: 11155420,
        defaultForkUrl: 'https://optimism-sepolia-rpc.publicnode.com',
        forkUrlEnvVar: 'OPTIMISM_SEPOLIA_RPC',
        anvilHostPort: 8546,
        bundlerHostPort: 3001,
    },
    // arbitrum-sepolia is intentionally excluded: voltaire's L1 gas estimation
    // calls Arbitrum's NodeInterface precompile (Nitro runtime), which anvil
    // cannot emulate, so eth_sendUserOperation reverts during simulation.
    {
        name: 'base-sepolia',
        chainId: 84532,
        defaultForkUrl: 'https://base-sepolia-rpc.publicnode.com',
        forkUrlEnvVar: 'BASE_SEPOLIA_RPC',
        anvilHostPort: 8548,
        bundlerHostPort: 3003,
    },
];
