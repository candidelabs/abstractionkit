/**
 * ethereUtils — copying related code from ethers v6 with some modification,
 * covering exactly the surface area used by `abstractionkit`.
 *
 * Sources (ethers v6.13.x):
 *   src.ts/utils/{data,maths,utf8,rlp-encode}.ts
 *   src.ts/crypto/{keccak,signing-key,signature}.ts
 *   src.ts/hash/{id,message,solidity,typed-data}.ts
 *   src.ts/address/{address,checks}.ts
 *   src.ts/abi/{abi-coder, coders/*}.ts
 *   src.ts/transaction/address.ts
 */

import { keccak_256 } from "@noble/hashes/sha3";
import { secp256k1 } from "@noble/curves/secp256k1";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type Hex = `0x${string}`;
export type BytesLike = string | Uint8Array;
export type Numeric = number | bigint;
export type BigNumberish = string | Numeric;
export type RlpStructuredDataish = BytesLike | ReadonlyArray<RlpStructuredDataish>;

export interface TypedDataDomain {
    name?: null | string;
    version?: null | string;
    chainId?: null | BigNumberish;
    verifyingContract?: null | string;
    salt?: null | BytesLike;
}

export interface TypedDataField {
    name: string;
    type: string;
}

export interface Signature {
    r: Hex;
    s: Hex;
    v: 27 | 28;
    yParity: 0 | 1;
    /** 65-byte hex: `r (32) || s (32) || v (1)`. */
    serialized: Hex;
}

// ─────────────────────────────────────────────────────────────────────────────
// Errors (simplified)
//   ethers ships a rich error system; we keep the assertion shape and message
//   formatting but drop the typed-error machinery (CALL_EXCEPTION,
//   BUFFER_OVERRUN, NUMERIC_FAULT, …) since none of abstractionkit's call
//   sites discriminate on them.
// ─────────────────────────────────────────────────────────────────────────────

// Format an argument value for inclusion in an error message without leaking
// secrets. Private keys, digests, and calldata flow through `getBytes` and
// can land here on malformed input, so:
//   1. If the parameter name hints at a secret, fully redact.
//   2. Hex strings get a prefix/suffix preview (callers can recognize the
//      value in logs without copying the whole thing into a bug report).
//   3. Any string long enough to be a key but missed by (1) and (2) is
//      redacted by length, as defense-in-depth.
//   4. Uint8Array is never echoed (a raw private key can flow this way too).
function redactArgumentValue(name: string, value: unknown): string {
    if (value === null || value === undefined) return String(value);
    if (typeof value === "string") {
        const n = name.toLowerCase();
        if (
            n.includes("key") ||
            n.includes("secret") ||
            n.includes("token") ||
            n.includes("password") ||
            n.includes("mnemonic")
        ) {
            return "[REDACTED]";
        }
        if (/^0x[0-9a-f]+$/i.test(value) && value.length > 18) {
            return `${value.slice(0, 10)}…${value.slice(-6)}`;
        }
        if (value.length > 64) return `[REDACTED string length=${value.length}]`;
        return value;
    }
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
        return String(value);
    }
    if (value instanceof Uint8Array) return `[REDACTED Uint8Array length=${value.length}]`;
    return `[REDACTED ${typeof value}]`;
}

function assertArgument(check: unknown, message: string, name: string, value: unknown): asserts check {
    if (!check) throw new Error(`invalid argument (${name}=${redactArgumentValue(name, value)}, message=${message})`);
}
function assertCheck(check: unknown, message: string): asserts check {
    if (!check) throw new Error(message);
}

// ─────────────────────────────────────────────────────────────────────────────
// Data helpers (src.ts/utils/data.ts)
// ─────────────────────────────────────────────────────────────────────────────

const HexCharacters = "0123456789abcdef";

function _getBytes(value: BytesLike, name?: string, copy?: boolean): Uint8Array {
    if (value instanceof Uint8Array) {
        return copy ? new Uint8Array(value) : value;
    }
    if (typeof value === "string" && value.length % 2 === 0 && value.match(/^0x[0-9a-f]*$/i)) {
        const result = new Uint8Array((value.length - 2) / 2);
        let offset = 2;
        for (let i = 0; i < result.length; i++) {
            result[i] = parseInt(value.substring(offset, offset + 2), 16);
            offset += 2;
        }
        return result;
    }
    assertArgument(false, "invalid BytesLike value", name || "value", value);
}

export function getBytes(value: BytesLike, name?: string): Uint8Array {
    return _getBytes(value, name, false);
}

function getBytesCopy(value: BytesLike, name?: string): Uint8Array {
    return _getBytes(value, name, true);
}

export function isHexString(value: unknown, length?: number | boolean): value is `0x${string}` {
    if (typeof value !== "string" || !value.match(/^0x[0-9A-Fa-f]*$/)) return false;
    if (typeof length === "number" && value.length !== 2 + 2 * length) return false;
    if (length === true && value.length % 2 !== 0) return false;
    return true;
}

export function hexlify(data: BytesLike): Hex {
    const bytes = getBytes(data);
    let result = "0x";
    for (let i = 0; i < bytes.length; i++) {
        const v = bytes[i];
        result += HexCharacters[(v & 0xf0) >> 4] + HexCharacters[v & 0x0f];
    }
    return result as Hex;
}

export function concat(datas: ReadonlyArray<BytesLike>): Hex {
    return ("0x" + datas.map((d) => hexlify(d).substring(2)).join("")) as Hex;
}

export function dataLength(data: BytesLike): number {
    if (isHexString(data, true)) return (data.length - 2) / 2;
    return getBytes(data).length;
}

