// Comprehensive parity tests for every exported function in src/ethereUtils.ts.
//
// Strategy:
//   1. Deterministic spec vectors / known fixtures (EIP-55 addresses, EIP-712
//      Mail example, EIP-7702 authorization tuple, …).
//   2. Property tests: a seeded PRNG (mulberry32) generates ~100 random inputs
//      per function. We then assert byte-identical output between our impl,
//      ethers v6 and viem v2. A fixed seed (env var SEED to override) makes
//      every failure reproducible.
//
// We import ethereUtils directly from `dist/ethereUtils.cjs`: the top-level
// abstractionkit bundle does not re-export the namespace, and the standalone
// CJS file is the only consumer-facing artifact for these helpers.
//
// Run: yarn build && yarn jest --runTestsByPath test/ethereUtils.test.js

const u = require('./_loadEthereUtils.cjs');
const ethers = require('ethers');
const viem = require('viem');
const viemAccounts = require('viem/accounts');

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) + helpers
// ---------------------------------------------------------------------------

const SEED = Number(process.env.SEED || 0xCAFEBEEF);
let _state = SEED >>> 0;
function rng() {
    // mulberry32 — small, fast, good enough for property tests.
    _state = (_state + 0x6D2B79F5) >>> 0;
    let t = _state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function resetRng(seed = SEED) { _state = seed >>> 0; }

function randInt(maxExclusive) {
    return Math.floor(rng() * maxExclusive);
}
function randIntRange(min, maxInclusive) {
    return min + Math.floor(rng() * (maxInclusive - min + 1));
}
function pick(arr) {
    return arr[randInt(arr.length)];
}
function randomBytes(length) {
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i++) out[i] = randInt(256);
    return out;
}
function randomHex(byteLength) {
    return ('0x' +
        Array.from(randomBytes(byteLength))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join(''));
}
function randomBigUint(bits) {
    // Uniformly random bigint in [0, 2^bits).
    let v = 0n;
    const fullBytes = Math.floor(bits / 8);
    const trailingBits = bits % 8;
    for (let i = 0; i < fullBytes; i++) {
        v = (v << 8n) | BigInt(randInt(256));
    }
    if (trailingBits) {
        const mask = (1 << trailingBits) - 1;
        v = (v << BigInt(trailingBits)) | BigInt(randInt(256) & mask);
    }
    return v;
}
function randomSignedBigInt(bits) {
    // Uniformly random signed bigint in [-2^(bits-1), 2^(bits-1)).
    const unsigned = randomBigUint(bits);
    const limit = 1n << BigInt(bits - 1);
    return unsigned < limit ? unsigned : unsigned - (1n << BigInt(bits));
}
function randomAddress() {
    // Returns the EIP-55 checksummed address (deterministic via seed).
    const bytes = randomBytes(20);
    const lower = '0x' + Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
    return u.getAddress(lower);
}
function randomPrivateKey() {
    // Any 32 random bytes is overwhelmingly likely to be in [1, n-1] for
    // secp256k1 — n is within 2^-128 of 2^256 — so we just pick 32 random
    // bytes and ensure non-zero high word.
    while (true) {
        const bytes = randomBytes(32);
        if (bytes.some((b) => b !== 0)) {
            return '0x' + Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
        }
    }
}
function randomUtf8String(maxLen = 64) {
    const len = randInt(maxLen + 1);
    let s = '';
    for (let i = 0; i < len; i++) {
        // Mix of ASCII, Latin-1, BMP, and surrogate-pair (astral) code points.
        const bucket = randInt(10);
        if (bucket < 5) s += String.fromCharCode(0x20 + randInt(0x60));         // printable ASCII
        else if (bucket < 7) s += String.fromCharCode(0x80 + randInt(0x300));   // Latin / accented
        else if (bucket < 9) s += String.fromCharCode(0x1000 + randInt(0x7000)); // BMP
        else {
            const cp = 0x10000 + randInt(0x100000);
            s += String.fromCodePoint(cp);
        }
    }
    return s;
}

const ITER = 100;
const SIGN_ITER = 30; // signing/recover tests do real EC math — keep lower.

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const PK = '0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318';
const PK_NO_PREFIX = PK.slice(2);
const ADDR_LOWER = '0xb6e1ae1f3b1c8c0e7e9c7e7c2fcd5e7d3b6c5a4d';
const ADDR_CHECKSUMMED = ethers.getAddress(ADDR_LOWER);
const DIGEST_32 = '0x' + 'ab'.repeat(32);

function bigintReplacer(_k, v) {
    return typeof v === 'bigint' ? `0x${v.toString(16)}` : v;
}

// ===========================================================================
//                              keccak256
// ===========================================================================

describe('keccak256', () => {
    test.each([
        ['empty', '0x'],
        ['single byte', '0x00'],
        ['short', '0x1234'],
        ['32 bytes', '0x' + '01'.repeat(32)],
        ['64 bytes', '0x' + 'cd'.repeat(64)],
        ['136 bytes (Keccak rate boundary)', '0x' + 'ef'.repeat(136)],
        ['137 bytes (crosses rate boundary)', '0x' + 'ef'.repeat(137)],
    ])('matches ethers + viem on %s', (_label, input) => {
        const ours = u.keccak256(input);
        expect(ours).toBe(ethers.keccak256(input));
        expect(ours).toBe(viem.keccak256(input));
    });

    test('throws on invalid bytes-like input', () => {
        expect(() => u.keccak256('not-hex')).toThrow(/invalid BytesLike value/);
    });

    test(`property: ${ITER} random hex inputs match ethers + viem`, () => {
        resetRng();
        for (let i = 0; i < ITER; i++) {
            const len = randInt(513); // 0..512 bytes — spans Keccak rate boundaries
            const hex = randomHex(len);
            const ours = u.keccak256(hex);
            expect(ours).toBe(ethers.keccak256(hex));
            expect(ours).toBe(viem.keccak256(hex));
        }
    });

    test(`property: ${ITER} random Uint8Array inputs match ethers + viem`, () => {
        resetRng();
        for (let i = 0; i < ITER; i++) {
            const bytes = randomBytes(randInt(513));
            const ours = u.keccak256(bytes);
            expect(ours).toBe(ethers.keccak256(bytes));
            expect(ours).toBe(viem.keccak256(bytes));
        }
    });
});

// ===========================================================================
//                              id (keccak256(utf8))
// ===========================================================================

