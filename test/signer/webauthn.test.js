// Unit tests for the fromWebAuthn adapter. All tests are offline and use
// synthetic assertion fixtures — the adapter's job is to route data
// through the correct encoding paths, not to produce cryptographically
// valid signatures.
//
// Equivalence strategy: each test compares signUserOperationWithSigners
// against the legacy manual-plumbing path (SafeAccount.createWebAuthnSignature
// + formatSignaturesToUseroperationSignature), asserting byte-for-byte
// equality.

const ak = require('../../dist/index.cjs');
const { AbiCoder } = require('ethers');

const CHAIN_ID = 11155111n;

// ─── Deterministic WebAuthn fixture ────────────────────────────────────

// A real-looking (x, y) pair on the P-256 curve. These specific values
// aren't on the curve — we don't verify signatures offline, we only check
// encoding layout — but they sit within the 256-bit range so every
// downstream encode() step treats them like valid coordinates.
const FIXTURE_PUBKEY = {
    x: 0x7a2fa39b3c61b3cbab8e44abeac8c9c7a4c1f76d42ae6f47b3b2a96d5c4f1a2bn,
    y: 0x2e8c5f6d4b7a9c1e3f5a8d7b6c4e2f1a9d8c7b6a5e4f3d2c1b0a9f8e7d6c5b4an,
};

// 37-byte authenticatorData: rpIdHash (32) | flags (1) | signCount (4).
const FIXTURE_AUTHENTICATOR_DATA_HEX =
    '49960de5880e8c687434170f6476605b8fe4aeb9a28632c7995cf3ba831d97630500000001';

// clientDataJSON containing additional fields in non-Chromium order, to
// exercise the regex-vs-JSON.parse regression. The adapter must handle
// `crossOrigin` and `extra` wherever they appear without breaking.
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
    // Manually serialize in the requested key order so we can verify the
    // adapter tolerates ordering differences.
    const parts = fieldOrder.map((k) => `"${k}":${JSON.stringify(fields[k])}`);
    return `{${parts.join(',')}}`;
}