function zeroPad(data: BytesLike, length: number, left: boolean): Hex {
    const bytes = getBytes(data);
    assertCheck(length >= bytes.length, "padding exceeds data length");
    const result = new Uint8Array(length);
    result.fill(0);
    if (left) result.set(bytes, length - bytes.length);
    else result.set(bytes, 0);
    return hexlify(result);
}

function zeroPadValue(data: BytesLike, length: number): Hex {
    return zeroPad(data, length, true);
}

function zeroPadBytes(data: BytesLike, length: number): Hex {
    return zeroPad(data, length, false);
}

// ─────────────────────────────────────────────────────────────────────────────
// Math helpers (src.ts/utils/maths.ts)
// ─────────────────────────────────────────────────────────────────────────────

const BN_0 = 0n;
const BN_1 = 1n;
const maxValue = 0x1fffffffffffff; // 2^53 - 1 (IEEE 754 mantissa)

function getBigInt(value: BigNumberish, name?: string): bigint {
    switch (typeof value) {
        case "bigint": return value;
        case "number":
            assertArgument(Number.isInteger(value), "underflow", name || "value", value);
            assertArgument(value >= -maxValue && value <= maxValue, "overflow", name || "value", value);
            return BigInt(value);
        case "string":
            try {
                if (value === "") throw new Error("empty string");
                if (value[0] === "-" && value[1] !== "-") return -BigInt(value.substring(1));
                return BigInt(value);
            } catch (e) {
                assertArgument(false, `invalid BigNumberish string: ${(e as Error).message}`, name || "value", value);
            }
    }
    assertArgument(false, "invalid BigNumberish value", name || "value", value);
}

function getUint(value: BigNumberish, name?: string): bigint {
    const result = getBigInt(value, name);
    assertCheck(result >= BN_0, "unsigned value cannot be negative");
    return result;
}

function getNumber(value: BigNumberish, name?: string): number {
    switch (typeof value) {
        case "bigint":
            assertArgument(value >= -maxValue && value <= maxValue, "overflow", name || "value", value);
            return Number(value);
        case "number":
            assertArgument(Number.isInteger(value), "underflow", name || "value", value);
            assertArgument(value >= -maxValue && value <= maxValue, "overflow", name || "value", value);
            return value;
        case "string":
            try {
                if (value === "") throw new Error("empty string");
                return getNumber(BigInt(value), name);
            } catch (e) {
                assertArgument(false, `invalid numeric string: ${(e as Error).message}`, name || "value", value);
            }
    }
    assertArgument(false, "invalid numeric value", name || "value", value);
}

const Nibbles = "0123456789abcdef";

function toBigInt(value: BigNumberish | Uint8Array): bigint {
    if (value instanceof Uint8Array) {
        let result = "0x0";
        for (const v of value) {
            result += Nibbles[v >> 4];
            result += Nibbles[v & 0x0f];
        }
        return BigInt(result);
    }
    return getBigInt(value);
}

function toNumber(value: BigNumberish | Uint8Array): number {
    return getNumber(toBigInt(value));
}

function mask(_value: BigNumberish, _bits: Numeric): bigint {
    const value = getUint(_value, "value");
    const bits = BigInt(getNumber(_bits, "bits"));
    return value & ((BN_1 << bits) - BN_1);
}

function toTwos(_value: BigNumberish, _width: Numeric): bigint {
    let value = getBigInt(_value, "value");
    const width = BigInt(getNumber(_width, "width"));
    const limit = BN_1 << (width - BN_1);
    if (value < BN_0) {
        value = -value;
        assertCheck(value <= limit, "toTwos: too low");
        const m = (BN_1 << width) - BN_1;
        return ((~value) & m) + BN_1;
    }
    assertCheck(value < limit, "toTwos: too high");
    return value;
}

function fromTwos(_value: BigNumberish, _width: Numeric): bigint {
    const value = getUint(_value, "value");
    const width = BigInt(getNumber(_width, "width"));
    assertCheck((value >> width) === BN_0, "fromTwos: overflow");
    if (value >> (width - BN_1)) {
        const m = (BN_1 << width) - BN_1;
        return -(((~value) & m) + BN_1);
    }
    return value;
}

function toBeHex(_value: BigNumberish, _width?: Numeric): Hex {
    const value = getUint(_value, "value");
    let result = value.toString(16);
    if (_width == null) {
        if (result.length % 2) result = "0" + result;
    } else {
        const width = getNumber(_width, "width");
        if (width === 0 && value === BN_0) return "0x" as Hex;
        assertCheck(width * 2 >= result.length, `value exceeds width (${width} bytes)`);
        while (result.length < width * 2) result = "0" + result;
    }
    return ("0x" + result) as Hex;
}

