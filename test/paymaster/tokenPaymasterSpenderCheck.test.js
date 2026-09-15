const http = require('node:http');
const { Erc7677Paymaster, CandidePaymaster } = require('../../dist/index.cjs');

jest.setTimeout(30000);

/**
 * The token paymaster flows prepend `approve(spender, amount)` to callData
 * using the address from the token quote, then set `userOp.paymaster` from a
 * later `pm_getPaymasterData` response. These tests pin the invariant that
 * the two must agree: an RPC that quotes one spender and finalizes with
 * another (or with none) must be rejected before the caller signs.
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

function v6UserOp(overrides = {}) {
  return {
    sender: '0x' + '1'.repeat(40),
    nonce: 0n,
    initCode: '0x',
    callData: '0x',
    callGasLimit: 0n,
    verificationGasLimit: 0n,
    preVerificationGas: 0n,
    maxFeePerGas: 1_000_000_000n,
    maxPriorityFeePerGas: 100_000_000n,
    paymasterAndData: '0x',
    signature: '0x',
    ...overrides,
  };
}

const CHAIN_ID = 1n;
const ENTRYPOINT_V7 = '0x0000000071727De22E5E9d8BAf0edAc6f37da032';
const ENTRYPOINT_V6 = '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789';

const PAYMASTER = '0x' + 'cc'.repeat(20);
const ATTACKER = '0x' + 'ee'.repeat(20);
const TOKEN = '0x' + 'dd'.repeat(20);
const ONE_ETH = '0xde0b6b3a7640000';

const ESTIMATE = {
  callGasLimit: '0x1000',
  verificationGasLimit: '0x2000',
  preVerificationGas: '0x3000',
};

function makeTokenAccount(entrypoint) {
  const calls = [];
  return {
    entrypointAddress: entrypoint,
    calls,
    prependTokenPaymasterApproveToCallData(callData, tokenAddress, paymasterAddress, approveAmount) {
      calls.push({ callData, tokenAddress, paymasterAddress, approveAmount });
      return `approve(${paymasterAddress},${approveAmount.toString(16)})::${callData}`;
    },
  };
}

/** Candide `pm_supportedERC20Tokens` payload with a structured (v0.7) dummy. */
function candideSupported({ spender = PAYMASTER, dummyPaymaster = PAYMASTER } = {}) {
  const dummy = {
    paymasterVerificationGasLimit: '0x8000',
    paymasterPostOpGasLimit: '0xa000',
    paymasterData: '0xdummydata',
  };
  if (dummyPaymaster != null) dummy.paymaster = dummyPaymaster;
  return {
    tokens: [{ name: 'Test', symbol: 'TST', decimals: 6, address: TOKEN, exchangeRate: ONE_ETH }],
    paymasterMetadata: { name: 'Candide', address: spender, dummyPaymasterAndData: dummy },
  };
}

async function expectPaymasterError(promise, ...fragments) {
  let caught;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeDefined();
  expect(caught.code).toBe('PAYMASTER_ERROR');
  // The message may sit on the error itself or on its cause (the Candide
  // class wraps everything in a generic outer error).
  const text = [caught.message, caught.cause?.message].filter(Boolean).join(' ');
  for (const fragment of fragments) {
    expect(text.toLowerCase()).toContain(fragment.toLowerCase());
  }
}

