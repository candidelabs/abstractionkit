const fs = require('node:fs');
const path = require('node:path');
const ak = require('../../dist/index.cjs');
const { encodeAbiParameters, getAddress } = require('../_loadEthereUtils.cjs');
const { Erc7677Paymaster, CandidePaymaster, SafeAccountV0_2_0 } = ak;

// Static: no `this`, so it can be called detached.
const decodeTokenQuote = Erc7677Paymaster.decodeTokenQuote;

/**
 * Real token-paid UserOperations taken from mainnet and Sepolia blocks, with
 * the amount the paymaster actually charged (from its UserOperationSponsored
 * event). Pimlico's event also carries the exchange rate it applied.
 */
const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'tokenQuote');
const BIGINT_FIELDS = new Set([
  'nonce', 'callGasLimit', 'verificationGasLimit', 'preVerificationGas', 'maxFeePerGas',
  'maxPriorityFeePerGas', 'paymasterVerificationGasLimit', 'paymasterPostOpGasLimit',
  'charged', 'eventExchangeRate',
]);
const fixtures = fs.readdirSync(FIXTURE_DIR).sort().flatMap((file) =>
  JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), 'utf8'), (key, value) =>
    BIGINT_FIELDS.has(key) && typeof value === 'string' ? BigInt(value) : value));

/**
 * Node RPC stand-in answering Candide's getTokens(uint8[]) with `token` for
 * the requested slot, recording each eth_call.
 */
function fakeNode(token) {
  const calls = [];
  return {
    calls,
    request: async ({ method, params }) => {
      calls.push({ method, params });
      if (method !== 'eth_call') throw new Error(`unexpected ${method}`);
      return encodeAbiParameters(['(address,uint8,bytes,uint256,uint256)[]'], [[[token, 0, '0x', 0n, 0n]]]);
    },
  };
}

/** Node RPC that must never be called: proves a path stays offline. */
const offlineNode = { request: async () => { throw new Error('unexpected network call'); } };

describe('decodeTokenQuote: real on-chain operations', () => {
  test.each(fixtures.map((fx) => [`${fx.provider} ${fx.entrypointVersion} chain ${fx.chainId} ${fx.txHash.slice(0, 10)}`, fx]))(
    '%s',
    async (_, fx) => {
      // Candide resolves its token through the node; Pimlico must not touch it.
      const node = fx.provider === 'candide' ? fakeNode(fx.token) : offlineNode;
      const quote = await decodeTokenQuote(fx.userOperation, node);

      expect(quote.provider).toBe(fx.provider);
      expect(quote.validUntil).toBeGreaterThan(0);
      // The contract never charged more than the decoded bound.
      expect(quote.maxTokenCost).not.toBeNull();
      expect(fx.charged <= quote.maxTokenCost).toBe(true);
      expect('gasTokenSlot' in quote).toBe(false);
      expect(quote.token).toBe(getAddress(fx.token.toLowerCase()));

      if (fx.provider === 'candide') expect(node.calls).toHaveLength(1);
      if (fx.provider === 'pimlico') {
        expect(quote.exchangeRate).toBe(fx.eventExchangeRate);
        expect(typeof quote.validAfter).toBe('number');
      }
    },
  );
});

// ── Synthetic operations for the branches real traffic does not exercise ──

const CANDIDE_V7 = '0x8b1f6cb5d062aa2ce8d581942bbb960420d875ba';
const CANDIDE_V9 = '0xca944fb73fa5191969014ded9bb075381d59c7de';
const CANDIDE_V6 = '0x36f4aa64673568782461bf03c75462f8ef0a1b76';
const PIMLICO_V7 = '0x777777777777AeC03fd955926DbF81597e66834C';
const TOKEN = '0x' + 'bb'.repeat(20);
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const SIG = '11'.repeat(65);
const hex = (value, bytes) => BigInt(value).toString(16).padStart(bytes * 2, '0');