export function toBeArray(_value: BigNumberish, _width?: Numeric): Uint8Array {
    const value = getUint(_value, "value");
    if (value === BN_0) {
        const width = _width != null ? getNumber(_width, "width") : 0;
        return new Uint8Array(width);
    }
    let hex = value.toString(16);
    if (hex.length % 2) hex = "0" + hex;
    if (_width != null) {
        const width = getNumber(_width, "width");
        while (hex.length < width * 2) hex = "00" + hex;
        assertCheck(width * 2 === hex.length, `value exceeds width (${width} bytes)`);
    }
    const result = new Uint8Array(hex.length / 2);
    for (let i = 0; i < result.length; i++) {
        const offset = i * 2;
        result[i] = parseInt(hex.substring(offset, offset + 2), 16);
    }
    return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// UTF-8 (src.ts/utils/utf8.ts — encoding + decoding)
// ─────────────────────────────────────────────────────────────────────────────

export function toUtf8Bytes(str: string): Uint8Array {
    assertArgument(typeof str === "string", "invalid string value", "str", str);
    const result: number[] = [];
    for (let i = 0; i < str.length; i++) {
        const c = str.charCodeAt(i);
        if (c < 0x80) {
            result.push(c);
        } else if (c < 0x800) {
            result.push((c >> 6) | 0xc0);
            result.push((c & 0x3f) | 0x80);
        } else if ((c & 0xfc00) === 0xd800) {
            i++;
            const c2 = str.charCodeAt(i);
            assertArgument(i < str.length && (c2 & 0xfc00) === 0xdc00, "invalid surrogate pair", "str", str);
            const pair = 0x10000 + ((c & 0x03ff) << 10) + (c2 & 0x03ff);
            result.push((pair >> 18) | 0xf0);
            result.push(((pair >> 12) & 0x3f) | 0x80);
            result.push(((pair >> 6) & 0x3f) | 0x80);
            result.push((pair & 0x3f) | 0x80);
        } else {
            result.push((c >> 12) | 0xe0);
            result.push(((c >> 6) & 0x3f) | 0x80);
            result.push((c & 0x3f) | 0x80);
        }
    }
    return new Uint8Array(result);
}

/**
 * Decode UTF-8 bytes to a string. Pure JS so it works in every runtime,
 * including React Native / Hermes where `TextDecoder` is not defined by default.
 *
 * Throws on bad prefix, truncated sequences, missing or unexpected continuation bytes,
 * overlong encodings, surrogate code points (U+D800..U+DFFF), and code
 * points above U+10FFFF. For ABI string payloads this is the right policy —
 * well-formed contracts never emit broken UTF-8, so an error signals a
 * real problem rather than silently corrupting the decoded value.
 *
 * @throws Error when `bytes` is not a valid UTF-8 sequence.
 */
export function fromUtf8Bytes(bytes: Uint8Array): string {
    const codepoints: number[] = [];
    let i = 0;
    while (i < bytes.length) {
        const c = bytes[i++];

        // 1-byte ASCII.
        if ((c & 0x80) === 0) {
            codepoints.push(c);
            continue;
        }

        // Lead-byte classification per RFC 3629. Bytes 0xf8..0xff are not
        // valid UTF-8 lead bytes and fall through to the error branch.
        let extraLength: number;
        let overlongMask: number;
        if ((c & 0xe0) === 0xc0) {
            extraLength = 1;
            overlongMask = 0x7f;
        } else if ((c & 0xf0) === 0xe0) {
            extraLength = 2;
            overlongMask = 0x7ff;
        } else if ((c & 0xf8) === 0xf0) {
            extraLength = 3;
            overlongMask = 0xffff;
        } else {
            const kind = (c & 0xc0) === 0x80 ? "unexpected continuation" : "bad prefix";
            throw new Error(`invalid UTF-8: ${kind} byte 0x${c.toString(16)} at index ${i - 1}`);
        }

        if (i + extraLength > bytes.length) {
            throw new Error(`invalid UTF-8: truncated sequence at index ${i - 1}`);
        }

        let res = c & ((1 << (8 - extraLength - 1)) - 1);
        for (let j = 0; j < extraLength; j++) {
            const next = bytes[i++];
            if ((next & 0xc0) !== 0x80) {
                throw new Error(
                    `invalid UTF-8: missing continuation byte 0x${next.toString(16)} at index ${i - 1}`,
                );
            }
            res = (res << 6) | (next & 0x3f);
        }

        if (res <= overlongMask) {
            throw new Error(`invalid UTF-8: overlong encoding of U+${res.toString(16).toUpperCase()}`);
        }
        if (res >= 0xd800 && res <= 0xdfff) {
            throw new Error(`invalid UTF-8: surrogate code point U+${res.toString(16).toUpperCase()}`);
        }
        if (res > 0x10ffff) {
            throw new Error(`invalid UTF-8: code point U+${res.toString(16).toUpperCase()} out of range`);
        }

        codepoints.push(res);
    }

    let result = "";
    for (const cp of codepoints) result += String.fromCodePoint(cp);
    return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Crypto: keccak256 (src.ts/crypto/keccak.ts)
// ─────────────────────────────────────────────────────────────────────────────

export function keccak256(_data: BytesLike): Hex {
    const data = getBytes(_data, "data");
    return hexlify(keccak_256(data));
}

// ─────────────────────────────────────────────────────────────────────────────
// Hash: id, hashMessage (src.ts/hash/{id,message}.ts)
// ─────────────────────────────────────────────────────────────────────────────

export function id(value: string): Hex {
    return keccak256(toUtf8Bytes(value));
}

const MessagePrefix = "\x19Ethereum Signed Message:\n";

export function hashMessage(message: Uint8Array | string): Hex {
    if (typeof message === "string") message = toUtf8Bytes(message);
    return keccak256(concat([
        toUtf8Bytes(MessagePrefix),
        toUtf8Bytes(String(message.length)),
        message,
    ]));
}

// ─────────────────────────────────────────────────────────────────────────────
// Address: getAddress, isAddress (src.ts/address/{address,checks}.ts)
//   ICAP/Base36 dropped — abstractionkit never passes ICAP addresses.
// ─────────────────────────────────────────────────────────────────────────────

function getChecksumAddress(address: string): Hex {
    address = address.toLowerCase();
    const chars = address.substring(2).split("");
    const expanded = new Uint8Array(40);
    for (let i = 0; i < 40; i++) expanded[i] = chars[i].charCodeAt(0);
    const hashed = getBytes(keccak256(expanded));
    for (let i = 0; i < 40; i += 2) {
        if ((hashed[i >> 1] >> 4) >= 8) chars[i] = chars[i].toUpperCase();
        if ((hashed[i >> 1] & 0x0f) >= 8) chars[i + 1] = chars[i + 1].toUpperCase();
    }
    return ("0x" + chars.join("")) as Hex;
}

export function getAddress(address: string): Hex {
    assertArgument(typeof address === "string", "invalid address", "address", address);
    if (address.match(/^(0x)?[0-9a-fA-F]{40}$/)) {
        if (!address.startsWith("0x")) address = "0x" + address;
        const result = getChecksumAddress(address);
        assertArgument(
            !address.match(/([A-F].*[a-f])|([a-f].*[A-F])/) || result === address,
            "bad address checksum", "address", address,
        );
        return result;
    }
    assertArgument(false, "invalid address", "address", address);
}

export function isAddress(value: unknown): value is string {
    try {
        getAddress(value as string);
        return true;
    } catch {
        return false;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Solidity packed (src.ts/hash/solidity.ts)
// ─────────────────────────────────────────────────────────────────────────────

const regexBytes = /^bytes([0-9]+)$/;
const regexNumber = /^(u?int)([0-9]*)$/;
const regexArray = /^(.*)\[([0-9]*)\]$/;

function _pack(type: string, value: unknown, isArray?: boolean): Uint8Array {
    switch (type) {
        case "address":
            if (isArray) return getBytes(zeroPadValue(value as string, 32));
            return getBytes(getAddress(value as string));
        case "string":
            return toUtf8Bytes(value as string);
        case "bytes":
            return getBytes(value as BytesLike);
        case "bool": {
            const v: Hex = value ? "0x01" : "0x00";
            if (isArray) return getBytes(zeroPadValue(v, 32));
            return getBytes(v);
        }
    }

    let match = type.match(regexNumber);
    if (match) {
        const signed = match[1] === "int";
        let size = parseInt(match[2] || "256");
        assertArgument(
            (!match[2] || match[2] === String(size)) && size % 8 === 0 && size !== 0 && size <= 256,
            "invalid number type", "type", type,
        );
        if (isArray) size = 256;
        const v = signed ? toTwos(value as BigNumberish, size) : (value as BigNumberish);
        return getBytes(zeroPadValue(toBeArray(v), size / 8));
    }

    match = type.match(regexBytes);
    if (match) {
        const size = parseInt(match[1]);
        assertArgument(String(size) === match[1] && size !== 0 && size <= 32, "invalid bytes type", "type", type);
        assertArgument(dataLength(value as BytesLike) === size, `invalid value for ${type}`, "value", value);
        if (isArray) return getBytes(zeroPadBytes(value as BytesLike, 32));
        return getBytes(value as BytesLike);
    }

    match = type.match(regexArray);
    if (match && Array.isArray(value)) {
        const baseType = match[1];
        const count = parseInt(match[2] || String(value.length));
        assertArgument(count === value.length, `invalid array length for ${type}`, "value", value);
        const result: Uint8Array[] = [];
        for (const v of value) result.push(_pack(baseType, v, true));
        return getBytes(concat(result));
    }

    assertArgument(false, "invalid type", "type", type);
}

export function solidityPacked(types: ReadonlyArray<string>, values: ReadonlyArray<unknown>): Hex {
    assertArgument(types.length === values.length, "wrong number of values", "values", values);
    const tight: Uint8Array[] = [];
    for (let i = 0; i < types.length; i++) {
        tight.push(_pack(types[i], values[i]));
    }
    return hexlify(concat(tight));
}

export function solidityPackedKeccak256(types: ReadonlyArray<string>, values: ReadonlyArray<unknown>): Hex {
    return keccak256(solidityPacked(types, values));
}

// ─────────────────────────────────────────────────────────────────────────────
// RLP encode (src.ts/utils/rlp-encode.ts)
// ─────────────────────────────────────────────────────────────────────────────

function arrayifyInteger(value: number): number[] {
    const result: number[] = [];
    while (value) {
        result.unshift(value & 0xff);
        value >>= 8;
    }
    return result;
}

function _rlpEncode(object: RlpStructuredDataish): number[] {
    if (Array.isArray(object)) {
        let payload: number[] = [];
        object.forEach((child) => {
            payload = payload.concat(_rlpEncode(child));
        });
        if (payload.length <= 55) {
            payload.unshift(0xc0 + payload.length);
            return payload;
        }
        const length = arrayifyInteger(payload.length);
        length.unshift(0xf7 + length.length);
        return length.concat(payload);
    }
    const data: number[] = Array.prototype.slice.call(getBytes(object as BytesLike, "object"));
    if (data.length === 1 && data[0] <= 0x7f) return data;
    if (data.length <= 55) {
        data.unshift(0x80 + data.length);
        return data;
    }
    const length = arrayifyInteger(data.length);
    length.unshift(0xb7 + length.length);
    return length.concat(data);
}

export function encodeRlp(object: RlpStructuredDataish): Hex {
    let result = "0x";
    for (const v of _rlpEncode(object)) {
        result += Nibbles[v >> 4];
        result += Nibbles[v & 0xf];
    }
    return result as Hex;
}

// ─────────────────────────────────────────────────────────────────────────────
// ABI codec (src.ts/abi/* — class hierarchy collapsed into recursive functions)
//
// Type grammar (subset used by abstractionkit):
//   address | bool | string | bytes | bytes<1..32> | uint<8..256> | int<8..256>
//   T[] | T[<n>] | (T1,T2,...) (tuples)
// ─────────────────────────────────────────────────────────────────────────────

type AbiType =
    | { kind: "uint"; bits: number; signed: boolean }
    | { kind: "address" }
    | { kind: "bool" }
    | { kind: "bytesN"; size: number }
    | { kind: "bytes" }
    | { kind: "string" }
    | { kind: "array"; child: AbiType; size: number /* -1 = dynamic */ }
    | { kind: "tuple"; components: AbiType[] };

function splitTopLevel(s: string): string[] {
    const out: string[] = [];
    let depth = 0, start = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c === "(" || c === "[") depth++;
        else if (c === ")" || c === "]") depth--;
        else if (c === "," && depth === 0) { out.push(s.slice(start, i)); start = i + 1; }
    }
    if (start < s.length) out.push(s.slice(start));
    return out.map((x) => x.trim()).filter((x) => x.length > 0);
}

function parseType(s: string): AbiType {
    s = s.trim();
    const m = s.match(/^(.+?)((?:\[\d*\])*)$/);
    assertArgument(!!m, `invalid type`, "type", s);
    const base = m![1], suffix = m![2];

    let t: AbiType;
    if (base.startsWith("(")) {
        assertArgument(base.endsWith(")"), `unbalanced tuple`, "type", s);
        t = { kind: "tuple", components: splitTopLevel(base.slice(1, -1)).map(parseType) };
    } else if (base === "address") t = { kind: "address" };
    else if (base === "bool") t = { kind: "bool" };
    else if (base === "string") t = { kind: "string" };
    else if (base === "bytes") t = { kind: "bytes" };
    else if (base === "uint" || base === "int") t = { kind: "uint", bits: 256, signed: base === "int" };
    else {
        const um = base.match(regexNumber);
        if (um) {
            const bits = parseInt(um[2] || "256");
            assertArgument(bits !== 0 && bits <= 256 && bits % 8 === 0, "invalid number type", "type", base);
            t = { kind: "uint", bits, signed: um[1] === "int" };
        } else {
            const bm = base.match(regexBytes);
            assertArgument(!!bm, `unknown type ${base}`, "type", base);
            const size = parseInt(bm![1]);
            assertArgument(size !== 0 && size <= 32, "invalid bytes type", "type", base);
            t = { kind: "bytesN", size };
        }
    }

    for (const ap of suffix.matchAll(/\[(\d*)\]/g)) {
        t = { kind: "array", child: t, size: ap[1] ? parseInt(ap[1]) : -1 };
    }
    return t;
}

function isDynamic(t: AbiType): boolean {
    switch (t.kind) {
        case "bytes": case "string": return true;
        case "array": return t.size === -1 || isDynamic(t.child);
        case "tuple": return t.components.some(isDynamic);
        default: return false;
    }
}

function staticSize(t: AbiType): number {
    switch (t.kind) {
        case "uint": case "address": case "bool": case "bytesN": return 32;
        case "array": return t.size * staticSize(t.child);
        case "tuple": return t.components.reduce((s, c) => s + staticSize(c), 0);
        default: throw new Error(`staticSize: dynamic type ${t.kind}`);
    }
}

const WordSize = 32;
const Padding = new Uint8Array(WordSize);
// Allocation cap for dynamic arrays whose element type has zero head footprint
// (e.g. empty tuples), where the payload carries no per-element bytes to bound
// the length against. Far above any realistic decode, low enough to stay safe.
const MaxZeroFootprintArrayLen = 1 << 20;

function padLeft(b: Uint8Array, size: number): Uint8Array {
    assertCheck(b.length <= size, "padLeft: overflow");
    const out = new Uint8Array(size);
    out.set(b, size - b.length);
    return out;
}

function padRight(b: Uint8Array, size: number): Uint8Array {
    assertCheck(b.length <= size, "padRight: overflow");
    const out = new Uint8Array(size);
    out.set(b, 0);
    return out;
}

function padTo32(len: number): number {
    return Math.ceil(len / WordSize) * WordSize;
}

const BN_MAX_UINT256 = (1n << 256n) - 1n;

function encodeValue(t: AbiType, v: unknown): Uint8Array {
    switch (t.kind) {
        case "uint": {
            let value = getBigInt(v as BigNumberish, "value");
            const maxUintValue = mask(BN_MAX_UINT256, WordSize * 8);
            if (t.signed) {
                const bounds = mask(maxUintValue, t.bits - 1);
                assertCheck(value <= bounds && value >= -(bounds + 1n), `int${t.bits}: value out-of-bounds`);
                value = toTwos(value, 8 * WordSize);
            } else {
                assertCheck(value >= 0n && value <= mask(maxUintValue, t.bits), `uint${t.bits}: out-of-bounds`);
            }
            return padLeft(toBeArray(value), WordSize);
        }
        case "address": {
            const bytes = getBytes(getAddress(v as string));
            return padLeft(bytes, WordSize);
        }
        case "bool":
            return padLeft(new Uint8Array([v ? 1 : 0]), WordSize);
        case "bytesN": {
            const bytes = getBytes(v as BytesLike);
            assertCheck(bytes.length === t.size, `bytes${t.size}: wrong length`);
            return padRight(bytes, WordSize);
        }
        case "bytes": {
            const bytes = getBytes(v as BytesLike);
            return concatBytes([padLeft(toBeArray(bytes.length), WordSize), padRight(bytes, padTo32(bytes.length))]);
        }
        case "string": {
            const bytes = toUtf8Bytes(v as string);
            return concatBytes([padLeft(toBeArray(bytes.length), WordSize), padRight(bytes, padTo32(bytes.length))]);
        }
        case "array": {
            const arr = v as unknown[];
            assertCheck(t.size === -1 || arr.length === t.size, "array: length mismatch");
            const types = Array<AbiType>(arr.length).fill(t.child);
            const inner = encodeTuple(types, arr);
            return t.size === -1
                ? concatBytes([padLeft(toBeArray(arr.length), WordSize), inner])
                : inner;
        }
        case "tuple":
            return encodeTuple(t.components, v as unknown[]);
    }
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
    const total = parts.reduce((s, p) => s + p.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.length; }
    return out;
}

function encodeTuple(types: AbiType[], values: unknown[]): Uint8Array {
    assertCheck(types.length === values.length, "tuple: length mismatch");
    const heads: Uint8Array[] = [];
    const tails: Uint8Array[] = [];
    const headSize = types.reduce((s, t) => s + (isDynamic(t) ? WordSize : staticSize(t)), 0);
    let tailOff = headSize;
    for (let i = 0; i < types.length; i++) {
        const enc = encodeValue(types[i], values[i]);
        if (isDynamic(types[i])) {
            heads.push(padLeft(toBeArray(tailOff), WordSize));
            tails.push(enc);
            tailOff += enc.length;
        } else {
            heads.push(enc);
        }
    }
    return concatBytes([...heads, ...tails]);
}

function ensureRange(data: Uint8Array, offset: number, len: number, what: string): void {
    if (offset < 0 || len < 0 || offset + len > data.length) {
        throw new Error(
            `ABI decode: out-of-bounds read for ${what} ` +
            `(offset=${offset}, length=${len}, data.length=${data.length})`,
        );
    }
}

function decodeValue(t: AbiType, data: Uint8Array, base: number): unknown {
    switch (t.kind) {
        case "uint": {
            ensureRange(data, base, WordSize, `${t.signed ? "int" : "uint"}${t.bits}`);
            const raw = toBigInt(data.slice(base, base + WordSize));
            const masked = mask(raw, t.bits);
            return t.signed ? fromTwos(masked, t.bits) : masked;
        }
        case "address":
            ensureRange(data, base, WordSize, "address");
            return getAddress(hexlify(data.slice(base + 12, base + WordSize)));
        case "bool":
            ensureRange(data, base, WordSize, "bool");
            return data[base + 31] !== 0;
        case "bytesN":
            ensureRange(data, base, WordSize, `bytes${t.size}`);
            return hexlify(data.slice(base, base + t.size));
        case "bytes": {
            ensureRange(data, base, WordSize, "bytes length");
            const len = toNumber(data.slice(base, base + WordSize));
            ensureRange(data, base + WordSize, len, "bytes payload");
            return hexlify(data.slice(base + WordSize, base + WordSize + len));
        }
        case "string": {
            ensureRange(data, base, WordSize, "string length");
            const len = toNumber(data.slice(base, base + WordSize));
            ensureRange(data, base + WordSize, len, "string payload");
            return fromUtf8Bytes(data.slice(base + WordSize, base + WordSize + len));
        }
        case "array": {
            if (t.size === -1) {
                ensureRange(data, base, WordSize, "array length");
                const len = toNumber(data.slice(base, base + WordSize));
                // Bound the element count before allocating, so a hostile length
                // word can't trigger an out-of-memory allocation. Each element
                // occupies a fixed head footprint in the array body: a 32-byte
                // offset slot for a dynamic element, its static size for a static
                // one. Zero-footprint elements (e.g. empty tuples) consume no
                // body bytes, so there is nothing to bound the length against;
                // cap those by an absolute length instead.
                const elementHeadSize = isDynamic(t.child)
                    ? WordSize
                    : staticSize(t.child);
                const bodyBytes = data.length - (base + WordSize);
                const maxElements =
                    elementHeadSize > 0
                        ? Math.floor(bodyBytes / elementHeadSize)
                        : MaxZeroFootprintArrayLen;
                if (len > maxElements) {
                    throw new Error(
                        `ABI decode: array length ${len} exceeds payload capacity ` +
                        `(maxElements=${maxElements}, data.length=${data.length})`,
                    );
                }
                return decodeTupleAt(Array<AbiType>(len).fill(t.child), data, base + WordSize);
            }
            return decodeTupleAt(Array<AbiType>(t.size).fill(t.child), data, base);
        }
        case "tuple":
            return decodeTupleAt(t.components, data, base);
    }
}

function decodeTupleAt(types: AbiType[], data: Uint8Array, base: number): unknown[] {
    const out: unknown[] = [];
    let head = 0;
    for (const t of types) {
        if (isDynamic(t)) {
            ensureRange(data, base + head, WordSize, "tuple offset slot");
            const off = toNumber(data.slice(base + head, base + head + WordSize));
            if (off < 0 || base + off > data.length) {
                throw new Error(
                    `ABI decode: tuple dynamic offset out-of-bounds ` +
                    `(offset=${off}, base=${base}, data.length=${data.length})`,
                );
            }
            out.push(decodeValue(t, data, base + off));
            head += WordSize;
        } else {
            const size = staticSize(t);
            ensureRange(data, base + head, size, `tuple static slot (${t.kind})`);
            out.push(decodeValue(t, data, base + head));
            head += size;
        }
    }
    return out;
}

export function encodeAbiParameters(
    types: ReadonlyArray<string>,
    values: ReadonlyArray<unknown>,
): Hex {
    assertCheck(types.length === values.length, "encodeAbiParameters: length mismatch");
    return hexlify(encodeTuple(types.map(parseType), values as unknown[]));
}

// Caller-asserted return shape: the generic T is not validated against `types`
// at compile time or runtime. Mismatched (types, T) pairs will mistype values.
export function decodeAbiParameters<T extends readonly unknown[] = unknown[]>(
    types: ReadonlyArray<string>,
    data: BytesLike,
): T {
    return decodeTupleAt(types.map(parseType), getBytes(data), 0) as unknown as T;
}

// ─────────────────────────────────────────────────────────────────────────────
// EIP-712 typed data (src.ts/hash/typed-data.ts — TypedDataEncoder collapsed)
// ─────────────────────────────────────────────────────────────────────────────

const hexTrue = toBeHex(BN_1, 32);
const hexFalse = toBeHex(BN_0, 32);

function hexPadRight(value: BytesLike): Hex {
    const bytes = getBytes(value);
    const padOffset = bytes.length % WordSize;
    if (padOffset) return concat([bytes, Padding.slice(padOffset)]);
    return hexlify(bytes);
}

function getBaseEncoder(type: string): null | ((value: unknown) => Hex) {
    {
        const match = type.match(/^(u?)int(\d+)$/);
        if (match) {
            const signed = match[1] === "";
            const width = parseInt(match[2]);
            assertArgument(
                width % 8 === 0 && width !== 0 && width <= 256 && match[2] === String(width),
                "invalid numeric width", "type", type,
            );
            const boundsUpper = mask(BN_MAX_UINT256, signed ? width - 1 : width);
            const boundsLower = signed ? (boundsUpper + BN_1) * -1n : BN_0;
            return (v: unknown) => {
                const value = getBigInt(v as BigNumberish, "value");
                assertCheck(value >= boundsLower && value <= boundsUpper, `value out-of-bounds for ${type}`);
                return toBeHex(signed ? toTwos(value, 256) : value, 32);
            };
        }
    }
    {
        const match = type.match(/^bytes(\d+)$/);
        if (match) {
            const width = parseInt(match[1]);
            assertArgument(width !== 0 && width <= 32 && match[1] === String(width), "invalid bytes width", "type", type);
            return (v: unknown) => {
                const bytes = getBytes(v as BytesLike);
                assertCheck(bytes.length === width, `invalid length for ${type}`);
                return hexPadRight(v as BytesLike);
            };
        }
    }
    switch (type) {
        case "address": return (v: unknown) => zeroPadValue(getAddress(v as string), 32);
        case "bool":    return (v: unknown) => (!v ? hexFalse : hexTrue);
        case "bytes":   return (v: unknown) => keccak256(v as BytesLike);
        case "string":  return (v: unknown) => id(v as string);
    }
    return null;
}

type ArrayResult = { base: string; index?: string; array?: { base: string; prefix: string; count: number } };

function splitArray(type: string): ArrayResult {
    //const match = type.match(/^([^\[]*)((\[\d*\])*)(\[(\d*)\])$/);
    const match = type.match(/^([^\x5b]*)((\x5b\d*\x5d)*)(\x5b(\d*)\x5d)$/);    
    if (match) {
        return {
            base: match[1],
            index: match[2] + match[4],
            array: { base: match[1], prefix: match[1] + match[2], count: match[5] ? parseInt(match[5]) : -1 },
        };
    }
    return { base: type };
}

function encodeType(name: string, fields: ReadonlyArray<TypedDataField>): string {
    return `${name}(${fields.map(({ name, type }) => type + " " + name).join(",")})`;
}

/**
 * Build a recursive encoder for `primaryType` that produces the EIP-712
 * `encodeData` for a struct value. Internal `fullTypes` map captures the
 * fully-described type string for each struct (`MyStruct(...)NestedStruct(...)`).
 */
function buildTypedDataState(_types: Record<string, ReadonlyArray<TypedDataField>>) {
    const fullTypes = new Map<string, string>();
    const links = new Map<string, Set<string>>();
    const parents = new Map<string, string[]>();
    const subtypes = new Map<string, Set<string>>();

    const types: Record<string, TypedDataField[]> = {};
    for (const type of Object.keys(_types)) {
        types[type] = _types[type].map(({ name, type }) => {
            let { base, index } = splitArray(type);
            if (base === "int" && !_types["int"]) base = "int256";
            if (base === "uint" && !_types["uint"]) base = "uint256";
            return { name, type: base + (index || "") };
        });
        links.set(type, new Set());
        parents.set(type, []);
        subtypes.set(type, new Set());
    }

    for (const name in types) {
        const uniqueNames = new Set<string>();
        for (const field of types[name]) {
            assertArgument(!uniqueNames.has(field.name), `duplicate variable name ${JSON.stringify(field.name)} in ${JSON.stringify(name)}`, "types", _types);
            uniqueNames.add(field.name);
            const baseType = splitArray(field.type).base;
            assertArgument(baseType !== name, `circular type reference to ${JSON.stringify(baseType)}`, "types", _types);
            if (getBaseEncoder(baseType)) continue;
            assertArgument(parents.has(baseType), `unknown type ${JSON.stringify(baseType)}`, "types", _types);
            parents.get(baseType)!.push(name);
            links.get(name)!.add(baseType);
        }
    }

    const primaryTypes = Array.from(parents.keys()).filter((n) => parents.get(n)!.length === 0);
    assertArgument(primaryTypes.length !== 0, "missing primary type", "types", _types);
    assertArgument(primaryTypes.length === 1, `ambiguous primary types or unused types: ${primaryTypes.map((t) => JSON.stringify(t)).join(", ")}`, "types", _types);
    const primaryType = primaryTypes[0];

    function checkCircular(type: string, found: Set<string>): void {
        assertArgument(!found.has(type), `circular type reference to ${JSON.stringify(type)}`, "types", _types);
        found.add(type);
        for (const child of links.get(type)!) {
            if (!parents.has(child)) continue;
            checkCircular(child, found);
            for (const subtype of found) subtypes.get(subtype)!.add(child);
        }
        found.delete(type);
    }
    checkCircular(primaryType, new Set());

    for (const [name, set] of subtypes) {
        const st = Array.from(set);
        st.sort();
        fullTypes.set(name, encodeType(name, types[name]) + st.map((t) => encodeType(t, types[t])).join(""));
    }

    const encoderCache = new Map<string, (value: unknown) => Hex>();
    function getEncoder(type: string): (value: unknown) => Hex {
        const cached = encoderCache.get(type);
        if (cached) return cached;
        const built = buildEncoder(type);
        encoderCache.set(type, built);
        return built;
    }
    function buildEncoder(type: string): (value: unknown) => Hex {
        const base = getBaseEncoder(type);
        if (base) return base;
        const arr = splitArray(type).array;
        if (arr) {
            const subtype = arr.prefix;
            const subEncoder = getEncoder(subtype);
            return (value: unknown) => {
                const arrVal = value as unknown[];
                assertCheck(arr.count === -1 || arr.count === arrVal.length, `array length mismatch; expected ${arr.count}`);
                let result = arrVal.map(subEncoder) as Hex[];
                if (fullTypes.has(subtype)) result = result.map(keccak256);
                return keccak256(concat(result));
            };
        }
        const fields = types[type];
        if (fields) {
            const encodedType = id(fullTypes.get(type)!);
            return (value: unknown) => {
                const obj = value as Record<string, unknown>;
                const values = fields.map(({ name, type }) => {
                    const r = getEncoder(type)(obj[name]);
                    return fullTypes.has(type) ? keccak256(r) : r;
                });
                values.unshift(encodedType);
                return concat(values);
            };
        }
        assertArgument(false, `unknown type: ${type}`, "type", type);
    }

    function hashStruct(name: string, value: Record<string, unknown>): Hex {
        return keccak256(getEncoder(name)(value));
    }

    return { primaryType, hashStruct };
}

const domainFieldTypes: Record<string, string> = {
    name: "string",
    version: "string",
    chainId: "uint256",
    verifyingContract: "address",
    salt: "bytes32",
};
const domainFieldNames = ["name", "version", "chainId", "verifyingContract", "salt"];

function hashDomain(domain: TypedDataDomain): Hex {
    const domainFields: TypedDataField[] = [];
    for (const name in domain) {
        const v = (domain as Record<string, unknown>)[name];
        if (v == null) continue;
        const type = domainFieldTypes[name];
        assertArgument(!!type, `invalid typed-data domain key: ${JSON.stringify(name)}`, "domain", domain);
        domainFields.push({ name, type });
    }
    domainFields.sort((a, b) => domainFieldNames.indexOf(a.name) - domainFieldNames.indexOf(b.name));
    const { hashStruct } = buildTypedDataState({ EIP712Domain: domainFields });
    return hashStruct("EIP712Domain", domain as Record<string, unknown>);
}

export function hashTypedData(
    domain: TypedDataDomain,
    types: Record<string, ReadonlyArray<TypedDataField>>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    value: Record<string, any>,
): Hex {
    // Strip EIP712Domain from user types (ethers does this implicitly).
    const userTypes: Record<string, ReadonlyArray<TypedDataField>> = {};
    for (const [k, v] of Object.entries(types)) if (k !== "EIP712Domain") userTypes[k] = v;
    const { primaryType, hashStruct } = buildTypedDataState(userTypes);
    return keccak256(concat(["0x1901", hashDomain(domain), hashStruct(primaryType, value)]));
}

// ─────────────────────────────────────────────────────────────────────────────
// Signing (src.ts/crypto/{signing-key,signature}.ts + transaction/address.ts)
//   Class-free: privateKeyToAddress + signHash + signTypedData functions only.
// ─────────────────────────────────────────────────────────────────────────────

function computePublicKey(privateKey: BytesLike): Hex {
    const bytes = getBytes(privateKey, "key");
    assertCheck(bytes.length === 32, "invalid private key");
    return hexlify(secp256k1.getPublicKey(bytes, false));
}

// Mirrors `Wallet` constructor (src.ts/wallet/wallet.ts:42-44): accept
// unprefixed hex at the public signing API while keeping internal `getBytes`
// strict.
function normalizePrivateKey(key: string): string {
    return key.startsWith("0x") ? key : "0x" + key;
}

export function privateKeyToAddress(privateKey: string): Hex {
    const pub = computePublicKey(normalizePrivateKey(privateKey));
    return getAddress(keccak256(("0x" + pub.substring(4)) as Hex).substring(26));
}

export function signHash(privateKey: string, hash: BytesLike): Signature {
    assertCheck(dataLength(hash) === 32, "invalid digest length");
    const sig = secp256k1.sign(getBytesCopy(hash), getBytesCopy(normalizePrivateKey(privateKey)), { lowS: true });
    const r = toBeHex(sig.r, 32);
    const s = toBeHex(sig.s, 32);
    const yParity = (sig.recovery & 1) as 0 | 1;
    const v = (27 + yParity) as 27 | 28;
    return {
        r,
        s,
        v,
        yParity,
        serialized: concat([r, s, new Uint8Array([v])]),
    };
}

export function signTypedData(
    privateKey: string,
    domain: TypedDataDomain,
    types: Record<string, ReadonlyArray<TypedDataField>>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    message: Record<string, any>,
): Hex {
    return signHash(privateKey, hashTypedData(domain, types, message)).serialized;
}