function base64Url(bytes) {
    return Buffer.from(bytes).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function hexToBytes(hex) {
    const body = hex.startsWith('0x') ? hex.slice(2) : hex;
    const out = new Uint8Array(body.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(body.slice(i * 2, i * 2 + 2), 16);
    return out;
}

// Build a signFn that returns a deterministic assertion for any challenge.
// The r/s bigints are fixed; we don't verify them (Safe verification is
// on-chain), we just check encoding.
function makeStubSignFn(clientDataJSONBuilder) {
    return async (challengeBytes) => {
        const challengeB64 = base64Url(challengeBytes);
        const clientDataJSON = clientDataJSONBuilder(challengeB64);
        return {
            authenticatorData: hexToBytes(FIXTURE_AUTHENTICATOR_DATA_HEX),
            clientDataJSON, // string form — matches ox's output shape
            signature: {
                r: 0x3bc84a5d5196e81e867b935e6f7f3ec5bf8b0e5d3c2a1f9e8d7c6b5a4938271fn,
                s: 0x12a3b4c5d6e7f80192a3b4c5d6e7f80192a3b4c5d6e7f80192a3b4c5d6e7f801n,
            },
        };
    };
}

// ─── Fixtures ────────────────────────────────────────────────────────────

function buildSafeV3Op(safe, { withFactory = true } = {}) {
    return {
        sender: safe.accountAddress,
        nonce: 0n,
        factory: withFactory ? safe.factoryAddress : null,
        factoryData: withFactory ? safe.factoryData : null,
        callData: '0x',
        callGasLimit: 100000n,
        verificationGasLimit: 500000n,
        preVerificationGas: 60000n,
        maxFeePerGas: 10000000n,
        maxPriorityFeePerGas: 1000000n,
        paymaster: null,
        paymasterVerificationGasLimit: null,
        paymasterPostOpGasLimit: null,
        paymasterData: null,
        signature: '0x',
    };
}

// Reference manual plumbing: the 20-line block every Safe-passkeys
// consumer currently rewrites. Mirrors abstractionkit-examples/passkeys
// and safe-passkeys-react-example.
function manualSafeWebauthnSignature(userOp, chainId, pubkey, assertion, isInit) {
    const clientData = JSON.parse(assertion.clientDataJSON);
    const { type: _t, challenge: _c, ...rest } = clientData;
    const fields = Object.entries(rest)
        .map(([k, v]) => `"${k}":${JSON.stringify(v)}`)
        .join(',');
    const webauthnSigData = {
        authenticatorData: assertion.authenticatorData,
        clientDataFields: '0x' + Buffer.from(fields, 'utf8').toString('hex'),
        rs: [assertion.signature.r, assertion.signature.s],
    };
    const wSig = ak.SafeAccountV0_3_0.createWebAuthnSignature(webauthnSigData);
    const pair = { signer: pubkey, signature: wSig, isContractSignature: true };
    return ak.SafeAccountV0_3_0.formatSignaturesToUseroperationSignature([pair], { isInit });
}

// ─── Adapter shape ───────────────────────────────────────────────────────

describe('fromWebAuthn adapter shape', () => {
    test('returns a Signer with pubkey + signWebauthn, and NO address/signHash/signTypedData', () => {
        const signer = ak.fromWebAuthn({
            credentialId: base64Url(new Uint8Array([1, 2, 3, 4])),
            pubkey: FIXTURE_PUBKEY,
            signFn: makeStubSignFn((c) => buildClientDataJSON(c)),
        });
        expect(signer.pubkey).toEqual(FIXTURE_PUBKEY);
        expect(typeof signer.signWebauthn).toBe('function');
        expect(signer.address).toBeUndefined();
        expect(signer.signHash).toBeUndefined();
        expect(signer.signTypedData).toBeUndefined();
    });

    test('rejects missing credentialId', () => {
        expect(() =>
            ak.fromWebAuthn({ credentialId: '', pubkey: FIXTURE_PUBKEY }),
        ).toThrow(/credentialId.*required/);
    });

    test('accepts bigint, hex-string, and decimal-string pubkey coords', () => {
        // Bigint baseline
        const asBigint = ak.fromWebAuthn({
            credentialId: base64Url(new Uint8Array([1])),
            pubkey: FIXTURE_PUBKEY,
            signFn: makeStubSignFn((c) => buildClientDataJSON(c)),
        });
        expect(asBigint.pubkey).toEqual(FIXTURE_PUBKEY);

        // Hex strings (common after localStorage round-trip with a
        // bigint-to-hex replacer)
        const asHex = ak.fromWebAuthn({
            credentialId: base64Url(new Uint8Array([1])),
            pubkey: {
                x: '0x' + FIXTURE_PUBKEY.x.toString(16),
                y: '0x' + FIXTURE_PUBKEY.y.toString(16),
            },
            signFn: makeStubSignFn((c) => buildClientDataJSON(c)),
        });
        expect(asHex.pubkey).toEqual(FIXTURE_PUBKEY);

        // Decimal strings
        const asDecimal = ak.fromWebAuthn({
            credentialId: base64Url(new Uint8Array([1])),
            pubkey: {
                x: FIXTURE_PUBKEY.x.toString(10),
                y: FIXTURE_PUBKEY.y.toString(10),
            },
            signFn: makeStubSignFn((c) => buildClientDataJSON(c)),
        });
        expect(asDecimal.pubkey).toEqual(FIXTURE_PUBKEY);
    });

    test('rejects pubkey with missing or invalid coords', () => {
        expect(() =>
            ak.fromWebAuthn({ credentialId: 'abc', pubkey: { x: undefined, y: 1n } }),
        ).toThrow(/pubkey.*x, y.*both/);
        expect(() =>
            ak.fromWebAuthn({
                credentialId: 'abc',
                pubkey: { x: 'not-a-bigint', y: 1n },
            }),
        ).toThrow(/not a valid bigint/);
        expect(() =>
            ak.fromWebAuthn({
                credentialId: 'abc',
                pubkey: { x: true, y: 1n },
            }),
        ).toThrow(/bigint, string, or number/);
    });
});

describe('pubkeyCoordinatesToJson / pubkeyCoordinatesFromJson', () => {
    test('round-trips a WebAuthn pubkey bit-for-bit', () => {
        const json = ak.pubkeyCoordinatesToJson(FIXTURE_PUBKEY);
        const parsed = ak.pubkeyCoordinatesFromJson(json);
        expect(parsed).toEqual(FIXTURE_PUBKEY);
    });

    test('serializes to hex-string form (backward-compat with existing localStorage replacers)', () => {
        const json = ak.pubkeyCoordinatesToJson(FIXTURE_PUBKEY);
        const obj = JSON.parse(json);
        expect(obj.x.startsWith('0x')).toBe(true);
        expect(obj.y.startsWith('0x')).toBe(true);
        expect(BigInt(obj.x)).toBe(FIXTURE_PUBKEY.x);
        expect(BigInt(obj.y)).toBe(FIXTURE_PUBKEY.y);
    });

    test('fromJson accepts pre-parsed object too (skip JSON.parse)', () => {
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

    test('fromJson throws on malformed input', () => {
        expect(() => ak.pubkeyCoordinatesFromJson('{"x":"not-hex","y":"0x1"}')).toThrow(
            /not a valid bigint/,
        );
        expect(() => ak.pubkeyCoordinatesFromJson('{"x":"0x1"}')).toThrow(/x, y.*both/);
    });
});

describe('toBigintPubkey direct usage', () => {
    test('is idempotent on bigint input', () => {
        expect(ak.toBigintPubkey(FIXTURE_PUBKEY)).toEqual(FIXTURE_PUBKEY);
    });

    test('coerces number input for small coords', () => {
        const coerced = ak.toBigintPubkey({ x: 42, y: 7 });
        expect(coerced.x).toBe(42n);
        expect(coerced.y).toBe(7n);
    });

    test('rejects unsafe-integer numbers to prevent precision loss', () => {
        expect(() =>
            ak.toBigintPubkey({ x: Number.MAX_SAFE_INTEGER + 1, y: 1n }),
        ).toThrow(/safe integer/);
    });
});

// ─── webauthnSignatureFromAssertion helper ──────────────────────────────

describe('webauthnSignatureFromAssertion', () => {
    test('accepts both ArrayBuffer and Uint8Array for authenticatorData', () => {
        const u8 = hexToBytes(FIXTURE_AUTHENTICATOR_DATA_HEX);
        const ab = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
        const fromU8 = ak.webauthnSignatureFromAssertion({
            authenticatorData: u8,
            clientDataJSON: '{"type":"webauthn.get","challenge":"AA"}',
            signature: { r: 1n, s: 2n },
        });
        const fromAB = ak.webauthnSignatureFromAssertion({
            authenticatorData: ab,
            clientDataJSON: '{"type":"webauthn.get","challenge":"AA"}',
            signature: { r: 1n, s: 2n },
        });
        expect(Buffer.from(fromU8.authenticatorData).toString('hex')).toBe(
            Buffer.from(fromAB.authenticatorData).toString('hex'),
        );
    });

    test('accepts both string and buffer clientDataJSON', () => {
        const str = '{"type":"webauthn.get","challenge":"AA"}';
        const buf = Buffer.from(str, 'utf8');
        const fromStr = ak.webauthnSignatureFromAssertion({
            authenticatorData: new Uint8Array([1, 2]),
            clientDataJSON: str,
            signature: { r: 1n, s: 2n },
        });
        const fromBuf = ak.webauthnSignatureFromAssertion({
            authenticatorData: new Uint8Array([1, 2]),
            clientDataJSON: buf,
            signature: { r: 1n, s: 2n },
        });
        expect(fromStr.clientDataJSON).toBe(fromBuf.clientDataJSON);
    });
});

// ─── Safe equivalence ───────────────────────────────────────────────────

describe('SafeAccountV0_3_0 signUserOperationWithSigners + fromWebAuthn', () => {
    test('matches legacy manual plumbing byte-for-byte (isInit=true)', async () => {
        const safe = ak.SafeAccountV0_3_0.initializeNewAccount([FIXTURE_PUBKEY]);
        const op = buildSafeV3Op(safe, { withFactory: true });
        const stub = makeStubSignFn((c) => buildClientDataJSON(c));
        const signer = ak.fromWebAuthn({
            credentialId: base64Url(new Uint8Array([9, 9, 9])),
            pubkey: FIXTURE_PUBKEY,
            signFn: stub,
        });
        const actual = await safe.signUserOperationWithSigners(op, [signer], CHAIN_ID);

        // Compute the assertion the adapter will produce for the same
        // challenge, then run the manual plumbing.
        const hash = ak.SafeAccountV0_3_0.getUserOperationEip712Hash(op, CHAIN_ID);
        const assertion = ak.webauthnSignatureFromAssertion(await stub(hexToBytes(hash)));
        const expected = manualSafeWebauthnSignature(op, CHAIN_ID, FIXTURE_PUBKEY, assertion, true);
        expect(actual).toBe(expected);
    });

    test('matches legacy manual plumbing byte-for-byte (isInit=false, already-deployed)', async () => {
        const safe = ak.SafeAccountV0_3_0.initializeNewAccount([FIXTURE_PUBKEY]);
        const op = buildSafeV3Op(safe, { withFactory: false });
        op.nonce = 5n;
        const stub = makeStubSignFn((c) => buildClientDataJSON(c));
        const signer = ak.fromWebAuthn({
            credentialId: base64Url(new Uint8Array([9])),
            pubkey: FIXTURE_PUBKEY,
            signFn: stub,
        });
        const actual = await safe.signUserOperationWithSigners(op, [signer], CHAIN_ID);

        const hash = ak.SafeAccountV0_3_0.getUserOperationEip712Hash(op, CHAIN_ID);
        const assertion = ak.webauthnSignatureFromAssertion(await stub(hexToBytes(hash)));
        const expected = manualSafeWebauthnSignature(op, CHAIN_ID, FIXTURE_PUBKEY, assertion, false);
        expect(actual).toBe(expected);
    });

    test('clientDataJSON field reorder regression (Safari puts crossOrigin first)', async () => {
        const safe = ak.SafeAccountV0_3_0.initializeNewAccount([FIXTURE_PUBKEY]);
        const op = buildSafeV3Op(safe, { withFactory: true });
        // Safari-style ordering: `crossOrigin` between `type` and `challenge`.
        const stub = makeStubSignFn((c) =>
            buildClientDataJSON(c, {
                fieldOrder: ['type', 'crossOrigin', 'origin', 'challenge'],
            }),
        );
        const signer = ak.fromWebAuthn({
            credentialId: base64Url(new Uint8Array([5])),
            pubkey: FIXTURE_PUBKEY,
            signFn: stub,
        });
        const actual = await safe.signUserOperationWithSigners(op, [signer], CHAIN_ID);
        const hash = ak.SafeAccountV0_3_0.getUserOperationEip712Hash(op, CHAIN_ID);
        const assertion = ak.webauthnSignatureFromAssertion(await stub(hexToBytes(hash)));
        const expected = manualSafeWebauthnSignature(op, CHAIN_ID, FIXTURE_PUBKEY, assertion, true);
        expect(actual).toBe(expected);
    });

    test('future authenticator field is preserved (forward compat)', async () => {
        const safe = ak.SafeAccountV0_3_0.initializeNewAccount([FIXTURE_PUBKEY]);
        const op = buildSafeV3Op(safe, { withFactory: true });
        const stub = makeStubSignFn((c) =>
            buildClientDataJSON(c, {
                fieldOrder: ['type', 'challenge', 'origin', 'crossOrigin', 'futureWebauthnL3Field'],
                extras: {
                    origin: 'https://safe.global',
                    crossOrigin: false,
                    futureWebauthnL3Field: 'some-value',
                },
            }),
        );
        const signer = ak.fromWebAuthn({
            credentialId: base64Url(new Uint8Array([6])),
            pubkey: FIXTURE_PUBKEY,
            signFn: stub,
        });
        const actual = await safe.signUserOperationWithSigners(op, [signer], CHAIN_ID);
        const hash = ak.SafeAccountV0_3_0.getUserOperationEip712Hash(op, CHAIN_ID);
        const assertion = ak.webauthnSignatureFromAssertion(await stub(hexToBytes(hash)));
        const expected = manualSafeWebauthnSignature(op, CHAIN_ID, FIXTURE_PUBKEY, assertion, true);
        expect(actual).toBe(expected);
    });
});

// ─── Simple7702 rejection (offline capability mismatch) ─────────────────

describe('Simple7702Account rejects fromWebAuthn offline', () => {
    test('signUserOperationWithSigner throws with actionable scheme-mismatch message', async () => {
        const Simple7702 = ak.Simple7702AccountV08 || ak.Simple7702AccountV0_8 || ak.Simple7702AccountV09;
        if (!Simple7702) {
            // Older builds: skip silently, the capability-mismatch behavior
            // is exercised via the signer.test.js rejection test.
            return;
        }
        const eoa = '0xfD90FAd33ee8b58f32c00aceEad1358e4AFC23f9';
        const simple = new Simple7702(eoa);
        const op = {
            sender: eoa, nonce: 0n, callData: '0x',
            callGasLimit: 100000n, verificationGasLimit: 500000n,
            preVerificationGas: 60000n, maxFeePerGas: 10000000n,
            maxPriorityFeePerGas: 1000000n, signature: '0x',
            factory: null, factoryData: null,
            paymaster: null, paymasterVerificationGasLimit: null,
            paymasterPostOpGasLimit: null, paymasterData: null,
            eip7702Auth: null,
        };
        const signer = ak.fromWebAuthn({
            credentialId: base64Url(new Uint8Array([1])),
            pubkey: FIXTURE_PUBKEY,
            signFn: makeStubSignFn((c) => buildClientDataJSON(c)),
        });
        await expect(
            simple.signUserOperationWithSigner(op, signer, CHAIN_ID),
        ).rejects.toThrow(/accepts:\s*\[hash\].*signer provides:\s*\[webauthn\]/s);
    });
});

// ─── Regression: sortSignatures honors isInit for WebAuthn signers ─────
// At isInit=true, a WebAuthn signer's on-chain signer field is the shared
// signer address (0xfD90…), not its deterministic verifier. sortSignatures
// must use the shared-signer address as its sort key, otherwise a mixed
// WebAuthn + ECDSA packed signature can land out-of-order and Safe's
// checkNSignatures reverts with GS026. Pre-fix, this triggered for roughly
// half of random (passkey, EOA) pairs.
describe('sortSignatures honors isInit for WebAuthn signers (GS026 regression)', () => {
    // Specific (passkey, EOA) pair that demonstrated the bug: the passkey's
    // deterministic verifier sorts BELOW the EOA, but the shared signer
    // sorts ABOVE the EOA, so the sort key and the on-chain-packed address
    // disagreed and produced a descending packed order at isInit=true.
    const BUG_PASSKEY = {
        x: 0x31498e606f771994a4d9b902dd812fbc0acc1cf4e34d688928293e1edc3fcc0en,
        y: 0xf7946c434b3f968370d88e8cce861a1958aeeb21d04aee6a16b940e28a8dd7c6n,
    };
    const BUG_EOA = '0xC12598e6EF806335ca800A508C343A84e49Ceb4D';

    // Read each 65-byte entry's v byte + signer-word from a packed Safe
    // signature. ECDSA entries encode (r,s,v); only v is meaningful here
    // (the signer is recovered on-chain). Contract-sig entries encode
    // (signer,offset,v=0) with the signer in the first 32-byte word.
    function readEntries(packed, n) {
        const body = packed.slice(2);
        const entries = [];
        for (let i = 0; i < n; i++) {
            const entry = body.slice(i * 130, (i + 1) * 130);
            const v = parseInt(entry.slice(128, 130), 16);
            if (v === 0) {
                entries.push({
                    kind: 'contract',
                    signer: '0x' + entry.slice(24, 64).toLowerCase(),
                });
            } else {
                entries.push({ kind: 'ecdsa', v });
            }
        }
        return entries;
    }

    test('at isInit=true: contract-sig entry uses shared signer AND EOA sorts before it', () => {
        // The bug would produce [contract(SHARED), ECDSA] here because
        // the sort key (pre-fix) was the deterministic verifier
        // (0xbdab… < EOA) while the packed signer for the contract-sig
        // entry is SHARED (0xfd90… > EOA). Post-fix, the sort key is
        // SHARED for WebAuthn at isInit=true, so EOA (0xc125…) sorts
        // first, then the shared-signer contract entry.
        const webauthnBlob = ak.SafeAccountV0_3_0.createWebAuthnSignature({
            authenticatorData: new Uint8Array(37),
            clientDataFields: '0x7b7d',
            rs: [1n, 2n],
        });
        const pairs = [
            { signer: BUG_PASSKEY, signature: webauthnBlob, isContractSignature: true },
            { signer: BUG_EOA, signature: '0x' + '11'.repeat(32) + '22'.repeat(32) + '1c' },
        ];
        const packed = ak.SafeAccountV0_3_0.buildSignaturesFromSingerSignaturePairs(pairs, {
            isInit: true,
        });
        const [entry0, entry1] = readEntries(packed, 2);

        const SHARED = ak.SafeAccountV0_3_0.DEFAULT_WEB_AUTHN_SHARED_SIGNER.toLowerCase();
        // EOA (0xc125…) < SHARED (0xfd90…), so ECDSA entry comes first,
        // contract-sig entry with the shared signer comes second.
        expect(entry0.kind).toBe('ecdsa');
        expect(entry1.kind).toBe('contract');
        expect(entry1.signer).toBe(SHARED);
        // The EOA address is below the shared signer → invariant holds:
        expect(BUG_EOA.toLowerCase() < SHARED).toBe(true);
    });

    test('at isInit=false: contract-sig entry uses deterministic verifier, passkey sorts first', () => {
        const webauthnBlob = ak.SafeAccountV0_3_0.createWebAuthnSignature({
            authenticatorData: new Uint8Array(37),
            clientDataFields: '0x7b7d',
            rs: [1n, 2n],
        });
        const pairs = [
            { signer: BUG_PASSKEY, signature: webauthnBlob, isContractSignature: true },
            { signer: BUG_EOA, signature: '0x' + '11'.repeat(32) + '22'.repeat(32) + '1c' },
        ];
        const packed = ak.SafeAccountV0_3_0.buildSignaturesFromSingerSignaturePairs(pairs, {
            isInit: false,
        });
        const [entry0, entry1] = readEntries(packed, 2);

        const DETERMINISTIC = ak.SafeAccountV0_3_0.createWebAuthnSignerVerifierAddress(
            BUG_PASSKEY.x,
            BUG_PASSKEY.y,
        ).toLowerCase();
        // For this specific pair, deterministic (0xbdab…) < EOA (0xc125…),
        // so the passkey contract-sig entry sorts first.
        expect(entry0.kind).toBe('contract');
        expect(entry0.signer).toBe(DETERMINISTIC);
        expect(entry1.kind).toBe('ecdsa');
        expect(DETERMINISTIC < BUG_EOA.toLowerCase()).toBe(true);
    });

    test('getSignerLowerCaseAddress returns shared signer for WebAuthn at isInit=true', () => {
        const SHARED = ak.SafeAccountV0_3_0.DEFAULT_WEB_AUTHN_SHARED_SIGNER.toLowerCase();
        expect(
            ak.SafeAccountV0_3_0.getSignerLowerCaseAddress(BUG_PASSKEY, { isInit: true }),
        ).toBe(SHARED);
    });

    test('getSignerLowerCaseAddress returns deterministic verifier for WebAuthn at isInit=false', () => {
        const DETERMINISTIC = ak.SafeAccountV0_3_0.createWebAuthnSignerVerifierAddress(
            BUG_PASSKEY.x,
            BUG_PASSKEY.y,
        ).toLowerCase();
        expect(
            ak.SafeAccountV0_3_0.getSignerLowerCaseAddress(BUG_PASSKEY, { isInit: false }),
        ).toBe(DETERMINISTIC);
        // Default (undefined isInit) also returns deterministic — preserves
        // backward compatibility for any external caller that wasn't
        // passing isInit before the fix.
        expect(ak.SafeAccountV0_3_0.getSignerLowerCaseAddress(BUG_PASSKEY, {})).toBe(
            DETERMINISTIC,
        );
    });
});

// ─── Calibur webauthn encoding equivalence ──────────────────────────────

describe('Calibur7702Account signUserOperationWithSigner + fromWebAuthn', () => {
    test('produces a valid Calibur-shaped WebAuthn signature wrapper', async () => {
        const eoa = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
        const calibur = new ak.Calibur7702Account(eoa);
        const op = {
            sender: eoa, nonce: 0n, callData: '0x',
            callGasLimit: 100000n, verificationGasLimit: 500000n,
            preVerificationGas: 60000n, maxFeePerGas: 10000000n,
            maxPriorityFeePerGas: 1000000n, signature: '0x',
            factory: null, factoryData: null,
            paymaster: null, paymasterVerificationGasLimit: null,
            paymasterPostOpGasLimit: null, paymasterData: null,
            eip7702Auth: null,
        };
        const stub = makeStubSignFn((c) => buildClientDataJSON(c));
        const signer = ak.fromWebAuthn({
            credentialId: base64Url(new Uint8Array([7, 7])),
            pubkey: FIXTURE_PUBKEY,
            signFn: stub,
        });
        const actual = await calibur.signUserOperationWithSigner(op, signer, CHAIN_ID);

        // Decode the outer (bytes32, bytes, bytes) wrapper and check shape.
        const abi = AbiCoder.defaultAbiCoder();
        const [keyHash, innerEncoded, hookData] = abi.decode(
            ['bytes32', 'bytes', 'bytes'],
            actual,
        );
        expect(hookData).toBe('0x');
        const expectedKeyHash = ak.Calibur7702Account.getKeyHash(
            ak.Calibur7702Account.createWebAuthnP256Key(FIXTURE_PUBKEY.x, FIXTURE_PUBKEY.y),
        );
        expect(keyHash.toLowerCase()).toBe(expectedKeyHash.toLowerCase());

        // Inner struct: (bytes, string, uint256, uint256, uint256, uint256)
        const [inner] = abi.decode(
            ['(bytes,string,uint256,uint256,uint256,uint256)'],
            innerEncoded,
        );
        const [authData, cdjson, challengeIdx, typeIdx, r, s] = inner;
        expect(authData.toLowerCase()).toBe('0x' + FIXTURE_AUTHENTICATOR_DATA_HEX);
        expect(cdjson).toMatch(/"type":"webauthn.get"/);
        expect(Number(typeIdx)).toBe(cdjson.indexOf('"type":"webauthn.get"'));
        expect(Number(challengeIdx)).toBe(cdjson.indexOf('"challenge":"'));
        expect(r).toBe(0x3bc84a5d5196e81e867b935e6f7f3ec5bf8b0e5d3c2a1f9e8d7c6b5a4938271fn);
        expect(s).toBe(0x12a3b4c5d6e7f80192a3b4c5d6e7f80192a3b4c5d6e7f80192a3b4c5d6e7f801n);
    });
});
