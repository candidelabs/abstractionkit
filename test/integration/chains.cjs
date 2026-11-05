// Each chain runs one anvil + one voltaire instance per supported entrypoint
// (v6 / v7 / v8 / v9). Splitting bundlers per entrypoint gives each its own
// bundler EOA, so handleOps txes for different EP versions don't share a
// nonce sequence — which removes the "nonce too low" races we saw when many
// parallel userops funnel through a single bundler.
module.exports = [
    {
        name: 'ethereum',
        chainId: 1,
        defaultForkUrl: 'https://ethereum-rpc.publicnode.com',
        forkUrlEnvVar: 'ETHEREUM_RPC',
        anvilHostPort: 8545,
        bundlerHostPortByEntrypoint: { v6: 3000, v7: 3001, v8: 3003, v9: 3002 },
    },
    {
        name: 'optimism',
        chainId: 10,
        defaultForkUrl: 'https://optimism-rpc.publicnode.com',
        forkUrlEnvVar: 'OPTIMISM_RPC',
        anvilHostPort: 8546,
        bundlerHostPortByEntrypoint: { v6: 3010, v7: 3011, v8: 3013, v9: 3012 },
    },
    // arbitrum is intentionally excluded: voltaire's L1 gas estimation calls
    // Arbitrum's NodeInterface precompile (Nitro runtime), which anvil cannot
    // emulate, so eth_sendUserOperation reverts during simulation.
];