describe('Erc7677Paymaster token flow: approve spender must match the final paymaster', () => {
  test('candide: final paymaster differs from the quoted spender', async () => {
    const server = await makeMockRpcServer({
      pm_supportedERC20Tokens: () => candideSupported({ spender: ATTACKER, dummyPaymaster: ATTACKER }),
      eth_estimateUserOperationGas: () => ESTIMATE,
      pm_getPaymasterData: () => ({ paymaster: PAYMASTER, paymasterData: '0xfinal' }),
    });
    try {
      const paymaster = new Erc7677Paymaster(server.url, { chainId: CHAIN_ID, provider: 'candide' });
      await expectPaymasterError(
        paymaster.createPaymasterUserOperation(makeTokenAccount(ENTRYPOINT_V7), v7UserOp(), server.url, { token: TOKEN }),
        ATTACKER,
        PAYMASTER,
      );
    } finally {
      await server.close();
    }
  });

  test('pimlico: final paymaster differs from the quoted spender', async () => {
    const server = await makeMockRpcServer({
      pimlico_getTokenQuotes: () => ({
        quotes: [{ paymaster: ATTACKER, token: TOKEN, exchangeRate: ONE_ETH, postOpGas: '0x1000' }],
      }),
      pm_getPaymasterStubData: () => ({
        paymaster: PAYMASTER,
        paymasterData: '0xstub',
        paymasterVerificationGasLimit: '0x8000',
        paymasterPostOpGasLimit: '0x1',
      }),
      eth_estimateUserOperationGas: () => ESTIMATE,
      pm_getPaymasterData: () => ({ paymaster: PAYMASTER, paymasterData: '0xfinal' }),
    });
    try {
      const paymaster = new Erc7677Paymaster(server.url, { chainId: CHAIN_ID, provider: 'pimlico' });
      await expectPaymasterError(
        paymaster.createPaymasterUserOperation(makeTokenAccount(ENTRYPOINT_V7), v7UserOp(), server.url, { token: TOKEN }),
        ATTACKER,
        PAYMASTER,
      );
    } finally {
      await server.close();
    }
  });

  test('candide: final response leaves the operation with no paymaster', async () => {
    // Stub carries no paymaster and the final response omits it too: the
    // result would be a self-paid op that still carries the approve.
    const server = await makeMockRpcServer({
      pm_supportedERC20Tokens: () => candideSupported({ spender: ATTACKER, dummyPaymaster: null }),
      eth_estimateUserOperationGas: () => ESTIMATE,
      pm_getPaymasterData: () => ({ paymasterData: '0xfinal' }),
    });
    try {
      const paymaster = new Erc7677Paymaster(server.url, { chainId: CHAIN_ID, provider: 'candide' });
      await expectPaymasterError(
        paymaster.createPaymasterUserOperation(makeTokenAccount(ENTRYPOINT_V7), v7UserOp(), server.url, { token: TOKEN }),
        ATTACKER,
        'missing',
      );
    } finally {
      await server.close();
    }
  });

  test('candide: final response omits the paymaster even though the stub carried one', async () => {
    // The stub already set userOp.paymaster to the quoted spender. A final
    // response that omits the field must not pass on the strength of that
    // retained stub value: the final payload itself has to name the paymaster.
    const server = await makeMockRpcServer({
      pm_supportedERC20Tokens: () => candideSupported(),
      eth_estimateUserOperationGas: () => ESTIMATE,
      pm_getPaymasterData: () => ({}),
    });
    try {
      const paymaster = new Erc7677Paymaster(server.url, { chainId: CHAIN_ID, provider: 'candide' });
      await expectPaymasterError(
        paymaster.createPaymasterUserOperation(makeTokenAccount(ENTRYPOINT_V7), v7UserOp(), server.url, { token: TOKEN }),
        PAYMASTER,
        'missing',
      );
    } finally {
      await server.close();
    }
  });

  test('candide v0.6: final response omits paymasterAndData even though the stub carried it', async () => {
    const server = await makeMockRpcServer({
      pm_supportedERC20Tokens: () => ({
        tokens: [{ name: 'Test', symbol: 'TST', decimals: 6, address: TOKEN, exchangeRate: ONE_ETH }],
        paymasterMetadata: { name: 'Candide', address: PAYMASTER, dummyPaymasterAndData: PAYMASTER + '00'.repeat(64) },
      }),
      eth_estimateUserOperationGas: () => ESTIMATE,
      pm_getPaymasterData: () => ({}),
    });
    try {
      const paymaster = new Erc7677Paymaster(server.url, { chainId: CHAIN_ID, provider: 'candide' });
      await expectPaymasterError(
        paymaster.createPaymasterUserOperation(
          makeTokenAccount(ENTRYPOINT_V6),
          v6UserOp(),
          server.url,
          { token: TOKEN },
          { entrypoint: ENTRYPOINT_V6 },
        ),
        PAYMASTER,
        'missing',
      );
    } finally {
      await server.close();
    }
  });

  test('candide v0.6: paymasterAndData prefix differs from the quoted spender', async () => {
    const server = await makeMockRpcServer({
      pm_supportedERC20Tokens: () => ({
        tokens: [{ name: 'Test', symbol: 'TST', decimals: 6, address: TOKEN, exchangeRate: ONE_ETH }],
        paymasterMetadata: { name: 'Candide', address: ATTACKER, dummyPaymasterAndData: ATTACKER + '00'.repeat(64) },
      }),
      eth_estimateUserOperationGas: () => ESTIMATE,
      pm_getPaymasterData: () => ({ paymasterAndData: PAYMASTER + 'ff'.repeat(64) }),
    });
    try {
      const paymaster = new Erc7677Paymaster(server.url, { chainId: CHAIN_ID, provider: 'candide' });
      await expectPaymasterError(
        paymaster.createPaymasterUserOperation(
          makeTokenAccount(ENTRYPOINT_V6),
          v6UserOp(),
          server.url,
          { token: TOKEN },
          { entrypoint: ENTRYPOINT_V6 },
        ),
        ATTACKER,
        PAYMASTER,
      );
    } finally {
      await server.close();
    }
  });

  test('case B: stub paymaster used for the approve differs from the final paymaster', async () => {
    const server = await makeMockRpcServer({
      pm_getPaymasterStubData: () => ({
        paymaster: ATTACKER,
        paymasterData: '0xstub',
        paymasterVerificationGasLimit: '0x8000',
        paymasterPostOpGasLimit: '0xa000',
      }),
      eth_estimateUserOperationGas: () => ESTIMATE,
      pm_getPaymasterData: () => ({ paymaster: PAYMASTER, paymasterData: '0xfinal' }),
    });
    try {
      const paymaster = new Erc7677Paymaster(server.url, { chainId: CHAIN_ID });
      await expectPaymasterError(
        paymaster.createPaymasterUserOperation(
          makeTokenAccount(ENTRYPOINT_V7),
          v7UserOp(),
          server.url,
          { token: TOKEN, exchangeRate: ONE_ETH },
        ),
        ATTACKER,
        PAYMASTER,
      );
    } finally {
      await server.close();
    }
  });

  test('context.paymasterAddress that disagrees with the provider quote is rejected before any approve is built', async () => {
    const server = await makeMockRpcServer({
      pm_supportedERC20Tokens: () => candideSupported({ spender: ATTACKER, dummyPaymaster: ATTACKER }),
      eth_estimateUserOperationGas: () => ESTIMATE,
      pm_getPaymasterData: () => ({ paymaster: ATTACKER, paymasterData: '0xfinal' }),
    });
    try {
      const paymaster = new Erc7677Paymaster(server.url, { chainId: CHAIN_ID, provider: 'candide' });
      const account = makeTokenAccount(ENTRYPOINT_V7);
      await expectPaymasterError(
        paymaster.createPaymasterUserOperation(account, v7UserOp(), server.url, {
          token: TOKEN,
          paymasterAddress: PAYMASTER,
        }),
        ATTACKER,
        PAYMASTER,
      );
      expect(account.calls).toHaveLength(0);
      expect(server.calls.map((c) => c.method)).not.toContain('eth_estimateUserOperationGas');
    } finally {
      await server.close();
    }
  });

  test('context.paymasterAddress matching the quote (different case) passes and is used as the spender', async () => {
    const server = await makeMockRpcServer({
      pm_supportedERC20Tokens: () => candideSupported(),
      eth_estimateUserOperationGas: () => ESTIMATE,
      pm_getPaymasterData: () => ({ paymaster: PAYMASTER, paymasterData: '0xfinal' }),
    });
    try {
      const paymaster = new Erc7677Paymaster(server.url, { chainId: CHAIN_ID, provider: 'candide' });
      const account = makeTokenAccount(ENTRYPOINT_V7);
      const { userOperation: out } = await paymaster.createPaymasterUserOperation(account, v7UserOp(), server.url, {
        token: TOKEN,
        paymasterAddress: PAYMASTER.toUpperCase().replace('0X', '0x'),
      });
      expect(out.paymaster).toBe(PAYMASTER);
      for (const call of account.calls) {
        expect(call.paymasterAddress.toLowerCase()).toBe(PAYMASTER);
      }
    } finally {
      await server.close();
    }
  });

  test('happy path: tokenQuote exposes the spender and the approve amount', async () => {
    const server = await makeMockRpcServer({
      pm_supportedERC20Tokens: () => candideSupported(),
      eth_estimateUserOperationGas: () => ESTIMATE,
      pm_getPaymasterData: () => ({ paymaster: PAYMASTER, paymasterData: '0xfinal' }),
    });
    try {
      const paymaster = new Erc7677Paymaster(server.url, { chainId: CHAIN_ID, provider: 'candide' });
      const account = makeTokenAccount(ENTRYPOINT_V7);
      const { userOperation: out, tokenQuote } = await paymaster.createPaymasterUserOperation(
        account,
        v7UserOp(),
        server.url,
        { token: TOKEN },
      );
      expect(tokenQuote.paymaster.toLowerCase()).toBe(out.paymaster.toLowerCase());
      expect(tokenQuote.approveAmount).toBe(tokenQuote.tokenCost * 2n);
      const lastApprove = account.calls[account.calls.length - 1];
      expect(lastApprove.approveAmount).toBe(tokenQuote.approveAmount);
      expect(lastApprove.paymasterAddress.toLowerCase()).toBe(tokenQuote.paymaster.toLowerCase());
    } finally {
      await server.close();
    }
  });
});