function candideData({ mode = 0, markupMode = 0, trusted = false, slot = 0, validUntil = 1_800_000_000, rate = 10n ** 18n, markup } = {}) {
  let data = hex(mode, 1) + hex(markupMode, 1) + (trusted ? '00' : '');
  if (mode === 2) return data + hex(validUntil, 6) + SIG;
  data += hex(slot, 1) + hex(validUntil, 6) + hex(rate, 32);
  if (markup != null) data += hex(markup, 32);
  return data + SIG;
}

function pimlicoData({ mode = 1, flags = 0, validUntil = 1_800_000_000, validAfter = 1_700_000_000, postOpGas = 50_000n, rate = 3_000_000_000n, preFund, constantFee } = {}) {
  let data = hex((mode << 1) | 1, 1);
  if (mode === 0) return data + hex(validUntil, 6) + hex(validAfter, 6) + SIG;
  data += hex(flags, 1) + hex(validUntil, 6) + hex(validAfter, 6) + TOKEN.slice(2) + hex(postOpGas, 16)
    + hex(rate, 32) + hex(100_000n, 16) + 'cc'.repeat(20);
  if (preFund != null) data += hex(preFund, 16);
  if (constantFee != null) data += hex(constantFee, 16);
  return data + SIG;
}

function v7Op(paymaster, paymasterData) {
  return {
    sender: '0x' + '1'.repeat(40), nonce: 0n, factory: null, factoryData: null, callData: '0x',
    callGasLimit: 100_000n, verificationGasLimit: 200_000n, preVerificationGas: 50_000n,
    maxFeePerGas: 1_000_000_000n, maxPriorityFeePerGas: 1_000_000n,
    paymaster, paymasterVerificationGasLimit: 30_000n, paymasterPostOpGasLimit: 40_000n,
    paymasterData: '0x' + paymasterData, signature: '0x',
  };
}

// 420,000 gas at 1 gwei
const MAX_GAS_COST = 420_000n * 1_000_000_000n;

describe('decodeTokenQuote: Candide paymaster data', () => {
  test('token mode, no markup: token, rate, validity and the post-op bound', async () => {
    const quote = await decodeTokenQuote(v7Op(CANDIDE_V7, candideData({ rate: 3n * 10n ** 9n })), fakeNode(USDC));
    expect(quote).toMatchObject({ provider: 'candide', token: USDC, exchangeRate: 3n * 10n ** 9n, validUntil: 1_800_000_000 });
    expect(quote.maxTokenCost).toBe(((MAX_GAS_COST + 35_000n * 1_000_000_000n) * 3n * 10n ** 9n) / 10n ** 18n);
    expect(quote.validAfter).toBeUndefined();
  });

  test('EntryPoint v0.9 layout skips the trusted-bundlers byte', async () => {
    const quote = await decodeTokenQuote(v7Op(CANDIDE_V9, candideData({ trusted: true, rate: 7n })), fakeNode(USDC));
    expect(quote.exchangeRate).toBe(7n);
  });

  test('EntryPoint v0.6 reads paymasterAndData after the address', async () => {
    const op = {
      sender: '0x' + '1'.repeat(40), nonce: 0n, initCode: '0x', callData: '0x',
      callGasLimit: 100_000n, verificationGasLimit: 200_000n, preVerificationGas: 50_000n,
      maxFeePerGas: 1_000_000_000n, maxPriorityFeePerGas: 1_000_000n,
      paymasterAndData: CANDIDE_V6 + candideData({ rate: 5n * 10n ** 18n }), signature: '0x',
    };
    const quote = await decodeTokenQuote(op, fakeNode(USDC));
    expect(quote.exchangeRate).toBe(5n * 10n ** 18n);
    // v0.6 counts verification gas three times when a paymaster is set
    const v6MaxGas = (100_000n + 200_000n * 3n + 50_000n) * 1_000_000_000n;
    expect(quote.maxTokenCost).toBe(((v6MaxGas + 35_000n * 1_000_000_000n) * 5n * 10n ** 18n) / 10n ** 18n);
  });

  test('sponsored (FREE) mode returns null without a network call', async () => {
    expect(await decodeTokenQuote(v7Op(CANDIDE_V7, candideData({ mode: 2 })), offlineNode)).toBeNull();
  });

  test('custom markup is applied to the bound, not to the reported rate', async () => {
    const markup = 11n * 10n ** 25n; // 1.1x
    const quote = await decodeTokenQuote(v7Op(CANDIDE_V7, candideData({ markupMode: 2, rate: 10n ** 18n, markup })), fakeNode(USDC));
    expect(quote.exchangeRate).toBe(10n ** 18n);
    expect(quote.maxTokenCost).toBe(((MAX_GAS_COST + 35_000n * 1_000_000_000n) * 11n) / 10n);
  });

  test('a custom markup of zero keeps the signed rate, as the contract does', async () => {
    const quote = await decodeTokenQuote(v7Op(CANDIDE_V7, candideData({ markupMode: 2, rate: 3n * 10n ** 9n, markup: 0n })), fakeNode(USDC));
    expect(quote.maxTokenCost).toBe(((MAX_GAS_COST + 35_000n * 1_000_000_000n) * 3n * 10n ** 9n) / 10n ** 18n);
  });

  test('on-chain markup mode returns the rate with an unknown bound', async () => {
    const quote = await decodeTokenQuote(v7Op(CANDIDE_V7, candideData({ markupMode: 1 })), fakeNode(USDC));
    expect(quote.exchangeRate).toBe(10n ** 18n);
    expect(quote.maxTokenCost).toBeNull();
  });

  test.each([1, 3])('unsupported mode %i throws BAD_DATA', async (mode) => {
    await expect(decodeTokenQuote(v7Op(CANDIDE_V7, candideData({ mode })), offlineNode))
      .rejects.toMatchObject({ code: 'BAD_DATA' });
  });

  test('truncated data throws BAD_DATA', async () => {
    await expect(decodeTokenQuote(v7Op(CANDIDE_V7, candideData().slice(0, 30)), offlineNode))
      .rejects.toMatchObject({ code: 'BAD_DATA' });
  });
});