describe('id', () => {
    test.each([
        '',
        'transfer(address,uint256)',
        'Hello, world!',
        'Üñîçødé 🐉 string with multi-byte chars',
    ])('matches ethers.id and viem keccak256(toBytes) on %j', (text) => {
        const ours = u.id(text);
        expect(ours).toBe(ethers.id(text));
        expect(ours).toBe(viem.keccak256(viem.stringToBytes(text)));
    });

    test('ERC-20 selector sanity check', () => {
        expect(u.id('transfer(address,uint256)').slice(0, 10)).toBe('0xa9059cbb');
    });

    test(`property: ${ITER} random UTF-8 strings match ethers + viem`, () => {
        resetRng();
        for (let i = 0; i < ITER; i++) {
            const s = randomUtf8String(128);
            const ours = u.id(s);
            expect(ours).toBe(ethers.id(s));
            expect(ours).toBe(viem.keccak256(viem.stringToBytes(s)));
        }
    });
});

// ===========================================================================
//                              hashMessage (EIP-191)
// ===========================================================================

describe('hashMessage', () => {
    test.each([
        '',
        'hello',
        'a longer message that spans more than a single keccak block boundary, hopefully',
        '1234567890'.repeat(100),
    ])('string input matches ethers + viem on %j', (msg) => {
        const ours = u.hashMessage(msg);
        expect(ours).toBe(ethers.hashMessage(msg));
        expect(ours).toBe(viem.hashMessage(msg));
    });

    test('Uint8Array input matches ethers + viem raw-bytes mode', () => {
        const bytes = new TextEncoder().encode('hello');
        const ours = u.hashMessage(bytes);
        expect(ours).toBe(ethers.hashMessage(bytes));
        expect(ours).toBe(viem.hashMessage({ raw: viem.toHex(bytes) }));
    });

    test(`property: ${ITER} random strings match ethers + viem`, () => {
        resetRng();
        for (let i = 0; i < ITER; i++) {
            const s = randomUtf8String(256);
            const ours = u.hashMessage(s);
            expect(ours).toBe(ethers.hashMessage(s));
            expect(ours).toBe(viem.hashMessage(s));
        }
    });

    test(`property: ${ITER} random Uint8Array inputs match ethers + viem`, () => {
        resetRng();
        for (let i = 0; i < ITER; i++) {
            const bytes = randomBytes(randInt(257));
            const ours = u.hashMessage(bytes);
            expect(ours).toBe(ethers.hashMessage(bytes));
            expect(ours).toBe(viem.hashMessage({ raw: viem.toHex(bytes) }));
        }
    });
});

// ===========================================================================
//                              getBytes
// ===========================================================================

describe('getBytes', () => {
    test.each(['0x', '0x00', '0x1234', '0xABCDEF', '0xaBcDeF', '0x' + 'ab'.repeat(32)])(
        'matches ethers.getBytes on %s',
        (hex) => {
            expect(Array.from(u.getBytes(hex))).toEqual(Array.from(ethers.getBytes(hex)));
        },
    );

    test('returns same Uint8Array reference (ethers v6 semantics)', () => {
        const src = Uint8Array.from([1, 2, 3]);
        expect(u.getBytes(src)).toBe(src);
    });

    test.each(['0xzz', '0x1', 'deadbeef', '', '0x12g4'])(
        'rejects malformed %j with `invalid BytesLike value`',
        (bad) => {
            expect(() => u.getBytes(bad)).toThrow(/invalid BytesLike value/);
        },
    );

    test('includes name in error message', () => {
        expect(() => u.getBytes('bad', 'myField')).toThrow(/myField/);
    });

    test(`property: ${ITER} random hex strings parse identically to ethers`, () => {
        resetRng();
        for (let i = 0; i < ITER; i++) {
            const hex = randomHex(randInt(129));
            expect(Array.from(u.getBytes(hex))).toEqual(Array.from(ethers.getBytes(hex)));
        }
    });
});

// ===========================================================================
//                              isHexString
// ===========================================================================

describe('isHexString', () => {
    test.each([
        ['0x', true],
        ['0xdeadbeef', true],
        ['0xABCDEF', true],
        ['0x1', true],
        ['deadbeef', false],
        ['0xzz', false],
        [123, false],
        [null, false],
        [undefined, false],
    ])('isHexString(%j) === %j', (v, expected) => {
        expect(u.isHexString(v)).toBe(expected);
    });

    test('length parameter constrains byte length', () => {
        expect(u.isHexString('0xdeadbeef', 4)).toBe(true);
        expect(u.isHexString('0xdeadbeef', 5)).toBe(false);
    });

    test('length=true requires even nibble count', () => {
        expect(u.isHexString('0xdeadbeef', true)).toBe(true);
        expect(u.isHexString('0xdea', true)).toBe(false);
    });

    test(`property: ${ITER} random valid hex strings return true`, () => {
        resetRng();
        for (let i = 0; i < ITER; i++) {
            expect(u.isHexString(randomHex(randInt(65)))).toBe(true);
        }
    });

    test(`property: ${ITER} random matches ethers.isHexString`, () => {
        resetRng();
        const garbage = ['0x', '0xZZ', 'no-prefix', '0x123', 'random', '0xabcde'];
        for (let i = 0; i < ITER; i++) {
            const v = i % 2 === 0 ? randomHex(randInt(65)) : pick(garbage);
            expect(u.isHexString(v)).toBe(ethers.isHexString(v));
        }
    });
});

// ===========================================================================
//                              hexlify
// ===========================================================================

describe('hexlify', () => {
    test.each([
        ['empty', new Uint8Array()],
        ['single byte', Uint8Array.from([0])],
        ['short', Uint8Array.from([0xde, 0xad, 0xbe, 0xef])],
        ['32 bytes', Uint8Array.from({ length: 32 }, (_, i) => i)],
    ])('matches ethers + viem on %s', (_label, bytes) => {
        const ours = u.hexlify(bytes);
        expect(ours).toBe(ethers.hexlify(bytes));
        expect(ours).toBe(viem.toHex(bytes));
    });

    test('round-trips hex strings unchanged (lowercase)', () => {
        expect(u.hexlify('0xABCDEF')).toBe('0xabcdef');
    });

    test(`property: ${ITER} random Uint8Arrays match ethers + viem`, () => {
        resetRng();
        for (let i = 0; i < ITER; i++) {
            const bytes = randomBytes(randInt(129));
            const ours = u.hexlify(bytes);
            expect(ours).toBe(ethers.hexlify(bytes));
            expect(ours).toBe(viem.toHex(bytes));
        }
    });
});

