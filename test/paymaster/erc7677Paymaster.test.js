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
const CHAIN_ID = 1n;
const ENTRYPOINT_V7 = '0x0000000071727De22E5E9d8BAf0edAc6f37da032';

/**
 * Minimal smart account that implements prependTokenPaymasterApproveToCallData.
 * Tracks calls for assertion purposes.
 */
function makeTokenAccount(entrypoint) {
  const calls = [];
  return {
    entrypointAddress: entrypoint,
    calls,
    prependTokenPaymasterApproveToCallData(callData, tokenAddress, paymasterAddress, approveAmount) {
      calls.push({ callData, tokenAddress, paymasterAddress, approveAmount });
      // Simple simulation: prefix a marker so we can verify the call happened.
      // In the real code this would re-encode MultiSend calldata.
      const marker = `approve(${paymasterAddress},${approveAmount.toString(16)})`;
      return `${callData}::${marker}`;
    },
  };
}

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
      const paymaster = new Erc7677Paymaster(server.url, { chainId: CHAIN_ID });
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
      const paymaster = new Erc7677Paymaster(server.url, { chainId: CHAIN_ID });
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
      const paymaster = new Erc7677Paymaster(server.url, { chainId: CHAIN_ID });
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
      const paymaster = new Erc7677Paymaster(server.url, { chainId: CHAIN_ID });
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

  // ── Provider detection ──────────────────────────────────────────────

  test('auto-detects pimlico provider from URL', () => {
    const paymaster = new Erc7677Paymaster('https://api.pimlico.io/v2/sepolia/rpc?apikey=test');
    expect(paymaster.provider).toBe('pimlico');
  });

  test('auto-detects candide provider from URL', () => {
    const paymaster = new Erc7677Paymaster('https://api.candide.dev/paymaster/v3/sepolia/xxx');
    expect(paymaster.provider).toBe('candide');
  });

  test('auto-detects null for unknown URL', () => {
    const paymaster = new Erc7677Paymaster('https://custom-rpc.example.com');
    expect(paymaster.provider).toBe(null);
  });

  test('auto-detect ignores provider name in path (proxy false-positive)', () => {
    const paymaster = new Erc7677Paymaster('https://my-proxy.com/pimlico-compat/rpc');
    expect(paymaster.provider).toBe(null);
  });

  test('auto-detect ignores provider name in hostname suffix without dot delimiter', () => {
    // evilpimlico.io ends with "pimlico.io" but is not a pimlico subdomain.
    const paymaster = new Erc7677Paymaster('https://evilpimlico.io/rpc');
    expect(paymaster.provider).toBe(null);
  });

  test('auto-detect handles malformed URL by returning null', () => {
    const paymaster = new Erc7677Paymaster('not-a-valid-url');
    expect(paymaster.provider).toBe(null);
  });

  test('explicit provider overrides auto-detection', () => {
    const paymaster = new Erc7677Paymaster('https://api.pimlico.io/v2/sepolia/rpc', { provider: null });
    expect(paymaster.provider).toBe(null);
  });

  test('explicit provider on non-matching URL', () => {
    const paymaster = new Erc7677Paymaster('https://custom-proxy.example.com', { provider: 'pimlico' });
    expect(paymaster.provider).toBe('pimlico');
  });

  // ── sendRPCRequest ──────────────────────────────────────────────────

  test('sendRPCRequest forwards method and params', async () => {
    const server = await makeMockRpcServer({
      custom_method: (params) => ({ echo: params }),
    });
    try {
      const paymaster = new Erc7677Paymaster(server.url);
      const result = await paymaster.sendRPCRequest('custom_method', ['arg1', 'arg2']);
      expect(result).toEqual({ echo: ['arg1', 'arg2'] });
      expect(server.calls[0].method).toBe('custom_method');
      expect(server.calls[0].params).toEqual(['arg1', 'arg2']);
    } finally {
      await server.close();
    }
  });

  test('sendRPCRequest wraps errors as AbstractionKitError', async () => {
    const server = await makeMockRpcServer({});
    try {
      const paymaster = new Erc7677Paymaster(server.url);
      await expect(
        paymaster.sendRPCRequest('nonexistent_method'),
      ).rejects.toThrow(/sendRPCRequest\(nonexistent_method\) failed/);
    } finally {
      await server.close();
    }
  });

  // ── Token paymaster flow: Case A (Pimlico provider) ─────────────────

  test('Case A: pimlico provider runs full token flow', async () => {
    const PAYMASTER_ADDR = '0x' + 'aa'.repeat(20);
    const TOKEN_ADDR = '0x' + 'bb'.repeat(20);
    const EXCHANGE_RATE = '0xde0b6b3a7640000'; // 1e18

    const server = await makeMockRpcServer({
      pimlico_getTokenQuotes: () => ({
        quotes: [{
          paymaster: PAYMASTER_ADDR,
          token: TOKEN_ADDR,
          exchangeRate: EXCHANGE_RATE,
          postOpGas: '0x1000',
        }],
      }),
      pm_getPaymasterStubData: () => ({
        paymaster: PAYMASTER_ADDR,
        paymasterData: '0xstub',
        paymasterVerificationGasLimit: '0x8000',
        paymasterPostOpGasLimit: '0x1',
      }),
      eth_estimateUserOperationGas: () => ({
        callGasLimit: '0x1000',
        verificationGasLimit: '0x2000',
        preVerificationGas: '0x3000',
        paymasterVerificationGasLimit: '0x9999',
        paymasterPostOpGasLimit: '0xa000',
      }),
      pm_getPaymasterData: () => ({
        paymaster: PAYMASTER_ADDR,
        paymasterData: '0xfinaltoken',
      }),
    });

    try {
      const paymaster = new Erc7677Paymaster(server.url, { chainId: CHAIN_ID, provider: 'pimlico' });
      const smartAccount = makeTokenAccount(ENTRYPOINT_V7);
      const userOp = v7UserOp();

      const out = await paymaster.createPaymasterUserOperation(
        smartAccount,
        userOp,
        server.url,
        { token: TOKEN_ADDR },
      );

      // Call order: pimlico_getTokenQuotes → stub → estimate → final.
      const methods = server.calls.map((c) => c.method);
      expect(methods).toEqual([
        'pimlico_getTokenQuotes',
        'pm_getPaymasterStubData',
        'eth_estimateUserOperationGas',
        'pm_getPaymasterData',
      ]);

      // Final paymaster data applied.
      expect(out.paymasterData).toBe('0xfinaltoken');

      // prependTokenPaymasterApproveToCallData was called (first with MAX, then with calculated).
      expect(smartAccount.calls.length).toBeGreaterThanOrEqual(2);

      // Input not mutated.
      expect(userOp.paymasterData).toBe(null);
    } finally {
      await server.close();
    }
  });

  // ── Token paymaster flow: Case A (Candide provider) ─────────────────

  test('Case A: candide provider runs full token flow', async () => {
    const PAYMASTER_ADDR = '0x' + 'cc'.repeat(20);
    const TOKEN_ADDR = '0x' + 'dd'.repeat(20);

    const server = await makeMockRpcServer({
      pm_supportedERC20Tokens: () => ({
        tokens: [{ address: TOKEN_ADDR, exchangeRate: '0xde0b6b3a7640000' }],
        paymasterMetadata: {
          address: PAYMASTER_ADDR,
          dummyPaymasterAndData: {
            paymaster: PAYMASTER_ADDR,
            paymasterVerificationGasLimit: '0x8000',
            paymasterPostOpGasLimit: '0xa000',
            paymasterData: '0xdummydata',
          },
        },
      }),
      eth_estimateUserOperationGas: () => ({
        callGasLimit: '0x1000',
        verificationGasLimit: '0x2000',
        preVerificationGas: '0x3000',
      }),
      pm_getPaymasterData: () => ({
        paymaster: PAYMASTER_ADDR,
        paymasterData: '0xfinalcandide',
      }),
    });

    try {
      const paymaster = new Erc7677Paymaster(server.url, { chainId: CHAIN_ID, provider: 'candide' });
      const smartAccount = makeTokenAccount(ENTRYPOINT_V7);
      const userOp = v7UserOp();

      const out = await paymaster.createPaymasterUserOperation(
        smartAccount,
        userOp,
        server.url,
        { token: TOKEN_ADDR },
      );

      // Call order: pm_supportedERC20Tokens → estimate → final.
      // No pm_getPaymasterStubData — stub data comes from the cached response.
      const methods = server.calls.map((c) => c.method);
      expect(methods).toEqual([
        'pm_supportedERC20Tokens',
        'eth_estimateUserOperationGas',
        'pm_getPaymasterData',
      ]);

      expect(out.paymasterData).toBe('0xfinalcandide');
      expect(smartAccount.calls.length).toBeGreaterThanOrEqual(2);
    } finally {
      await server.close();
    }
  });

  // ── Candide sponsored flow: skips pm_getPaymasterStubData ──────────

  test('Candide provider: sponsored flow skips pm_getPaymasterStubData', async () => {
    const PAYMASTER_ADDR = '0x' + 'cc'.repeat(20);

    const server = await makeMockRpcServer({
      pm_supportedERC20Tokens: () => ({
        tokens: [],
        paymasterMetadata: {
          address: PAYMASTER_ADDR,
          dummyPaymasterAndData: {
            paymaster: PAYMASTER_ADDR,
            paymasterVerificationGasLimit: '0x8000',
            paymasterPostOpGasLimit: '0xa000',
            paymasterData: '0xdummydata',
          },
        },
      }),
      eth_estimateUserOperationGas: () => ({
        callGasLimit: '0x1000',
        verificationGasLimit: '0x2000',
        preVerificationGas: '0x3000',
      }),
      pm_getPaymasterData: () => ({
        paymaster: PAYMASTER_ADDR,
        paymasterData: '0xfinalsponsored',
      }),
    });

    try {
      const paymaster = new Erc7677Paymaster(server.url, { chainId: CHAIN_ID, provider: 'candide' });
      const out = await paymaster.createPaymasterUserOperation(
        { entrypointAddress: ENTRYPOINT_V7 },
        v7UserOp(),
        server.url,
      );

      // Call order: pm_supportedERC20Tokens → estimate → final.
      // Skips pm_getPaymasterStubData by deriving stub from the cached response.
      const methods = server.calls.map((c) => c.method);
      expect(methods).toEqual([
        'pm_supportedERC20Tokens',
        'eth_estimateUserOperationGas',
        'pm_getPaymasterData',
      ]);
      expect(out.paymasterData).toBe('0xfinalsponsored');
    } finally {
      await server.close();
    }
  });

  // ── Candide TTL: token flow re-fetches after 45s ────────────────────

  test('Candide provider: token flow re-fetches pm_supportedERC20Tokens after TTL', async () => {
    const PAYMASTER_ADDR = '0x' + 'cc'.repeat(20);
    const TOKEN_ADDR = '0x' + 'dd'.repeat(20);

    const server = await makeMockRpcServer({
      pm_supportedERC20Tokens: () => ({
        tokens: [{ address: TOKEN_ADDR, exchangeRate: '0xde0b6b3a7640000' }],
        paymasterMetadata: {
          address: PAYMASTER_ADDR,
          dummyPaymasterAndData: {
            paymaster: PAYMASTER_ADDR,
            paymasterVerificationGasLimit: '0x8000',
            paymasterPostOpGasLimit: '0xa000',
            paymasterData: '0xdummydata',
          },
        },
      }),
      eth_estimateUserOperationGas: () => ({
        callGasLimit: '0x1000',
        verificationGasLimit: '0x2000',
        preVerificationGas: '0x3000',
      }),
      pm_getPaymasterData: () => ({
        paymaster: PAYMASTER_ADDR,
        paymasterData: '0xfinal',
      }),
    });

    jest.useFakeTimers({ doNotFake: ['setTimeout', 'setInterval', 'setImmediate', 'clearTimeout', 'clearInterval', 'clearImmediate', 'nextTick', 'queueMicrotask'] });
    jest.setSystemTime(new Date('2024-01-01T00:00:00Z'));

    try {
      const paymaster = new Erc7677Paymaster(server.url, { chainId: CHAIN_ID, provider: 'candide' });
      const smartAccount = makeTokenAccount(ENTRYPOINT_V7);

      // 1st token flow call — fetches pm_supportedERC20Tokens.
      await paymaster.createPaymasterUserOperation(
        smartAccount,
        v7UserOp(),
        server.url,
        { token: TOKEN_ADDR },
      );

      // Advance time past the 45s TTL.
      jest.setSystemTime(new Date('2024-01-01T00:00:46Z'));

      // 2nd token flow call — TTL expired, should re-fetch.
      await paymaster.createPaymasterUserOperation(
        smartAccount,
        v7UserOp(),
        server.url,
        { token: TOKEN_ADDR },
      );

      const supportedCalls = server.calls.filter((c) => c.method === 'pm_supportedERC20Tokens');
      expect(supportedCalls.length).toBe(2);
    } finally {
      jest.useRealTimers();
      await server.close();
    }
  });

  test('Candide provider: sponsored flow uses cache indefinitely (ignores TTL)', async () => {
    const PAYMASTER_ADDR = '0x' + 'cc'.repeat(20);
    const TOKEN_ADDR = '0x' + 'dd'.repeat(20);

    const server = await makeMockRpcServer({
      pm_supportedERC20Tokens: () => ({
        tokens: [{ address: TOKEN_ADDR, exchangeRate: '0xde0b6b3a7640000' }],
        paymasterMetadata: {
          address: PAYMASTER_ADDR,
          dummyPaymasterAndData: {
            paymaster: PAYMASTER_ADDR,
            paymasterVerificationGasLimit: '0x8000',
            paymasterPostOpGasLimit: '0xa000',
            paymasterData: '0xdummydata',
          },
        },
      }),
      eth_estimateUserOperationGas: () => ({
        callGasLimit: '0x1000',
        verificationGasLimit: '0x2000',
        preVerificationGas: '0x3000',
      }),
      pm_getPaymasterData: () => ({
        paymaster: PAYMASTER_ADDR,
        paymasterData: '0xfinal',
      }),
    });

    jest.useFakeTimers({ doNotFake: ['setTimeout', 'setInterval', 'setImmediate', 'clearTimeout', 'clearInterval', 'clearImmediate', 'nextTick', 'queueMicrotask'] });
    jest.setSystemTime(new Date('2024-01-01T00:00:00Z'));

    try {
      const paymaster = new Erc7677Paymaster(server.url, { chainId: CHAIN_ID, provider: 'candide' });

      // 1st sponsored call — fetches pm_supportedERC20Tokens for stub data.
      await paymaster.createPaymasterUserOperation(
        { entrypointAddress: ENTRYPOINT_V7 },
        v7UserOp(),
        server.url,
      );

      // Advance time far past TTL.
      jest.setSystemTime(new Date('2024-01-01T01:00:00Z'));

      // 2nd sponsored call — TTL does NOT apply, reuses cache.
      await paymaster.createPaymasterUserOperation(
        { entrypointAddress: ENTRYPOINT_V7 },
        v7UserOp(),
        server.url,
      );

      const supportedCalls = server.calls.filter((c) => c.method === 'pm_supportedERC20Tokens');
      expect(supportedCalls.length).toBe(1);
    } finally {
      jest.useRealTimers();
      await server.close();
    }
  });

  // ── Candide: single pm_supportedERC20Tokens call for combined flow ──

  test('Candide provider: only one pm_supportedERC20Tokens call (cached)', async () => {
    const PAYMASTER_ADDR = '0x' + 'cc'.repeat(20);
    const TOKEN_ADDR = '0x' + 'dd'.repeat(20);

    const server = await makeMockRpcServer({
      pm_supportedERC20Tokens: () => ({
        tokens: [{ address: TOKEN_ADDR, exchangeRate: '0xde0b6b3a7640000' }],
        paymasterMetadata: {
          address: PAYMASTER_ADDR,
          dummyPaymasterAndData: {
            paymaster: PAYMASTER_ADDR,
            paymasterVerificationGasLimit: '0x8000',
            paymasterPostOpGasLimit: '0xa000',
            paymasterData: '0xdummydata',
          },
        },
      }),
      eth_estimateUserOperationGas: () => ({
        callGasLimit: '0x1000',
        verificationGasLimit: '0x2000',
        preVerificationGas: '0x3000',
      }),
      pm_getPaymasterData: () => ({
        paymaster: PAYMASTER_ADDR,
        paymasterData: '0xfinal',
      }),
    });

    try {
      const paymaster = new Erc7677Paymaster(server.url, { chainId: CHAIN_ID, provider: 'candide' });
      const smartAccount = makeTokenAccount(ENTRYPOINT_V7);

      await paymaster.createPaymasterUserOperation(
        smartAccount,
        v7UserOp(),
        server.url,
        { token: TOKEN_ADDR },
      );

      // Token quote + stub data both come from a SINGLE pm_supportedERC20Tokens call.
      const supportedCalls = server.calls.filter((c) => c.method === 'pm_supportedERC20Tokens');
      expect(supportedCalls.length).toBe(1);
    } finally {
      await server.close();
    }
  });

  // ── Token paymaster flow: Case B (exchangeRate in context) ──────────

  test('Case B: no provider, exchangeRate in context runs token flow', async () => {
    const PAYMASTER_ADDR = '0x' + 'ee'.repeat(20);
    const TOKEN_ADDR = '0x' + 'ff'.repeat(20);

    const server = await makeMockRpcServer({
      pm_getPaymasterStubData: () => ({
        paymaster: PAYMASTER_ADDR,
        paymasterData: '0xstub',
        paymasterVerificationGasLimit: '0x8000',
        paymasterPostOpGasLimit: '0xa000',
      }),
      eth_estimateUserOperationGas: () => ({
        callGasLimit: '0x1000',
        verificationGasLimit: '0x2000',
        preVerificationGas: '0x3000',
      }),
      pm_getPaymasterData: () => ({
        paymaster: PAYMASTER_ADDR,
        paymasterData: '0xfinalrate',
      }),
    });

    try {
      const paymaster = new Erc7677Paymaster(server.url, { chainId: CHAIN_ID, provider: null });
      const smartAccount = makeTokenAccount(ENTRYPOINT_V7);
      const userOp = v7UserOp();

      const out = await paymaster.createPaymasterUserOperation(
        smartAccount,
        userOp,
        server.url,
        { token: TOKEN_ADDR, exchangeRate: '0xde0b6b3a7640000' },
      );

      // No provider-specific RPC call.
      const methods = server.calls.map((c) => c.method);
      expect(methods).toEqual([
        'pm_getPaymasterStubData',
        'eth_estimateUserOperationGas',
        'pm_getPaymasterData',
      ]);

      // Paymaster address from stub was used in approve calls.
      expect(smartAccount.calls[0].paymasterAddress).toBe(PAYMASTER_ADDR);
      expect(out.paymasterData).toBe('0xfinalrate');
    } finally {
      await server.close();
    }
  });

  // ── Token paymaster flow: Case C (fallthrough) ──────────────────────

  test('Case C: no provider, no exchangeRate falls through to sponsored flow', async () => {
    const PAYMASTER_ADDR = '0x' + '11'.repeat(20);
    const TOKEN_ADDR = '0x' + '22'.repeat(20);

    const server = await makeMockRpcServer({
      pm_getPaymasterStubData: () => ({
        paymaster: PAYMASTER_ADDR,
        paymasterData: '0xstub',
        paymasterVerificationGasLimit: '0x8000',
        paymasterPostOpGasLimit: '0xa000',
      }),
      eth_estimateUserOperationGas: () => ({
        callGasLimit: '0x1000',
        verificationGasLimit: '0x2000',
        preVerificationGas: '0x3000',
      }),
      pm_getPaymasterData: () => ({
        paymaster: PAYMASTER_ADDR,
        paymasterData: '0xfinalsponsored',
      }),
    });

    try {
      const paymaster = new Erc7677Paymaster(server.url, { chainId: CHAIN_ID, provider: null });
      const smartAccount = makeTokenAccount(ENTRYPOINT_V7);
      const originalCallData = '0xoriginal';
      const userOp = v7UserOp({ callData: originalCallData });

      const out = await paymaster.createPaymasterUserOperation(
        smartAccount,
        userOp,
        server.url,
        { token: TOKEN_ADDR }, // no exchangeRate
      );

      // Regular sponsored flow — no provider RPC, no prependTokenPaymasterApproveToCallData calls.
      const methods = server.calls.map((c) => c.method);
      expect(methods).toEqual([
        'pm_getPaymasterStubData',
        'eth_estimateUserOperationGas',
        'pm_getPaymasterData',
      ]);

      // prependTokenPaymasterApproveToCallData was NOT called.
      expect(smartAccount.calls.length).toBe(0);

      // context.token was forwarded to paymaster RPCs.
      expect(server.calls[0].params[3]).toEqual({ token: TOKEN_ADDR });
      expect(out.paymasterData).toBe('0xfinalsponsored');
    } finally {
      await server.close();
    }
  });

  // ── Token paymaster flow: USDT allowance reset ──────────────────────

  test('USDT-like token gets approve(0) prepended', async () => {
    const PAYMASTER_ADDR = '0x' + 'aa'.repeat(20);
    // Mainnet USDT address (in the TOKENS_REQUIRING_ALLOWANCE_RESET list)
    const USDT_ADDR = '0xdac17f958d2ee523a2206206994597c13d831ec7';

    const server = await makeMockRpcServer({
      pimlico_getTokenQuotes: () => ({
        quotes: [{
          paymaster: PAYMASTER_ADDR,
          token: USDT_ADDR,
          exchangeRate: '0xde0b6b3a7640000',
        }],
      }),
      pm_getPaymasterStubData: () => ({
        paymaster: PAYMASTER_ADDR,
        paymasterData: '0xstub',
        paymasterVerificationGasLimit: '0x8000',
        paymasterPostOpGasLimit: '0xa000',
      }),
      eth_estimateUserOperationGas: () => ({
        callGasLimit: '0x1000',
        verificationGasLimit: '0x2000',
        preVerificationGas: '0x3000',
      }),
      pm_getPaymasterData: () => ({
        paymaster: PAYMASTER_ADDR,
        paymasterData: '0xfinalusdt',
      }),
    });

    try {
      const paymaster = new Erc7677Paymaster(server.url, { chainId: CHAIN_ID, provider: 'pimlico' });
      const smartAccount = makeTokenAccount(ENTRYPOINT_V7);

      await paymaster.createPaymasterUserOperation(
        smartAccount,
        v7UserOp(),
        server.url,
        { token: USDT_ADDR },
      );

      // Should have approve(0) calls (for reset) in addition to approve(MAX) and approve(calculated).
      const zeroApproveCalls = smartAccount.calls.filter((c) => c.approveAmount === 0n);
      expect(zeroApproveCalls.length).toBeGreaterThanOrEqual(1);
    } finally {
      await server.close();
    }
  });

  // ── Token paymaster flow: resetApproval override ────────────────────

  test('resetApproval override forces approve(0) for non-USDT token', async () => {
    const PAYMASTER_ADDR = '0x' + 'aa'.repeat(20);
    const TOKEN_ADDR = '0x' + 'bb'.repeat(20); // Not USDT

    const server = await makeMockRpcServer({
      pimlico_getTokenQuotes: () => ({
        quotes: [{
          paymaster: PAYMASTER_ADDR,
          token: TOKEN_ADDR,
          exchangeRate: '0xde0b6b3a7640000',
        }],
      }),
      pm_getPaymasterStubData: () => ({
        paymaster: PAYMASTER_ADDR,
        paymasterData: '0xstub',
        paymasterVerificationGasLimit: '0x8000',
        paymasterPostOpGasLimit: '0xa000',
      }),
      eth_estimateUserOperationGas: () => ({
        callGasLimit: '0x1000',
        verificationGasLimit: '0x2000',
        preVerificationGas: '0x3000',
      }),
      pm_getPaymasterData: () => ({
        paymaster: PAYMASTER_ADDR,
        paymasterData: '0xfinal',
      }),
    });

    try {
      const paymaster = new Erc7677Paymaster(server.url, { chainId: CHAIN_ID, provider: 'pimlico' });
      const smartAccount = makeTokenAccount(ENTRYPOINT_V7);

      await paymaster.createPaymasterUserOperation(
        smartAccount,
        v7UserOp(),
        server.url,
        { token: TOKEN_ADDR },
        { resetApproval: true },
      );

      // Should have approve(0) calls even though token is not USDT.
      const zeroApproveCalls = smartAccount.calls.filter((c) => c.approveAmount === 0n);
      expect(zeroApproveCalls.length).toBeGreaterThanOrEqual(1);
    } finally {
      await server.close();
    }
  });

  // ── Token paymaster flow: input not mutated ─────────────────────────

  test('token flow does not mutate the input UserOperation', async () => {
    const PAYMASTER_ADDR = '0x' + 'aa'.repeat(20);
    const TOKEN_ADDR = '0x' + 'bb'.repeat(20);

    const server = await makeMockRpcServer({
      pimlico_getTokenQuotes: () => ({
        quotes: [{
          paymaster: PAYMASTER_ADDR,
          token: TOKEN_ADDR,
          exchangeRate: '0xde0b6b3a7640000',
        }],
      }),
      pm_getPaymasterStubData: () => ({
        paymaster: PAYMASTER_ADDR,
        paymasterData: '0xstub',
        paymasterVerificationGasLimit: '0x8000',
        paymasterPostOpGasLimit: '0xa000',
      }),
      eth_estimateUserOperationGas: () => ({
        callGasLimit: '0x1000',
        verificationGasLimit: '0x2000',
        preVerificationGas: '0x3000',
      }),
      pm_getPaymasterData: () => ({
        paymaster: PAYMASTER_ADDR,
        paymasterData: '0xfinal',
      }),
    });

    try {
      const paymaster = new Erc7677Paymaster(server.url, { chainId: CHAIN_ID, provider: 'pimlico' });
      const smartAccount = makeTokenAccount(ENTRYPOINT_V7);
      const userOp = v7UserOp();
      const originalCallData = userOp.callData;
      const originalPaymasterData = userOp.paymasterData;

      await paymaster.createPaymasterUserOperation(
        smartAccount,
        userOp,
        server.url,
        { token: TOKEN_ADDR },
      );

      expect(userOp.callData).toBe(originalCallData);
      expect(userOp.paymasterData).toBe(originalPaymasterData);
    } finally {
      await server.close();
    }
  });
});
