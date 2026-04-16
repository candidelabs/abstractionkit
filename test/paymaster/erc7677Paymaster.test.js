const http = require('node:http');
const { Erc7677Paymaster } = require('../../dist/index.cjs');

jest.setTimeout(30000);

/**
 * Spin up a local HTTP server that responds to a scripted sequence of
 * JSON-RPC calls. The paymaster class has no network knowledge beyond the
 * RPC URL we hand it, so a tiny loopback server is enough to cover the
 * happy path + every branch of the flow.
 */
function makeMockRpcServer(handlers) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const { method, params, id } = JSON.parse(body);
      calls.push({ method, params });
      const handler = handlers[method];
      const payload = handler == null
        ? { id, jsonrpc: '2.0', error: { code: -32601, message: `no mock for ${method}` } }
        : { id, jsonrpc: '2.0', result: handler(params) };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        calls,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

function v7UserOp(overrides = {}) {
  return {
    sender: '0x' + '1'.repeat(40),
    nonce: 0n,
    callData: '0x',
    callGasLimit: 0n,
    verificationGasLimit: 0n,
    preVerificationGas: 0n,
    maxFeePerGas: 1_000_000_000n,
    maxPriorityFeePerGas: 100_000_000n,
    signature: '0x',
    factory: null,
    factoryData: null,
    paymaster: null,
    paymasterVerificationGasLimit: null,
    paymasterPostOpGasLimit: null,
    paymasterData: null,
    ...overrides,
  };
}

const CHAIN_ID_HEX = '0x1';
const ENTRYPOINT_V7 = '0x0000000071727De22E5E9d8BAf0edAc6f37da032';