// ===========================================================================
//                              concat
// ===========================================================================

describe('concat', () => {
    test('empty array returns "0x"', () => {
        expect(u.concat([])).toBe('0x');
    });

    test(`property: ${ITER} random mixed-input arrays match ethers + viem`, () => {
        resetRng();
        for (let i = 0; i < ITER; i++) {
            const n = randInt(7); // 0..6 chunks
            const items = [];
            for (let j = 0; j < n; j++) {
                if (rng() < 0.5) items.push(randomHex(randInt(32)));
                else items.push(randomBytes(randInt(32)));
            }
            const ours = u.concat(items);
            expect(ours).toBe(ethers.concat(items));
            if (items.length > 0) {
                const hexItems = items.map((it) =>
                    it instanceof Uint8Array ? viem.bytesToHex(it) : it,
                );
                expect(ours).toBe(viem.concat(hexItems));
            }
        }
    });
});

// ===========================================================================
//                              dataLength
// ===========================================================================

describe('dataLength', () => {
    test.each([
        ['0x', 0],
        ['0x12', 1],
        ['0xdeadbeef', 4],
        ['0x' + 'ab'.repeat(32), 32],
    ])('matches ethers + viem on %s (expect %i)', (hex, expected) => {
        expect(u.dataLength(hex)).toBe(expected);
        expect(u.dataLength(hex)).toBe(ethers.dataLength(hex));
        expect(u.dataLength(hex)).toBe(viem.size(hex));
    });

    test(`property: ${ITER} random hex strings match ethers + viem`, () => {
        resetRng();
        for (let i = 0; i < ITER; i++) {
            const byteLen = randInt(257);
            const hex = randomHex(byteLen);
            expect(u.dataLength(hex)).toBe(byteLen);
            expect(u.dataLength(hex)).toBe(ethers.dataLength(hex));
            expect(u.dataLength(hex)).toBe(viem.size(hex));
        }
    });

    test(`property: ${ITER} random Uint8Arrays match ethers`, () => {
        resetRng();
        for (let i = 0; i < ITER; i++) {
            const bytes = randomBytes(randInt(257));
            expect(u.dataLength(bytes)).toBe(bytes.length);
            expect(u.dataLength(bytes)).toBe(ethers.dataLength(bytes));
        }
    });
});

// ===========================================================================
//                              toBeArray
// ===========================================================================

describe('toBeArray', () => {
    test.each([0n, 1n, 255n, 256n, 0xfffn, 0x1234567890abcdefn, (1n << 200n) + 7n, (1n << 256n) - 1n])(
        'matches ethers.toBeArray on %s',
        (v) => {
            expect(Array.from(u.toBeArray(v))).toEqual(Array.from(ethers.toBeArray(v)));
        },
    );

    test('accepts number and string inputs', () => {
        expect(Array.from(u.toBeArray(256))).toEqual(Array.from(ethers.toBeArray(256)));
        expect(Array.from(u.toBeArray('0x100'))).toEqual(Array.from(ethers.toBeArray('0x100')));
        expect(Array.from(u.toBeArray('1024'))).toEqual(Array.from(ethers.toBeArray('1024')));
    });

    test('rejects negative values', () => {
        expect(() => u.toBeArray(-1n)).toThrow();
    });

    test('rejects non-integer numbers', () => {
        expect(() => u.toBeArray(1.5)).toThrow();
    });

    test(`property: ${ITER} random bigints across all widths match ethers`, () => {
        resetRng();
        for (let i = 0; i < ITER; i++) {
            const bits = randIntRange(1, 256);
            const v = randomBigUint(bits);
            expect(Array.from(u.toBeArray(v))).toEqual(Array.from(ethers.toBeArray(v)));
        }
    });
});

// ===========================================================================
//                              getAddress (EIP-55)
// ===========================================================================

describe('getAddress', () => {
    test.each([
        '0x52908400098527886E0F7030069857D2E4169EE7',
        '0x8617E340B3D01FA5F11F306F4090FD50E238070D',
        '0xde709f2102306220921060314715629080e2fb77',
        '0x27b1fdb04752bbc536007a920d24acb045561c26',
        '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
        '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359',
        '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB',
        '0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb',
    ])('EIP-55 spec vector %s — all casings agree', (vec) => {
        const lower = vec.toLowerCase();
        const upper = '0x' + vec.slice(2).toUpperCase();
        for (const variant of [lower, upper, vec]) {
            const ours = u.getAddress(variant);
            expect(ours).toBe(ethers.getAddress(variant));
            expect(ours).toBe(viem.getAddress(variant));
        }
    });

    test('accepts address without 0x prefix', () => {
        const naked = ADDR_LOWER.slice(2);
        expect(u.getAddress(naked)).toBe(ADDR_CHECKSUMMED);
        expect(u.getAddress(naked)).toBe(ethers.getAddress(naked));
    });

    test('rejects malformed input', () => {
        expect(() => u.getAddress('0x123')).toThrow();
        expect(() => u.getAddress('not hex')).toThrow();
        expect(() => u.getAddress('0x' + 'z'.repeat(40))).toThrow();
        expect(() => u.getAddress(123)).toThrow();
        expect(() => u.getAddress(null)).toThrow();
    });

    test(`property: ${ITER} random addresses checksum identically across libs`, () => {
        resetRng();
        for (let i = 0; i < ITER; i++) {
            const lower = '0x' + Array.from(randomBytes(20))
                .map((b) => b.toString(16).padStart(2, '0')).join('');
            const upper = '0x' + lower.slice(2).toUpperCase();
            const checksum = u.getAddress(lower);
            expect(checksum).toBe(ethers.getAddress(lower));
            expect(checksum).toBe(viem.getAddress(lower));
            // Round-trip from uppercase / checksummed / naked.
            expect(u.getAddress(upper)).toBe(checksum);
            expect(u.getAddress(checksum)).toBe(checksum);
            expect(u.getAddress(lower.slice(2))).toBe(checksum);
        }
    });

    test(`property: ${ITER} mutated checksums are rejected`, () => {
        resetRng();
        for (let i = 0; i < ITER; i++) {
            const lower = '0x' + Array.from(randomBytes(20))
                .map((b) => b.toString(16).padStart(2, '0')).join('');
            const checksum = u.getAddress(lower);
            // Find a hex letter to flip case; numeric chars have no case to break.
            let pos = -1;
            for (let j = 2; j < checksum.length; j++) {
                if (/[A-Fa-f]/.test(checksum[j])) { pos = j; break; }
            }
            if (pos < 0) continue;
            const flipped = checksum[pos] === checksum[pos].toUpperCase()
                ? checksum[pos].toLowerCase()
                : checksum[pos].toUpperCase();
            const broken = checksum.slice(0, pos) + flipped + checksum.slice(pos + 1);
            // ethers + ours reject a mixed-case-with-bad-checksum input.
            // viem deliberately diverges: viem.getAddress just re-normalizes
            // (its `isAddress(..., { strict: false })` check ignores the
            // case), so a broken-checksum string round-trips silently
            // — we don't assert anything against viem here.
            expect(() => u.getAddress(broken)).toThrow(/checksum/);
            expect(() => ethers.getAddress(broken)).toThrow();
        }
    });
});

