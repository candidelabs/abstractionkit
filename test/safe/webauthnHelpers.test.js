// Unit tests for the WebAuthn helpers added in signer/adapters.ts.
// Offline; no network, no real crypto. Synthetic fixtures verify shape
// + normalization + rejection paths.

const ak = require('../../dist/index.cjs');

const FIXTURE_PUBKEY = {
    x: 0x7a2fa39b3c61b3cbab8e44abeac8c9c7a4c1f76d42ae6f47b3b2a96d5c4f1a2bn,
    y: 0x2e8c5f6d4b7a9c1e3f5a8d7b6c4e2f1a9d8c7b6a5e4f3d2c1b0a9f8e7d6c5b4an,
};
const FIXTURE_AUTHENTICATOR_DATA_HEX =
    '49960de5880e8c687434170f6476605b8fe4aeb9a28632c7995cf3ba831d97630500000001';

function buildClientDataJSON(challengeB64Url, opts = {}) {
    const {
        fieldOrder = ['type', 'challenge', 'origin', 'crossOrigin'],
        extras = { origin: 'https://safe.global', crossOrigin: false },
    } = opts;
    const fields = {
        type: 'webauthn.get',
        challenge: challengeB64Url,
        ...extras,
    };
    const parts = fieldOrder.map((k) => `"${k}":${JSON.stringify(fields[k])}`);
    return `{${parts.join(',')}}`;
}

function hexToBytes(hex) {
    const body = hex.startsWith('0x') ? hex.slice(2) : hex;
    const out = new Uint8Array(body.length / 2);
    for (let i = 0; i < out.length; i++)
        out[i] = parseInt(body.slice(i * 2, i * 2 + 2), 16);
    return out;
}

// ─── pubkey JSON round-trip ──────────────────────────────────────────────

describe('pubkeyCoordinatesToJson / pubkeyCoordinatesFromJson', () => {
    test('round-trips a WebAuthn pubkey bit-for-bit', () => {
        const json = ak.pubkeyCoordinatesToJson(FIXTURE_PUBKEY);
        const parsed = ak.pubkeyCoordinatesFromJson(json);
        expect(parsed).toEqual(FIXTURE_PUBKEY);
    });

    test('serializes coords as 0x-hex strings (compact + safe to JSON-stringify)', () => {
        const json = ak.pubkeyCoordinatesToJson(FIXTURE_PUBKEY);
        const obj = JSON.parse(json);
        expect(obj.x.startsWith('0x')).toBe(true);
        expect(obj.y.startsWith('0x')).toBe(true);
        expect(BigInt(obj.x)).toBe(FIXTURE_PUBKEY.x);
        expect(BigInt(obj.y)).toBe(FIXTURE_PUBKEY.y);
    });

    test('fromJson accepts a pre-parsed object (skip JSON.parse)', () => {
        const obj = { x: '0x' + FIXTURE_PUBKEY.x.toString(16), y: '0x' + FIXTURE_PUBKEY.y.toString(16) };
        expect(ak.pubkeyCoordinatesFromJson(obj)).toEqual(FIXTURE_PUBKEY);
    });

    test('fromJson accepts decimal strings too', () => {
        const json = JSON.stringify({
            x: FIXTURE_PUBKEY.x.toString(10),
            y: FIXTURE_PUBKEY.y.toString(10),
        });
        expect(ak.pubkeyCoordinatesFromJson(json)).toEqual(FIXTURE_PUBKEY);
    });

    test('fromJson throws on malformed coords', () => {
        expect(() => ak.pubkeyCoordinatesFromJson('{"x":"not-hex","y":"0x1"}')).toThrow(
            /not a valid bigint/,
        );
        expect(() => ak.pubkeyCoordinatesFromJson('{"x":"0x1"}')).toThrow(/x, y.*both/);
    });
});

