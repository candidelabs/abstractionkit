const fs = require('node:fs');
const path = require('node:path');
const ak = require('../../dist/index.cjs');
const { getAddress } = require('../_loadEthereUtils.cjs');
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

describe('decodeTokenQuote: real on-chain operations', () => {
  test.each(fixtures.map((fx) => [`${fx.provider} ${fx.entrypointVersion} chain ${fx.chainId} ${fx.txHash.slice(0, 10)}`, fx]))(
    '%s',
    (_, fx) => {
      const quote = decodeTokenQuote(fx.userOperation);

      expect(quote.provider).toBe(fx.provider);
      expect(quote.validUntil).toBeGreaterThan(0);
      // The contract never charged more than the decoded bound.
      expect(quote.maxTokenCost).not.toBeNull();
      expect(fx.charged <= quote.maxTokenCost).toBe(true);

      if (fx.provider === 'candide') {
        expect(typeof quote.gasTokenSlot).toBe('number');
        expect(quote.token).toBeNull();
      }
      if (fx.provider === 'pimlico') {
        expect(quote.gasTokenSlot).toBeUndefined();
        expect(quote.exchangeRate).toBe(fx.eventExchangeRate);
        expect(quote.token).toBe(getAddress(fx.token.toLowerCase()));
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
  test('token mode, no markup: rate, validity, slot and the post-op bound', () => {
    const quote = decodeTokenQuote(v7Op(CANDIDE_V7, candideData({ slot: 7, rate: 3n * 10n ** 9n })));
    expect(quote).toMatchObject({
      provider: 'candide', token: null, gasTokenSlot: 7, exchangeRate: 3n * 10n ** 9n, validUntil: 1_800_000_000,
    });
    expect(quote.maxTokenCost).toBe(((MAX_GAS_COST + 35_000n * 1_000_000_000n) * 3n * 10n ** 9n) / 10n ** 18n);
    expect(quote.validAfter).toBeUndefined();
  });

  test('EntryPoint v0.9 layout skips the trusted-bundlers byte', () => {
    const quote = decodeTokenQuote(v7Op(CANDIDE_V9, candideData({ trusted: true, slot: 2, rate: 7n })));
    expect(quote).toMatchObject({ exchangeRate: 7n, gasTokenSlot: 2 });
  });

  test('EntryPoint v0.6 reads paymasterAndData after the address', () => {
    const op = {
      sender: '0x' + '1'.repeat(40), nonce: 0n, initCode: '0x', callData: '0x',
      callGasLimit: 100_000n, verificationGasLimit: 200_000n, preVerificationGas: 50_000n,
      maxFeePerGas: 1_000_000_000n, maxPriorityFeePerGas: 1_000_000n,
      paymasterAndData: CANDIDE_V6 + candideData({ rate: 5n * 10n ** 18n }), signature: '0x',
    };
    const quote = decodeTokenQuote(op);
    expect(quote.exchangeRate).toBe(5n * 10n ** 18n);
    // v0.6 counts verification gas three times when a paymaster is set
    const v6MaxGas = (100_000n + 200_000n * 3n + 50_000n) * 1_000_000_000n;
    expect(quote.maxTokenCost).toBe(((v6MaxGas + 35_000n * 1_000_000_000n) * 5n * 10n ** 18n) / 10n ** 18n);
  });

  test('sponsored (FREE) mode returns null', () => {
    expect(decodeTokenQuote(v7Op(CANDIDE_V7, candideData({ mode: 2 })))).toBeNull();
  });

  test('custom markup is applied to the bound, not to the reported rate', () => {
    const markup = 11n * 10n ** 25n; // 1.1x
    const quote = decodeTokenQuote(v7Op(CANDIDE_V7, candideData({ markupMode: 2, rate: 10n ** 18n, markup })));
    expect(quote.exchangeRate).toBe(10n ** 18n);
    expect(quote.maxTokenCost).toBe(((MAX_GAS_COST + 35_000n * 1_000_000_000n) * 11n) / 10n);
  });

  test('on-chain markup mode returns the rate with an unknown bound', () => {
    const quote = decodeTokenQuote(v7Op(CANDIDE_V7, candideData({ markupMode: 1 })));
    expect(quote.exchangeRate).toBe(10n ** 18n);
    expect(quote.maxTokenCost).toBeNull();
  });

  test.each([1, 3])('unsupported mode %i throws BAD_DATA', (mode) => {
    expect(() => decodeTokenQuote(v7Op(CANDIDE_V7, candideData({ mode }))))
      .toThrow(expect.objectContaining({ code: 'BAD_DATA' }));
  });

  test('truncated data throws BAD_DATA', () => {
    expect(() => decodeTokenQuote(v7Op(CANDIDE_V7, candideData().slice(0, 30))))
      .toThrow(expect.objectContaining({ code: 'BAD_DATA' }));
  });
});

describe('decodeTokenQuote: Pimlico paymaster data', () => {
  test('ERC-20 mode: token, window and the post-op bound', () => {
    const quote = decodeTokenQuote(v7Op(PIMLICO_V7, pimlicoData()));
    expect(quote).toMatchObject({
      provider: 'pimlico', token: getAddress(TOKEN), exchangeRate: 3_000_000_000n,
      validUntil: 1_800_000_000, validAfter: 1_700_000_000,
    });
    expect(quote.maxTokenCost).toBe(((MAX_GAS_COST + 50_000n * 1_000_000_000n) * 3_000_000_000n) / 10n ** 18n);
  });

  test('constant fee is added and the prefund field is skipped', () => {
    const quote = decodeTokenQuote(v7Op(PIMLICO_V7, pimlicoData({ flags: 0x05, preFund: 123n, constantFee: 1_000n })));
    expect(quote.maxTokenCost).toBe(((MAX_GAS_COST + 50_000n * 1_000_000_000n) * 3_000_000_000n) / 10n ** 18n + 1_000n);
  });

  test('verifying (sponsored) mode returns null', () => {
    expect(decodeTokenQuote(v7Op(PIMLICO_V7, pimlicoData({ mode: 0 })))).toBeNull();
  });
});

describe('decodeTokenQuote: paymaster checks', () => {
  test.each([null, '0x' + '00'.repeat(20)])('no paymaster (%s) returns null', (paymaster) => {
    expect(decodeTokenQuote(v7Op(paymaster, ''))).toBeNull();
  });

  test('unknown paymaster throws PAYMASTER_ERROR', () => {
    expect(() => decodeTokenQuote(v7Op('0x' + '99'.repeat(20), candideData())))
      .toThrow(expect.objectContaining({ code: 'PAYMASTER_ERROR' }));
  });

  test.each(['constructor', '__proto__', 'hasOwnProperty'])('paymaster %s is rejected as unknown', (key) => {
    expect(() => decodeTokenQuote(v7Op(key, pimlicoData())))
      .toThrow(expect.objectContaining({ code: 'PAYMASTER_ERROR' }));
  });

  test('a custom deployment is accepted through overrides', () => {
    const custom = '0x' + '99'.repeat(20);
    const quote = decodeTokenQuote(v7Op(custom, candideData({ rate: 9n })), {
      paymasterAddresses: { [custom]: { provider: 'candide' } },
    });
    expect(quote.exchangeRate).toBe(9n);
  });

  test('paymaster data that is not hex throws BAD_DATA', () => {
    expect(() => decodeTokenQuote(v7Op(CANDIDE_V7, 'zz'.repeat(60))))
      .toThrow(expect.objectContaining({ code: 'BAD_DATA' }));
  });

  test('returns paymaster and token checksummed, whatever the input casing', () => {
    const quote = decodeTokenQuote(v7Op(PIMLICO_V7.toLowerCase(), pimlicoData()));
    expect(quote.paymaster).toBe(getAddress(PIMLICO_V7));
    expect(quote.token).toBe(getAddress(TOKEN));
  });

  test('checksums a known paymaster given in wrong mixed case', () => {
    // Mixed case with a wrong EIP-55 checksum: accepted, then returned checksummed.
    const badCase = '0x' + [...PIMLICO_V7.slice(2).toLowerCase()]
      .map((c, i) => (i % 2 === 0 ? c.toUpperCase() : c)).join('');
    expect(decodeTokenQuote(v7Op(badCase, pimlicoData())).paymaster).toBe(getAddress(PIMLICO_V7));
  });
});

describe('decodeTokenQuote: placement', () => {
  test('is a static on both paymaster classes, with identical results', () => {
    for (const fx of fixtures) {
      expect(CandidePaymaster.decodeTokenQuote(fx.userOperation))
        .toEqual(Erc7677Paymaster.decodeTokenQuote(fx.userOperation));
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