// ===========================================================================
//                              isAddress
// ===========================================================================

describe('isAddress', () => {
    test.each([
        [ADDR_CHECKSUMMED, true],
        [ADDR_LOWER, true],
        ['0x' + ADDR_LOWER.slice(2).toUpperCase(), true],
        ['0x123', false],
        ['not an address', false],
        ['', false],
        [null, false],
        [undefined, false],
        [12345, false],
    ])('matches ethers on %j', (input, expected) => {
        expect(u.isAddress(input)).toBe(expected);
        expect(u.isAddress(input)).toBe(ethers.isAddress(input));
    });

    test(`property: ${ITER} random checksummed addresses → true (ethers+viem)`, () => {
        resetRng();
        for (let i = 0; i < ITER; i++) {
            const a = randomAddress();
            expect(u.isAddress(a)).toBe(true);
            expect(ethers.isAddress(a)).toBe(true);
            expect(viem.isAddress(a)).toBe(true);
        }
    });

    test(`property: ${ITER} random non-addresses → false (ethers parity)`, () => {
        resetRng();
        const generators = [
            () => randomHex(randInt(20)),                  // too short
            () => randomHex(randIntRange(21, 64)),         // too long
            () => 'not-an-address-' + randInt(1e6),        // junk
            () => '0xZZZ' + randomHex(20).slice(2),        // bad nibbles
            () => randInt(1e6),                            // non-string
        ];
        for (let i = 0; i < ITER; i++) {
            const v = generators[i % generators.length]();
            expect(u.isAddress(v)).toBe(ethers.isAddress(v));
        }
    });
});

// ===========================================================================
//                              encodeAbiParameters / decodeAbiParameters
// ===========================================================================