describe('pubkeyCoordinatesFromJson coerces non-bigint coords (object input)', () => {
    // toBigintPubkey lives internally; coercion paths are exercised
    // through pubkeyCoordinatesFromJson(obj), which accepts a pre-parsed
    // object and delegates to the same coercer.

    test('idempotent on bigint input', () => {
        expect(ak.pubkeyCoordinatesFromJson(FIXTURE_PUBKEY)).toEqual(FIXTURE_PUBKEY);
    });

    test('coerces hex-string and decimal-string coords to bigint', () => {
        const hex = ak.pubkeyCoordinatesFromJson({
            x: '0x' + FIXTURE_PUBKEY.x.toString(16),
            y: '0x' + FIXTURE_PUBKEY.y.toString(16),
        });
        expect(hex).toEqual(FIXTURE_PUBKEY);
        const dec = ak.pubkeyCoordinatesFromJson({
            x: FIXTURE_PUBKEY.x.toString(10),
            y: FIXTURE_PUBKEY.y.toString(10),
        });
        expect(dec).toEqual(FIXTURE_PUBKEY);
    });

    test('coerces small-integer numbers', () => {
        const c = ak.pubkeyCoordinatesFromJson({ x: 42, y: 7 });
        expect(c.x).toBe(42n);
        expect(c.y).toBe(7n);
    });

    test('rejects unsafe-integer numbers (precision loss)', () => {
        expect(() =>
            ak.pubkeyCoordinatesFromJson({ x: Number.MAX_SAFE_INTEGER + 1, y: 1n }),
        ).toThrow(/safe integer/);
    });

    test('rejects bool / object / unparseable strings', () => {
        expect(() => ak.pubkeyCoordinatesFromJson({ x: true, y: 1n })).toThrow(
            /bigint, string, or number/,
        );
        expect(() => ak.pubkeyCoordinatesFromJson({ x: 'garbage', y: 1n })).toThrow(
            /not a valid bigint/,
        );
        expect(() => ak.pubkeyCoordinatesFromJson({ x: undefined, y: 1n })).toThrow(/x, y.*both/);
    });

    test('rejects negative coords (would break canonical round-trip)', () => {
        // pubkeyCoordinatesToJson({ x: -1n, ... }) would emit "0x-1", which
        // isn't valid hex and breaks round-trip. P-256 coords are
        // non-negative by definition — reject at the coercion boundary.
        expect(() => ak.pubkeyCoordinatesFromJson({ x: -1n, y: 1n })).toThrow(/non-negative/);
        expect(() => ak.pubkeyCoordinatesFromJson({ x: '-1', y: 1n })).toThrow(/non-negative/);
        expect(() => ak.pubkeyCoordinatesFromJson({ x: -42, y: 1n })).toThrow(/non-negative/);
    });

    test('toBigintPubkey is not exported (internal-only)', () => {
        expect(ak.toBigintPubkey).toBeUndefined();
    });
});

// ─── webauthnSignatureFromAssertion ──────────────────────────────────────

describe('webauthnSignatureFromAssertion: input shape normalization', () => {
    function buildAssertion(overrides = {}) {
        return {
            authenticatorData: hexToBytes(FIXTURE_AUTHENTICATOR_DATA_HEX),
            clientDataJSON: buildClientDataJSON('AA'),
            signature: { r: 1n, s: 2n },
            ...overrides,
        };
    }

    test('Uint8Array authenticatorData → ArrayBuffer output', () => {
        const out = ak.webauthnSignatureFromAssertion(buildAssertion());
        expect(out.authenticatorData instanceof ArrayBuffer).toBe(true);
        expect(out.rs).toEqual([1n, 2n]);
    });

    test('ArrayBuffer authenticatorData accepted', () => {
        const u8 = hexToBytes(FIXTURE_AUTHENTICATOR_DATA_HEX);
        const ab = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
        const out = ak.webauthnSignatureFromAssertion(buildAssertion({ authenticatorData: ab }));
        expect(out.authenticatorData instanceof ArrayBuffer).toBe(true);
    });

    test('hex-string authenticatorData (`0x` shape) accepted', () => {
        const out = ak.webauthnSignatureFromAssertion(
            buildAssertion({ authenticatorData: '0x' + FIXTURE_AUTHENTICATOR_DATA_HEX }),
        );
        expect(out.authenticatorData instanceof ArrayBuffer).toBe(true);
        expect(out.authenticatorData.byteLength).toBe(37);
    });

    test('malformed hex authenticatorData throws (no silent zero-coercion)', () => {
        // ethers' getBytes rejects non-hex characters; a permissive parser
        // would silently coerce `parseInt("zz", 16)` (NaN) into 0.
        expect(() =>
            ak.webauthnSignatureFromAssertion(
                buildAssertion({ authenticatorData: '0xzz' + FIXTURE_AUTHENTICATOR_DATA_HEX.slice(2) }),
            ),
        ).toThrow(/invalid BytesLike value/);
    });

    test('partial-hex pair throws (parseInt would silently truncate)', () => {
        // `Number.parseInt("1g", 16)` returns 1 (parseInt stops at the first
        // non-hex char). ethers' getBytes refuses the whole input instead.
        expect(() =>
            ak.webauthnSignatureFromAssertion(
                buildAssertion({ authenticatorData: '0x1g' + FIXTURE_AUTHENTICATOR_DATA_HEX.slice(2) }),
            ),
        ).toThrow(/invalid BytesLike value/);
    });

    test('clientDataJSON: string and buffer both work', () => {
        const str = buildClientDataJSON('AA');
        const buf = new TextEncoder().encode(str);
        const fromStr = ak.webauthnSignatureFromAssertion(buildAssertion({ clientDataJSON: str }));
        const fromBuf = ak.webauthnSignatureFromAssertion(buildAssertion({ clientDataJSON: buf }));
        expect(fromStr.clientDataFields).toBe(fromBuf.clientDataFields);
    });

    test('signature: pre-parsed { r, s } and DER buffer both work', () => {
        // DER for r=0x01, s=0x02: 30 06 02 01 01 02 01 02
        const der = new Uint8Array([0x30, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01, 0x02]);
        const fromDer = ak.webauthnSignatureFromAssertion(buildAssertion({ signature: der }));
        expect(fromDer.rs).toEqual([1n, 2n]);
    });
});