describe('decodeTokenQuote: Candide token read from the paymaster contract', () => {
  test('reads the signed slot with one eth_call', async () => {
    const node = fakeNode(USDC.toLowerCase());
    const quote = await decodeTokenQuote(v7Op(CANDIDE_V7, candideData({ slot: 3 })), node);
    expect(quote.token).toBe(USDC);
    expect(node.calls).toHaveLength(1);
    const [{ to, data }] = node.calls[0].params;
    expect(to.toLowerCase()).toBe(CANDIDE_V7);
    // getTokens(uint8[]) with the single slot 3
    expect(data.slice(0, 10)).toBe(ak.getFunctionSelector('getTokens(uint8[])'));
    expect(BigInt('0x' + data.slice(-64))).toBe(3n);
  });

  test('an empty slot throws BAD_DATA: the operation cannot be charged', async () => {
    await expect(decodeTokenQuote(v7Op(CANDIDE_V7, candideData()), fakeNode('0x' + '00'.repeat(20))))
      .rejects.toMatchObject({ code: 'BAD_DATA' });
  });

  test('ill formed getTokens data throws BAD_DATA', async () => {
    const node = { request: async () => '0x1234' };
    await expect(decodeTokenQuote(v7Op(CANDIDE_V7, candideData()), node))
      .rejects.toMatchObject({ code: 'BAD_DATA' });
  });
});

describe('decodeTokenQuote: Pimlico paymaster data', () => {
  test('ERC-20 mode: token, window and the post-op bound, with no network call', async () => {
    const quote = await decodeTokenQuote(v7Op(PIMLICO_V7, pimlicoData()), offlineNode);
    expect(quote).toMatchObject({
      provider: 'pimlico', token: getAddress(TOKEN), exchangeRate: 3_000_000_000n,
      validUntil: 1_800_000_000, validAfter: 1_700_000_000,
    });
    expect(quote.maxTokenCost).toBe(((MAX_GAS_COST + 50_000n * 1_000_000_000n) * 3_000_000_000n) / 10n ** 18n);
  });

  test('constant fee is added and the prefund field is skipped', async () => {
    const quote = await decodeTokenQuote(v7Op(PIMLICO_V7, pimlicoData({ flags: 0x05, preFund: 123n, constantFee: 1_000n })), offlineNode);
    expect(quote.maxTokenCost).toBe(((MAX_GAS_COST + 50_000n * 1_000_000_000n) * 3_000_000_000n) / 10n ** 18n + 1_000n);
  });

  test('verifying (sponsored) mode returns null', async () => {
    expect(await decodeTokenQuote(v7Op(PIMLICO_V7, pimlicoData({ mode: 0 })), offlineNode)).toBeNull();
  });
});

