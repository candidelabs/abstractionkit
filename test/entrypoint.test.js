const accountAbstractionkit = require('../dist/index.umd');
require('dotenv').config()

jest.setTimeout(300000);
const address=process.env.PUBLIC_ADDRESS1 || "0x0000000000000000000000000000000000000001"
const jsonRpcNodeProvider=process.env.SEPOLIA_RPC || "https://ethereum-sepolia-rpc.publicnode.com";

const entrypoints = [
    "0x0000000071727de22e5e9d8baf0edac6f37da032",
    "0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789"
]

const skipReason = !jsonRpcNodeProvider ? "No RPC provider configured (set JSON_RPC_NODE_PROVIDER or SEPOLIA_RPC)" : null;

describe('deposit info and balance of address', () => {
    entrypoints.forEach((entrypoint) => {
        const testFn = skipReason ? test.skip : test;
        testFn('check deposit info and balance are equal and types for entrypoint: ' + entrypoint, async () => {
            const depositInfo = await accountAbstractionkit.getDepositInfo(
                jsonRpcNodeProvider, address, entrypoint);
            const balance = await accountAbstractionkit.getBalanceOf(
                jsonRpcNodeProvider, address, entrypoint);
            
            expect(depositInfo["deposit"]).toStrictEqual(balance);
            expect(typeof depositInfo["deposit"]).toBe("bigint");
            expect(typeof depositInfo["staked"]).toBe("boolean");
            expect(typeof depositInfo["stake"]).toBe("bigint");
            expect(typeof depositInfo["unstakeDelaySec"]).toBe("bigint");
            expect(typeof depositInfo["withdrawTime"]).toBe("bigint");
        });
    });
});