describe('Erc7677Paymaster', () => {
  test('createPaymasterUserOperation runs stub → estimate → final', async () => {
    const server = await makeMockRpcServer({
      pm_getPaymasterStubData: () => ({
        paymaster: '0xPaymaster'.padEnd(42, '0'),
        paymasterData: '0xabcd',
        paymasterVerificationGasLimit: '0x8000',
        paymasterPostOpGasLimit: '0x1', // placeholder — bundler returns real
      }),
      eth_estimateUserOperationGas: () => ({
        callGasLimit: '0x1000',
        verificationGasLimit: '0x2000',
        preVerificationGas: '0x3000',
        paymasterVerificationGasLimit: '0x9999',
        paymasterPostOpGasLimit: '0xa000',
      }),
      pm_getPaymasterData: () => ({
        paymaster: '0xPaymaster'.padEnd(42, '0'),
        paymasterData: '0xfinal',
        paymasterVerificationGasLimit: '0x9999',
        paymasterPostOpGasLimit: '0xa000',
      }),
    });

    try {
      const paymaster = new Erc7677Paymaster(server.url, { chainId: CHAIN_ID_HEX });
      const smartAccount = { entrypointAddress: ENTRYPOINT_V7 };
      const userOp = v7UserOp();
      const context = { sponsorshipPolicyId: 'sp_test' };

      const out = await paymaster.createPaymasterUserOperation(
        smartAccount,
        userOp,
        server.url,
        context,
      );

      // Final paymaster fields populated from pm_getPaymasterData.
      expect(out.paymasterData).toBe('0xfinal');
      // Bundler gas limits applied (with default 5%/10%/10% multipliers).
      expect(out.preVerificationGas).toBe(0x3000n + (0x3000n * 500n) / 10000n);
      expect(out.verificationGasLimit).toBe(0x2000n + (0x2000n * 1000n) / 10000n);
      expect(out.callGasLimit).toBe(0x1000n + (0x1000n * 1000n) / 10000n);
      // Paymaster gas fields taken from bundler estimation, not the stub placeholder.
      expect(out.paymasterPostOpGasLimit).toBe(0xa000n);
      expect(out.paymasterVerificationGasLimit).toBe(0x9999n);

      // Input was not mutated.
      expect(userOp.paymasterData).toBe(null);

      // Call order: stub → estimate → final.
      const methods = server.calls.map((c) => c.method);
      expect(methods).toEqual([
        'pm_getPaymasterStubData',
        'eth_estimateUserOperationGas',
        'pm_getPaymasterData',
      ]);

      // Context forwarded verbatim.
      expect(server.calls[0].params[3]).toEqual(context);
      expect(server.calls[2].params[3]).toEqual(context);
    } finally {
      await server.close();
    }
  });

  test('stub with isFinal: true skips pm_getPaymasterData', async () => {
    const server = await makeMockRpcServer({
      pm_getPaymasterStubData: () => ({
        paymaster: '0xPaymaster'.padEnd(42, '0'),
        paymasterData: '0xonly',
        paymasterVerificationGasLimit: '0x8000',
        paymasterPostOpGasLimit: '0xa000',
        isFinal: true,
      }),
      eth_estimateUserOperationGas: () => ({
        callGasLimit: '0x1000',
        verificationGasLimit: '0x2000',
        preVerificationGas: '0x3000',
      }),
    });

    try {
      const paymaster = new Erc7677Paymaster(server.url, { chainId: CHAIN_ID_HEX });
      const out = await paymaster.createPaymasterUserOperation(
        { entrypointAddress: ENTRYPOINT_V7 },
        v7UserOp(),
        server.url,
      );

      expect(out.paymasterData).toBe('0xonly');
      const methods = server.calls.map((c) => c.method);
      expect(methods).toEqual(['pm_getPaymasterStubData', 'eth_estimateUserOperationGas']);
    } finally {
      await server.close();
    }
  });

  test('forwards provider-specific context verbatim', async () => {
    let stubContext = null;
    const server = await makeMockRpcServer({
      pm_getPaymasterStubData: (params) => {
        stubContext = params[3];
        return {
          paymaster: '0xPaymaster'.padEnd(42, '0'),
          paymasterData: '0x',
          paymasterVerificationGasLimit: '0x8000',
          paymasterPostOpGasLimit: '0xa000',
          isFinal: true,
        };
      },
      eth_estimateUserOperationGas: () => ({
        callGasLimit: '0x1000',
        verificationGasLimit: '0x2000',
        preVerificationGas: '0x3000',
      }),
    });

    try {
      const paymaster = new Erc7677Paymaster(server.url, { chainId: CHAIN_ID_HEX });
      const context = { token: '0xUsdt', custom: { nested: 'value' } };
      await paymaster.createPaymasterUserOperation(
        { entrypointAddress: ENTRYPOINT_V7 },
        v7UserOp(),
        server.url,
        context,
      );
      expect(stubContext).toEqual(context);
    } finally {
      await server.close();
    }
  });

  test('paymaster RPC error surfaces as AbstractionKitError', async () => {
    const server = await makeMockRpcServer({});
    try {
      const paymaster = new Erc7677Paymaster(server.url, { chainId: CHAIN_ID_HEX });
      await expect(
        paymaster.createPaymasterUserOperation(
          { entrypointAddress: ENTRYPOINT_V7 },
          v7UserOp(),
          server.url,
        ),
      ).rejects.toThrow(/pm_getPaymasterStubData failed/);
    } finally {
      await server.close();
    }
  });

  test('getPaymasterStubData and getPaymasterData can be called independently', async () => {
    const server = await makeMockRpcServer({
      pm_getPaymasterStubData: () => ({ paymaster: '0xPaymaster'.padEnd(42, '0') }),
      pm_getPaymasterData: () => ({ paymaster: '0xPaymaster'.padEnd(42, '0'), paymasterData: '0xfinal' }),
    });
    try {
      const paymaster = new Erc7677Paymaster(server.url);
      const userOp = v7UserOp();
      const stub = await paymaster.getPaymasterStubData(userOp, ENTRYPOINT_V7, CHAIN_ID_HEX, {});
      expect(stub.paymaster).toMatch(/^0xPaymaster/);
      const final = await paymaster.getPaymasterData(userOp, ENTRYPOINT_V7, CHAIN_ID_HEX, {});
      expect(final.paymasterData).toBe('0xfinal');
    } finally {
      await server.close();
    }
  });
});