describe('decodeTokenQuote: paymaster checks', () => {
  test.each([null, '0x' + '00'.repeat(20)])('no paymaster (%s) returns null', async (paymaster) => {
    expect(await decodeTokenQuote(v7Op(paymaster, ''), offlineNode)).toBeNull();
  });

  test('unknown paymaster throws PAYMASTER_ERROR', async () => {
    await expect(decodeTokenQuote(v7Op('0x' + '99'.repeat(20), candideData()), offlineNode))
      .rejects.toMatchObject({ code: 'PAYMASTER_ERROR' });
  });

  test.each(['constructor', '__proto__', 'hasOwnProperty'])('paymaster %s is rejected as unknown', async (key) => {
    await expect(decodeTokenQuote(v7Op(key, pimlicoData()), offlineNode))
      .rejects.toMatchObject({ code: 'PAYMASTER_ERROR' });
  });

  test('a custom deployment is accepted through overrides', async () => {
    const custom = '0x' + '99'.repeat(20);
    const quote = await decodeTokenQuote(v7Op(custom, candideData({ rate: 9n })), fakeNode(USDC), {
      paymasterAddresses: { [custom]: { provider: 'candide' } },
    });
    expect(quote.exchangeRate).toBe(9n);
  });

  test('paymaster data that is not hex throws BAD_DATA', async () => {
    await expect(decodeTokenQuote(v7Op(CANDIDE_V7, 'zz'.repeat(60)), offlineNode))
      .rejects.toMatchObject({ code: 'BAD_DATA' });
  });

  test('returns paymaster and token checksummed, whatever the input casing', async () => {
    const quote = await decodeTokenQuote(v7Op(PIMLICO_V7.toLowerCase(), pimlicoData()), offlineNode);
    expect(quote.paymaster).toBe(getAddress(PIMLICO_V7));
    expect(quote.token).toBe(getAddress(TOKEN));
  });

  test('checksums a known paymaster given in wrong mixed case', async () => {
    // Mixed case with a wrong EIP-55 checksum: accepted, then returned checksummed.
    const badCase = '0x' + [...PIMLICO_V7.slice(2).toLowerCase()]
      .map((c, i) => (i % 2 === 0 ? c.toUpperCase() : c)).join('');
    expect((await decodeTokenQuote(v7Op(badCase, pimlicoData()), offlineNode)).paymaster).toBe(getAddress(PIMLICO_V7));
  });
});

describe('decodeTokenQuote: placement', () => {
  test('is a static on both paymaster classes, with identical results', async () => {
    for (const fx of fixtures) {
      const node = () => (fx.provider === 'candide' ? fakeNode(fx.token) : offlineNode);
      expect(await CandidePaymaster.decodeTokenQuote(fx.userOperation, node()))
        .toEqual(await Erc7677Paymaster.decodeTokenQuote(fx.userOperation, node()));
    }
  });

  test('needs no paymaster instance or URL', () => {
    expect(Erc7677Paymaster.prototype.decodeTokenQuote).toBeUndefined();
    expect(CandidePaymaster.prototype.decodeTokenQuote).toBeUndefined();
  });

  test('is not exported from the package root', () => {
    expect(ak.decodeTokenQuote).toBeUndefined();
  });

  test('reads no callData: the Safe approvals hook no longer exists', () => {
    expect(SafeAccountV0_2_0.prototype.decodeTokenPaymasterApprovals).toBeUndefined();
  });
});