describe('encodeAbiParameters / decodeAbiParameters', () => {
    // Fixed spec/edge fixtures (preserved for regression value).
    const cases = [
        ['address + uint256', ['address', 'uint256'], [ADDR_CHECKSUMMED, 1234567890n]],
        ['bool + bytes32', ['bool', 'bytes32'], [true, '0x' + '11'.repeat(32)]],
        ['bytes (dynamic)', ['bytes'], ['0xdeadbeefcafe']],
        ['empty bytes', ['bytes'], ['0x']],
        ['string', ['string'], ['hello, ABI world!']],
        ['empty string', ['string'], ['']],
        ['unicode string', ['string'], ['日本語 🦀']],
        ['address[] dynamic', ['address[]'], [[ADDR_CHECKSUMMED, ADDR_LOWER]]],
        ['empty address[]', ['address[]'], [[]]],
        ['uint256[5] fixed', ['uint256[5]'], [[1n, 2n, 3n, 4n, 5n]]],
        ['bytes32[]', ['bytes32[]'], [['0x' + 'aa'.repeat(32), '0x' + 'bb'.repeat(32)]]],
        ['tuple', ['(uint8,bytes)'], [[7, '0xabcd']]],
        ['nested tuple', ['(bytes32,bytes32,bytes32,uint256,address)'],
            [['0x' + 'aa'.repeat(32), '0x' + 'bb'.repeat(32), '0x' + 'cc'.repeat(32), 99n, ADDR_CHECKSUMMED]],
        ],
        ['multiple uint widths',
            ['uint8', 'uint48', 'uint64', 'uint128', 'uint192', 'uint256'],
            [255n, 0x010203040506n, 0x1122334455667788n, 1n << 100n, 1n << 150n, 1n << 250n],
        ],
        ['int signed positive', ['int256'], [12345n]],
        ['int signed negative', ['int256'], [-12345n]],
        ['int8 boundary low', ['int8'], [-128n]],
        ['int8 boundary high', ['int8'], [127n]],
        ['uint256 max', ['uint256'], [(1n << 256n) - 1n]],
    ];

    test.each(cases)('encodes %s identically to ethers + viem', (_label, types, values) => {
        const ours = u.encodeAbiParameters(types, values);
        expect(ours).toBe(ethers.AbiCoder.defaultAbiCoder().encode(types, values));
        const viemParams = viem.parseAbiParameters(types.join(','));
        expect(ours).toBe(viem.encodeAbiParameters(viemParams, values));
    });

    test.each(cases)('round-trips %s through decodeAbiParameters', (_label, types, values) => {
        const encoded = u.encodeAbiParameters(types, values);
        const decoded = u.decodeAbiParameters(types, encoded);
        const ethersDecoded = ethers.AbiCoder.defaultAbiCoder().decode(types, encoded);
        expect(JSON.stringify(decoded, bigintReplacer)).toBe(
            JSON.stringify([...ethersDecoded], bigintReplacer),
        );
    });

    test('decodes ethers-produced payloads (interop)', () => {
        const types = ['address', 'uint256', 'bytes'];
        const values = [ADDR_CHECKSUMMED, 999n, '0xc0ffeeee'];
        const encoded = ethers.AbiCoder.defaultAbiCoder().encode(types, values);
        const decoded = u.decodeAbiParameters(types, encoded);
        expect(decoded[0]).toBe(ADDR_CHECKSUMMED);
        expect(decoded[1]).toBe(999n);
        expect(decoded[2]).toBe('0xc0ffeeee');
    });

    test('rejects type/value count mismatch', () => {
        expect(() => u.encodeAbiParameters(['uint256', 'address'], [1n])).toThrow();
    });
    test('rejects uint overflow', () => {
        expect(() => u.encodeAbiParameters(['uint8'], [256n])).toThrow(/uint8/);
    });
    test('rejects negative uint', () => {
        expect(() => u.encodeAbiParameters(['uint256'], [-1n])).toThrow();
    });
    test('rejects int out-of-bounds', () => {
        expect(() => u.encodeAbiParameters(['int8'], [128n])).toThrow(/int8/);
        expect(() => u.encodeAbiParameters(['int8'], [-129n])).toThrow(/int8/);
    });
    test('rejects bytesN wrong length', () => {
        expect(() => u.encodeAbiParameters(['bytes4'], ['0xdeadbeef00'])).toThrow();
    });
    test('rejects fixed-array length mismatch', () => {
        expect(() => u.encodeAbiParameters(['uint256[3]'], [[1n, 2n]])).toThrow();
    });

    // Random parameter-list generator.
    function genAtomicType() {
        const buckets = [
            () => 'address',
            () => 'bool',
            () => 'bytes',
            () => 'string',
            () => 'uint' + pick([8, 16, 32, 64, 128, 192, 256]),
            () => 'int' + pick([8, 16, 32, 64, 128, 256]),
            () => 'bytes' + pick([1, 2, 4, 8, 16, 20, 32]),
        ];
        return pick(buckets)();
    }
    function genType(depth = 0) {
        // Optionally wrap in an array; cap nesting depth.
        const base = genAtomicType();
        if (depth >= 2) return base;
        const r = rng();
        if (r < 0.7) return base;
        if (r < 0.85) return base + '[]';
        return base + '[' + randIntRange(1, 4) + ']';
    }
    function genValue(type) {
        const arrMatch = type.match(/^(.+?)(\[(\d*)\])$/);
        if (arrMatch) {
            const inner = arrMatch[1];
            const fixed = arrMatch[3];
            const len = fixed ? parseInt(fixed) : randInt(5);
            return Array.from({ length: len }, () => genValue(inner));
        }
        if (type === 'address') return randomAddress();
        if (type === 'bool') return rng() < 0.5;
        if (type === 'bytes') return randomHex(randInt(65));
        if (type === 'string') return randomUtf8String(64);
        const um = type.match(/^(u?)int(\d+)$/);
        if (um) {
            const bits = parseInt(um[2]);
            return um[1] === 'u' ? randomBigUint(bits) : randomSignedBigInt(bits);
        }
        const bm = type.match(/^bytes(\d+)$/);
        if (bm) return randomHex(parseInt(bm[1]));
        throw new Error('unsupported gen type ' + type);
    }

    test(`property: ${ITER} random parameter lists encode identically to ethers + viem`, () => {
        resetRng();
        for (let i = 0; i < ITER; i++) {
            const n = randIntRange(1, 5);
            const types = Array.from({ length: n }, () => genType());
            const values = types.map((t) => genValue(t));
            const ours = u.encodeAbiParameters(types, values);
            const refEthers = ethers.AbiCoder.defaultAbiCoder().encode(types, values);
            expect(ours).toBe(refEthers);
            const viemParams = viem.parseAbiParameters(types.join(','));
            expect(ours).toBe(viem.encodeAbiParameters(viemParams, values));
        }
    });

    test(`property: ${ITER} random parameter lists round-trip through decode`, () => {
        resetRng();
        for (let i = 0; i < ITER; i++) {
            const n = randIntRange(1, 5);
            const types = Array.from({ length: n }, () => genType());
            const values = types.map((t) => genValue(t));
            const encoded = u.encodeAbiParameters(types, values);
            const ours = u.decodeAbiParameters(types, encoded);
            const ref = ethers.AbiCoder.defaultAbiCoder().decode(types, encoded);
            expect(JSON.stringify(ours, bigintReplacer)).toBe(
                JSON.stringify([...ref], bigintReplacer),
            );
        }
    });
});

// ===========================================================================
//                              solidityPacked / solidityPackedKeccak256
// ===========================================================================

describe('solidityPacked / solidityPackedKeccak256', () => {
    const cases = [
        ['mixed uint+address+bytes',
            ['uint256', 'address', 'bytes'], [0xdeadbeefn, ADDR_CHECKSUMMED, '0xc0ffee']],
        ['uint8 + uint48 + uint48 + bytes',
            ['uint8', 'uint48', 'uint48', 'bytes'], [1, 100n, 200n, '0x1234']],
        ['bytes1 + uint48 + uint48 + bytes',
            ['bytes1', 'uint48', 'uint48', 'bytes'], ['0x01', 100n, 200n, '0xabcdef']],
        ['bool packing', ['bool', 'bool'], [true, false]],
        ['bytesN exact', ['bytes32'], ['0x' + '7e'.repeat(32)]],
        ['string + bytes', ['string', 'bytes'], ['hello', '0xdead']],
        ['int negative', ['int256'], [-1n]],
    ];

    test.each(cases)('solidityPacked %s matches ethers + viem', (_label, types, values) => {
        const ours = u.solidityPacked(types, values);
        expect(ours).toBe(ethers.solidityPacked(types, values));
        expect(ours).toBe(viem.encodePacked(types, values));
    });
    test.each(cases)('solidityPackedKeccak256 %s matches ethers + viem', (_label, types, values) => {
        const ours = u.solidityPackedKeccak256(types, values);
        expect(ours).toBe(ethers.solidityPackedKeccak256(types, values));
        expect(ours).toBe(viem.keccak256(viem.encodePacked(types, values)));
    });
    test('rejects type/value count mismatch', () => {
        expect(() => u.solidityPacked(['uint256'], [1n, 2n])).toThrow();
    });
    test('rejects invalid type', () => {
        expect(() => u.solidityPacked(['notatype'], ['0x'])).toThrow();
    });
    test('rejects bytesN wrong length', () => {
        expect(() => u.solidityPacked(['bytes4'], ['0xdeadbeef00'])).toThrow();
    });

    // For solidityPacked, ethers and viem agree across atomic types; we skip
    // arrays here because the two reference libs differ on packed array
    // encoding of certain types (notably bytes-element arrays).
    function genPackedType() {
        return pick([
            'address',
            'bool',
            'bytes',
            'string',
            'uint8', 'uint16', 'uint32', 'uint64', 'uint128', 'uint256',
            'int8', 'int16', 'int32', 'int64', 'int128', 'int256',
            'bytes1', 'bytes4', 'bytes16', 'bytes32',
        ]);
    }
    function genPackedValue(type) {
        if (type === 'address') return randomAddress();
        if (type === 'bool') return rng() < 0.5;
        if (type === 'bytes') return randomHex(randInt(33));
        if (type === 'string') return randomUtf8String(32);
        const um = type.match(/^(u?)int(\d+)$/);
        if (um) {
            const bits = parseInt(um[2]);
            return um[1] === 'u' ? randomBigUint(bits) : randomSignedBigInt(bits);
        }
        const bm = type.match(/^bytes(\d+)$/);
        if (bm) return randomHex(parseInt(bm[1]));
        throw new Error(type);
    }

    test(`property: ${ITER} random packed encodings match ethers + viem`, () => {
        resetRng();
        for (let i = 0; i < ITER; i++) {
            const n = randIntRange(1, 6);
            const types = Array.from({ length: n }, () => genPackedType());
            const values = types.map((t) => genPackedValue(t));
            const ours = u.solidityPacked(types, values);
            expect(ours).toBe(ethers.solidityPacked(types, values));
            expect(ours).toBe(viem.encodePacked(types, values));
            const oursK = u.solidityPackedKeccak256(types, values);
            expect(oursK).toBe(ethers.solidityPackedKeccak256(types, values));
            expect(oursK).toBe(viem.keccak256(viem.encodePacked(types, values)));
        }
    });
});

