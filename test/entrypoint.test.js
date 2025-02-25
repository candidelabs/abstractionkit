const accountAbstractionkit = require('../dist/index.umd');
require('dotenv').config()

jest.setTimeout(300000);
const address=process.env.PUBLIC_ADDRESS1
const jsonRpcNodeProvider=process.env.JSON_RPC_NODE_PROVIDER

const entrypoints = [
    "0x0000000071727de22e5e9d8baf0edac6f37da032",
    "0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789"
]

describe('deposit info and balance of address', () => {
    entrypoints.forEach((entrypoint) => {
        test('check deposit info and balance are equal and types for entrypoint: ' + entrypoint, async () => {
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