describe('CandidePaymaster token flow: approve spender must match the final paymaster', () => {
  test('final paymaster differs from the metadata address used for the approve', async () => {
    const server = await makeMockRpcServer({
      pm_chainId: () => '0x1',
      pm_supportedERC20Tokens: () => candideSupported({ spender: ATTACKER, dummyPaymaster: ATTACKER }),
      eth_estimateUserOperationGas: () => ESTIMATE,
      pm_getPaymasterData: () => ({
        paymaster: PAYMASTER,
        paymasterData: '0xfinal',
        paymasterVerificationGasLimit: '0x8000',
        paymasterPostOpGasLimit: '0xa000',
      }),
    });
    try {
      const paymaster = new CandidePaymaster(server.url);
      await expectPaymasterError(
        paymaster.createTokenPaymasterUserOperation(makeTokenAccount(ENTRYPOINT_V7), v7UserOp(), TOKEN, server.url),
        ATTACKER,
        PAYMASTER,
      );
    } finally {
      await server.close();
    }
  });

  test('final response with no paymaster is rejected', async () => {
    const server = await makeMockRpcServer({
      pm_chainId: () => '0x1',
      pm_supportedERC20Tokens: () => candideSupported({ spender: ATTACKER, dummyPaymaster: ATTACKER }),
      eth_estimateUserOperationGas: () => ESTIMATE,
      pm_getPaymasterData: () => ({
        paymasterData: '0xfinal',
        paymasterVerificationGasLimit: '0x8000',
        paymasterPostOpGasLimit: '0xa000',
      }),
    });
    try {
      const paymaster = new CandidePaymaster(server.url);
      await expectPaymasterError(
        paymaster.createTokenPaymasterUserOperation(makeTokenAccount(ENTRYPOINT_V7), v7UserOp(), TOKEN, server.url),
        ATTACKER,
        'missing',
      );
    } finally {
      await server.close();
    }
  });

  test('happy path: tokenQuote exposes the spender and the approve amount', async () => {
    const server = await makeMockRpcServer({
      pm_chainId: () => '0x1',
      pm_supportedERC20Tokens: () => candideSupported(),
      eth_estimateUserOperationGas: () => ESTIMATE,
      pm_getPaymasterData: () => ({
        paymaster: PAYMASTER,
        paymasterData: '0xfinal',
        paymasterVerificationGasLimit: '0x8000',
        paymasterPostOpGasLimit: '0xa000',
      }),
    });
    try {
      const paymaster = new CandidePaymaster(server.url);
      const account = makeTokenAccount(ENTRYPOINT_V7);
      const { userOperation: out, tokenQuote } = await paymaster.createTokenPaymasterUserOperation(
        account,
        v7UserOp(),
        TOKEN,
        server.url,
      );
      expect(out.paymaster).toBe(PAYMASTER);
      expect(tokenQuote.paymaster.toLowerCase()).toBe(PAYMASTER);
      expect(tokenQuote.approveAmount).toBe(tokenQuote.tokenCost * 2n);
      const lastApprove = account.calls[account.calls.length - 1];
      expect(lastApprove.approveAmount).toBe(tokenQuote.approveAmount);
    } finally {
      await server.close();
    }
  });
});