// ===========================================================================
//                              hashTypedData (EIP-712)
// ===========================================================================

describe('hashTypedData', () => {
    const mailDomain = {
        name: 'Ether Mail',
        version: '1',
        chainId: 1n,
        verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC',
    };
    const mailTypes = {
        Person: [
            { name: 'name', type: 'string' },
            { name: 'wallet', type: 'address' },
        ],
        Mail: [
            { name: 'from', type: 'Person' },
            { name: 'to', type: 'Person' },
            { name: 'contents', type: 'string' },
        ],
    };
    const mailMessage = {
        from: { name: 'Cow', wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826' },
        to: { name: 'Bob', wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB' },
        contents: 'Hello, Bob!',
    };

    test('Mail example matches ethers + viem', () => {
        const ours = u.hashTypedData(mailDomain, mailTypes, mailMessage);
        expect(ours).toBe(ethers.TypedDataEncoder.hash(mailDomain, mailTypes, mailMessage));
        expect(ours).toBe(viem.hashTypedData({
            domain: mailDomain, types: mailTypes, primaryType: 'Mail', message: mailMessage,
        }));
    });

    test('strips EIP712Domain entry from types if present', () => {
        const withDomainType = {
            EIP712Domain: [
                { name: 'name', type: 'string' },
                { name: 'version', type: 'string' },
                { name: 'chainId', type: 'uint256' },
                { name: 'verifyingContract', type: 'address' },
            ],
            ...mailTypes,
        };
        expect(u.hashTypedData(mailDomain, withDomainType, mailMessage))
            .toBe(u.hashTypedData(mailDomain, mailTypes, mailMessage));
    });

    test('Safe-style domain (chainId + verifyingContract only)', () => {
        const d = { chainId: 11155111n, verifyingContract: '0x1234567890123456789012345678901234567890' };
        const t = { SafeMessage: [{ name: 'message', type: 'bytes' }] };
        const m = { message: '0xdeadbeef' };
        expect(u.hashTypedData(d, t, m)).toBe(ethers.TypedDataEncoder.hash(d, t, m));
        expect(u.hashTypedData(d, t, m)).toBe(
            viem.hashTypedData({ domain: d, types: t, primaryType: 'SafeMessage', message: m }),
        );
    });

    test('struct-array of nested structs (Person[])', () => {
        const d = { name: 'Group', version: '1', chainId: 1n };
        const t = {
            Person: [{ name: 'name', type: 'string' }, { name: 'wallet', type: 'address' }],
            Group: [{ name: 'members', type: 'Person[]' }],
        };
        const m = { members: [
            { name: 'Alice', wallet: ADDR_CHECKSUMMED },
            { name: 'Bob', wallet: ADDR_CHECKSUMMED },
        ]};
        expect(u.hashTypedData(d, t, m)).toBe(ethers.TypedDataEncoder.hash(d, t, m));
    });

    test('domain with salt', () => {
        const d = {
            name: 'Salted', version: '1', chainId: 1n,
            verifyingContract: ADDR_CHECKSUMMED, salt: '0x' + '99'.repeat(32),
        };
        const t = { Tx: [{ name: 'op', type: 'uint256' }] };
        expect(u.hashTypedData(d, t, { op: 7n })).toBe(
            ethers.TypedDataEncoder.hash(d, t, { op: 7n }),
        );
    });

    test('rejects ambiguous (multi-root) types', () => {
        const d = { name: 'X', version: '1', chainId: 1n };
        const t = { A: [{ name: 'x', type: 'uint256' }], B: [{ name: 'y', type: 'uint256' }] };
        expect(() => u.hashTypedData(d, t, { x: 1n })).toThrow();
    });

    test('rejects circular type references', () => {
        const d = { name: 'Cycle', version: '1', chainId: 1n };
        const t = { Node: [{ name: 'next', type: 'Node' }] };
        expect(() => u.hashTypedData(d, t, { next: null })).toThrow(/circular/);
    });

    // Property: random domain + random message with stable type schema.
    function randomDomain() {
        // Randomly include/exclude each domain field.
        const d = {};
        if (rng() < 0.7) d.name = randomUtf8String(20);
        if (rng() < 0.7) d.version = String(randIntRange(1, 9));
        if (rng() < 0.7) d.chainId = randomBigUint(64);
        if (rng() < 0.7) d.verifyingContract = randomAddress();
        if (rng() < 0.3) d.salt = randomHex(32);
        // Ensure at least one domain field present.
        if (Object.keys(d).length === 0) d.chainId = 1n;
        return d;
    }

    test(`property: ${ITER} random Mail-shaped messages match ethers + viem`, () => {
        resetRng();
        for (let i = 0; i < ITER; i++) {
            const d = randomDomain();
            const m = {
                from: { name: randomUtf8String(16), wallet: randomAddress() },
                to:   { name: randomUtf8String(16), wallet: randomAddress() },
                contents: randomUtf8String(64),
            };
            const ours = u.hashTypedData(d, mailTypes, m);
            expect(ours).toBe(ethers.TypedDataEncoder.hash(d, mailTypes, m));
            expect(ours).toBe(viem.hashTypedData({
                domain: d, types: mailTypes, primaryType: 'Mail', message: m,
            }));
        }
    });

    test(`property: ${ITER} random Safe-style messages match ethers + viem`, () => {
        resetRng();
        const t = { SafeMessage: [{ name: 'message', type: 'bytes' }] };
        for (let i = 0; i < ITER; i++) {
            const d = randomDomain();
            const m = { message: randomHex(randInt(65)) };
            const ours = u.hashTypedData(d, t, m);
            expect(ours).toBe(ethers.TypedDataEncoder.hash(d, t, m));
            expect(ours).toBe(viem.hashTypedData({
                domain: d, types: t, primaryType: 'SafeMessage', message: m,
            }));
        }
    });

    test(`property: ${ITER} random bytes32[] messages match ethers`, () => {
        resetRng();
        const t = { Wrapper: [{ name: 'leaves', type: 'bytes32[]' }] };
        for (let i = 0; i < ITER; i++) {
            const d = randomDomain();
            const n = randInt(8);
            const m = { leaves: Array.from({ length: n }, () => randomHex(32)) };
            expect(u.hashTypedData(d, t, m)).toBe(ethers.TypedDataEncoder.hash(d, t, m));
        }
    });
});

// ===========================================================================
//                              encodeRlp
// ===========================================================================

describe('encodeRlp', () => {
    test.each([
        ['empty string', '0x'],
        ['single byte < 0x80', '0x7f'],
        ['single byte = 0x80', '0x80'],
        ['short string', '0x' + '01'.repeat(10)],
        ['exactly 55 bytes', '0x' + 'ab'.repeat(55)],
        ['56 bytes (long-form length prefix)', '0x' + 'ab'.repeat(56)],
        ['256 bytes', '0x' + 'cd'.repeat(256)],
        ['1024 bytes', '0x' + 'ef'.repeat(1024)],
    ])('matches ethers + viem on %s', (_label, data) => {
        const ours = u.encodeRlp(data);
        expect(ours).toBe(ethers.encodeRlp(data));
        expect(ours).toBe(viem.toRlp(data));
    });

    test('nested arrays match ethers + viem', () => {
        const nested = ['0x01', ['0x02', '0x03'], '0x04'];
        expect(u.encodeRlp(nested)).toBe(ethers.encodeRlp(nested));
        expect(u.encodeRlp(nested)).toBe(viem.toRlp(nested));
    });

    test('deeply nested arrays match ethers', () => {
        const deep = [[[['0x01']], '0x02'], ['0x03', [['0x04', '0x05']]]];
        expect(u.encodeRlp(deep)).toBe(ethers.encodeRlp(deep));
    });

    test('empty list', () => {
        expect(u.encodeRlp([])).toBe(ethers.encodeRlp([]));
        expect(u.encodeRlp([])).toBe(viem.toRlp([]));
    });

    test('list payload exceeding 55 bytes', () => {
        const big = Array.from({ length: 20 }, () => '0x' + 'ab'.repeat(4));
        expect(u.encodeRlp(big)).toBe(ethers.encodeRlp(big));
    });

    test('EIP-7702 authorization-tuple shape', () => {
        const tuple = ['0x01', '0x' + 'ab'.repeat(20), '0x'];
        expect(u.encodeRlp(tuple)).toBe(ethers.encodeRlp(tuple));
        expect(u.encodeRlp(tuple)).toBe(viem.toRlp(tuple));
    });

    function genRlp(depth = 0) {
        // Generate a tree: leaves are short hex bytestrings; branches are
        // arrays. Depth bounded to keep total size sane.
        const isArray = depth < 3 && rng() < 0.4;
        if (isArray) {
            const n = randInt(5);
            return Array.from({ length: n }, () => genRlp(depth + 1));
        }
        return randomHex(randInt(80));
    }

    test(`property: ${ITER} random RLP trees match ethers + viem`, () => {
        resetRng();
        for (let i = 0; i < ITER; i++) {
            const tree = genRlp();
            const ours = u.encodeRlp(tree);
            expect(ours).toBe(ethers.encodeRlp(tree));
            expect(ours).toBe(viem.toRlp(tree));
        }
    });
});

// ===========================================================================
//                              privateKeyToAddress
// ===========================================================================

describe('privateKeyToAddress', () => {
    test('matches ethers Wallet.address and viem privateKeyToAddress', () => {
        const ours = u.privateKeyToAddress(PK);
        expect(ours).toBe(new ethers.Wallet(PK).address);
        expect(ours).toBe(viemAccounts.privateKeyToAddress(PK));
    });

    test('accepts private key without 0x prefix', () => {
        expect(u.privateKeyToAddress(PK_NO_PREFIX)).toBe(u.privateKeyToAddress(PK));
    });

    test('output is EIP-55 checksummed', () => {
        const addr = u.privateKeyToAddress(PK);
        expect(addr).toBe(u.getAddress(addr));
    });

    test(`property: ${ITER} random private keys → identical addresses across libs`, () => {
        resetRng();
        for (let i = 0; i < ITER; i++) {
            const pk = randomPrivateKey();
            const ours = u.privateKeyToAddress(pk);
            expect(ours).toBe(new ethers.Wallet(pk).address);
            expect(ours).toBe(viemAccounts.privateKeyToAddress(pk));
            // Also confirm prefix-stripping matches.
            expect(u.privateKeyToAddress(pk.slice(2))).toBe(ours);
        }
    });
});

// ===========================================================================
//                              signHash
// ===========================================================================

describe('signHash', () => {
    test('r, s, yParity, v match ethers signingKey.sign', () => {
        const ours = u.signHash(PK, DIGEST_32);
        const ref = new ethers.Wallet(PK).signingKey.sign(DIGEST_32);
        expect(ours.r).toBe(ref.r);
        expect(ours.s).toBe(ref.s);
        expect(ours.yParity).toBe(ref.yParity);
        expect(ours.v).toBe(ref.v);
        expect(ours.serialized).toBe(ref.serialized);
    });

    test('serialized signature matches viem sign + concatenated form', async () => {
        const ours = u.signHash(PK, DIGEST_32);
        const viemSig = await viemAccounts.sign({ hash: DIGEST_32, privateKey: PK });
        const r = viemSig.r.slice(2);
        const s = viemSig.s.slice(2);
        const v = Number(viemSig.v).toString(16).padStart(2, '0');
        expect(ours.serialized.toLowerCase()).toBe(('0x' + r + s + v).toLowerCase());
    });

    test('signature recovers to the correct address', () => {
        const expected = u.privateKeyToAddress(PK);
        const ours = u.signHash(PK, DIGEST_32);
        expect(ethers.recoverAddress(DIGEST_32, ours.serialized)).toBe(expected);
    });

    test('accepts Uint8Array hash input', () => {
        const hashBytes = u.getBytes(DIGEST_32);
        expect(u.signHash(PK, hashBytes).serialized).toBe(u.signHash(PK, DIGEST_32).serialized);
    });

    test('accepts private key without 0x prefix', () => {
        expect(u.signHash(PK_NO_PREFIX, DIGEST_32).serialized).toBe(
            u.signHash(PK, DIGEST_32).serialized,
        );
    });

    test('signatures are deterministic (RFC6979)', () => {
        expect(u.signHash(PK, DIGEST_32).serialized).toBe(u.signHash(PK, DIGEST_32).serialized);
    });

    test('rejects hash that is not 32 bytes', () => {
        expect(() => u.signHash(PK, '0xdeadbeef')).toThrow(/invalid digest length/);
        expect(() => u.signHash(PK, '0x' + 'ab'.repeat(31))).toThrow(/invalid digest length/);
    });

    test('low-s normalization: produced s is always <= n/2', () => {
        const N_HALF =
            0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n;
        for (let i = 0; i < 8; i++) {
            const hash = u.keccak256('0x' + i.toString(16).padStart(2, '0'));
            const sig = u.signHash(PK, hash);
            expect(BigInt(sig.s) <= N_HALF).toBe(true);
        }
    });

    test('yParity ∈ {0, 1} and v = 27 + yParity', () => {
        for (let i = 0; i < 8; i++) {
            const hash = u.keccak256('0x' + i.toString(16).padStart(2, '0'));
            const sig = u.signHash(PK, hash);
            expect([0, 1]).toContain(sig.yParity);
            expect(sig.v).toBe(27 + sig.yParity);
        }
    });

    test(`property: ${SIGN_ITER} random (pk, hash) pairs match ethers + recover correctly`, async () => {
        resetRng();
        const N_HALF =
            0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n;
        for (let i = 0; i < SIGN_ITER; i++) {
            const pk = randomPrivateKey();
            const hash = randomHex(32);
            const ours = u.signHash(pk, hash);
            const ref = new ethers.Wallet(pk).signingKey.sign(hash);
            expect(ours.r).toBe(ref.r);
            expect(ours.s).toBe(ref.s);
            expect(ours.v).toBe(ref.v);
            expect(ours.yParity).toBe(ref.yParity);
            expect(ours.serialized).toBe(ref.serialized);
            expect(BigInt(ours.s) <= N_HALF).toBe(true);
            // Recover via both libs.
            const expectedAddr = u.privateKeyToAddress(pk);
            expect(ethers.recoverAddress(hash, ours.serialized)).toBe(expectedAddr);
            const viemRecovered = await viem.recoverAddress({
                hash, signature: ours.serialized,
            });
            expect(viemRecovered).toBe(expectedAddr);
        }
    });
});

// ===========================================================================
//                              signTypedData
// ===========================================================================

describe('signTypedData', () => {
    const domain = {
        name: 'Ether Mail',
        version: '1',
        chainId: 1n,
        verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC',
    };
    const types = {
        Person: [
            { name: 'name', type: 'string' },
            { name: 'wallet', type: 'address' },
        ],
        Mail: [
            { name: 'from', type: 'Person' },
            { name: 'to', type: 'Person' },
            { name: 'contents', type: 'string' },
        ],
    };
    const message = {
        from: { name: 'Cow', wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826' },
        to: { name: 'Bob', wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB' },
        contents: 'Hello, Bob!',
    };

    test('matches ethers Wallet.signTypedData', async () => {
        const ours = u.signTypedData(PK, domain, types, message);
        const ref = await new ethers.Wallet(PK).signTypedData(domain, types, message);
        expect(ours).toBe(ref);
    });

    test('matches viem privateKeyToAccount.signTypedData', async () => {
        const ours = u.signTypedData(PK, domain, types, message);
        const viemSig = await viemAccounts.privateKeyToAccount(PK).signTypedData({
            domain, types, primaryType: 'Mail', message,
        });
        expect(ours).toBe(viemSig);
    });

    test('signature recovers to the signer address (ethers + viem)', async () => {
        const expected = u.privateKeyToAddress(PK);
        const sig = u.signTypedData(PK, domain, types, message);
        const digest = u.hashTypedData(domain, types, message);
        expect(ethers.recoverAddress(digest, sig)).toBe(expected);
        const viemRec = await viem.recoverTypedDataAddress({
            domain, types, primaryType: 'Mail', message, signature: sig,
        });
        expect(viemRec).toBe(expected);
    });

    test('accepts private key without 0x prefix', () => {
        expect(u.signTypedData(PK_NO_PREFIX, domain, types, message))
            .toBe(u.signTypedData(PK, domain, types, message));
    });

    test(`property: ${SIGN_ITER} random typed-data signings match ethers + viem`, async () => {
        resetRng();
        for (let i = 0; i < SIGN_ITER; i++) {
            const pk = randomPrivateKey();
            const d = {
                name: randomUtf8String(16),
                version: String(randIntRange(1, 9)),
                chainId: randomBigUint(64),
                verifyingContract: randomAddress(),
            };
            const m = {
                from: { name: randomUtf8String(16), wallet: randomAddress() },
                to:   { name: randomUtf8String(16), wallet: randomAddress() },
                contents: randomUtf8String(64),
            };
            const ours = u.signTypedData(pk, d, types, m);
            const refEthers = await new ethers.Wallet(pk).signTypedData(d, types, m);
            expect(ours).toBe(refEthers);
            const refViem = await viemAccounts.privateKeyToAccount(pk).signTypedData({
                domain: d, types, primaryType: 'Mail', message: m,
            });
            expect(ours).toBe(refViem);
        }
    });
});