describe('webauthnSignatureFromAssertion: clientDataJSON validation', () => {
    function withCD(clientDataJSON) {
        return ak.webauthnSignatureFromAssertion({
            authenticatorData: new Uint8Array(37),
            clientDataJSON,
            signature: { r: 1n, s: 2n },
        });
    }

    test('accepts canonical clientDataJSON', () => {
        const out = withCD(buildClientDataJSON('AA'));
        expect(out.clientDataFields.startsWith('0x')).toBe(true);
        expect(out.clientDataFields).not.toContain('type'); // type stripped
        expect(out.clientDataFields).not.toContain('challenge'); // challenge stripped
    });

    test('Safari-style field reorder doesn\'t break extraction', () => {
        const out = withCD(
            buildClientDataJSON('AA', {
                fieldOrder: ['type', 'crossOrigin', 'origin', 'challenge'],
            }),
        );
        expect(out.clientDataFields.startsWith('0x')).toBe(true);
    });

    test('rejects invalid JSON with clear error', () => {
        expect(() => withCD('{not valid json')).toThrow(/clientDataJSON is not valid JSON/);
    });

    test('rejects null / array / primitive (not a plain object)', () => {
        expect(() => withCD('null')).toThrow(/must parse to a plain object.*null/);
        expect(() => withCD('[1,2,3]')).toThrow(/must parse to a plain object.*array/);
        expect(() => withCD('"foo"')).toThrow(/must parse to a plain object.*string/);
        expect(() => withCD('42')).toThrow(/must parse to a plain object.*number/);
    });
});

describe('parseDerP256Signature: bounds checks', () => {
    function withSig(signature) {
        return ak.webauthnSignatureFromAssertion({
            authenticatorData: new Uint8Array(37),
            clientDataJSON: '{"type":"webauthn.get","challenge":"AA"}',
            signature,
        });
    }

    test('valid minimal DER is accepted', () => {
        const der = new Uint8Array([0x30, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01, 0x02]);
        const out = withSig(der);
        expect(out.rs).toEqual([1n, 2n]);
    });

    test('truncated DER (rLen claims more than buffer holds) throws', () => {
        const truncated = new Uint8Array([
            0x30, 0x46,
            0x02, 0xc8, // rLen = 200 (impossibly large for what follows)
            0x11, 0x22, 0x33, 0x44, 0x55, 0x66,
        ]);
        expect(() => withSig(truncated)).toThrow(/malformed DER signature/);
    });

    test('zero-length r throws', () => {
        const zeroR = new Uint8Array([
            0x30, 0x06,
            0x02, 0x00, // rLen = 0, invalid
            0x02, 0x02, 0x11, 0x22,
        ]);
        expect(() => withSig(zeroR)).toThrow(/malformed DER signature/);
    });

    test('wrong tag byte throws', () => {
        const wrongTag = new Uint8Array([
            0x30, 0x08,
            0x03, 0x02, 0x11, 0x22, // OCTET STRING tag (0x03), not INTEGER (0x02)
            0x02, 0x02, 0x33, 0x44,
        ]);
        expect(() => withSig(wrongTag)).toThrow(/malformed DER signature/);
    });

    test('outer-length mismatch (claims fewer bytes than present) throws', () => {
        // Valid r/s but outer SEQUENCE length understates by 1.
        const understated = new Uint8Array([
            0x30, 0x05, // claims 5, but body below is 6
            0x02, 0x01, 0x01,
            0x02, 0x01, 0x02,
        ]);
        expect(() => withSig(understated)).toThrow(/malformed DER signature/);
    });

    test('trailing garbage after s throws', () => {
        // Outer length covers the trailing byte, so the inner bounds checks
        // pass — only the post-s length equality catches it.
        const trailing = new Uint8Array([
            0x30, 0x07,
            0x02, 0x01, 0x01,
            0x02, 0x01, 0x02,
            0xff, // garbage byte still inside outer length
        ]);
        expect(() => withSig(trailing)).toThrow(/malformed DER signature/);
    });

    test('low-S normalization: high-S input is folded into the low half', () => {
        // s = N - 1, which is > N/2 → should normalize to s = 1
        const N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
        const sHigh = N - 1n;
        const sBytes = [];
        let v = sHigh;
        while (v > 0n) {
            sBytes.unshift(Number(v & 0xffn));
            v >>= 8n;
        }
        // Body: 3 bytes for r (tag+len+value) + 2 bytes for s header + sBytes
        const outerLen = 3 + 2 + sBytes.length;
        const der = new Uint8Array([
            0x30, outerLen,
            0x02, 0x01, 0x05, // r = 5
            0x02, sBytes.length, ...sBytes,
        ]);
        const out = withSig(der);
        // s should be N - sHigh = 1
        expect(out.rs[1]).toBe(1n);
    });
});
