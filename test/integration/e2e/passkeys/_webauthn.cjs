// WebAuthn Node shim ported from abstractionkit-examples/passkeys/webauthn.ts
// Source: https://github.com/safe-global/safe-modules/blob/.../webauthn.ts
//
// Emulates `navigator.credentials.create` and `navigator.credentials.get` in
// Node so that integration tests can drive `fromSafeWebauthn` without a real
// authenticator. Uses node:crypto for P-256 ECDSA signing.

const crypto = require('node:crypto');
const { keccak256, sha256, toHex, hexToBytes, toBytes, maxUint256 } = require('viem');
const CBOR = require('cbor');

const UserVerificationRequirement = {
    required: 'required',
    preferred: 'preferred',
    discouraged: 'discouraged',
};

class Credential {
    constructor(rp, user) {
        this.rp = rp;
        this.user = user;
        const keyPair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
        this.privateKey = keyPair.privateKey;

        const pubJwk = keyPair.publicKey.export({ format: 'jwk' });
        const x = Buffer.from(pubJwk.x, 'base64url');
        const y = Buffer.from(pubJwk.y, 'base64url');
        this.publicKeyUncompressed = new Uint8Array(Buffer.concat([Buffer.from([0x04]), x, y]));

        const pubKeyHash = keccak256(toHex(this.publicKeyUncompressed.slice(1)));
        this.id = `0x${pubKeyHash.slice(26)}`;
    }

    cosePublicKey() {
        const x = this.publicKeyUncompressed.subarray(1, 33);
        const y = this.publicKeyUncompressed.subarray(33, 65);
        const key = new Map();
        key.set(-1, 1);
        key.set(-2, b2ab(x));
        key.set(-3, b2ab(y));
        key.set(1, 2);
        key.set(3, -7);
        return CBOR.encode(key);
    }
}

function buildAuthenticatorData(rpId, flags, signCount, attestedCredentialData) {
    const rpIdHash = Buffer.from(hexToBytes(sha256(toBytes(rpId))));
    const flagsBuf = Buffer.from([flags]);
    const signCountBuf = Buffer.alloc(4);
    signCountBuf.writeUInt32BE(signCount);
    const parts = [rpIdHash, flagsBuf, signCountBuf];
    if (attestedCredentialData) parts.push(attestedCredentialData);
    return Buffer.concat(parts);
}

class WebAuthnCredentials {
    constructor() {
        this.credentials = [];
    }

    create({ publicKey }) {
        if (!publicKey.pubKeyCredParams.some(({ alg }) => alg === -7)) {
            throw new Error('unsupported signature algorithm(s)');
        }
        const credential = new Credential(publicKey.rp.id, publicKey.user.id);
        this.credentials.push(credential);

        const clientData = {
            type: 'webauthn.create',
            challenge: base64UrlEncode(publicKey.challenge).replace(/=*$/, ''),
            origin: `https://${publicKey.rp.id}`,
        };
        const userVerification = publicKey.userVerification ?? 'preferred';
        const uvFlag = userVerification === UserVerificationRequirement.required ? 0x04 : 0x00;

        const aaguid = Buffer.alloc(16, 0x42);
        const credIdBytes = Buffer.from(hexToBytes(credential.id));
        const credIdLen = Buffer.alloc(2);
        credIdLen.writeUInt16BE(credIdBytes.length);
        const attestedCredentialData = Buffer.concat([
            aaguid,
            credIdLen,
            credIdBytes,
            credential.cosePublicKey(),
        ]);

        const authData = buildAuthenticatorData(
            publicKey.rp.id,
            0x41 | uvFlag,
            0,
            attestedCredentialData,
        );
        const attestationObject = { authData, fmt: 'none', attStmt: {} };

        return {
            id: base64UrlEncode(credential.id),
            rawId: b2ab(hexToBytes(credential.id)),
            response: {
                clientDataJSON: b2ab(Buffer.from(JSON.stringify(clientData))),
                attestationObject: b2ab(CBOR.encode(attestationObject)),
            },
            type: 'public-key',
        };
    }

    get({ publicKey }) {
        const credential = publicKey.allowCredentials
            .flatMap(({ id }) =>
                this.credentials.filter((c) => c.rp === publicKey.rpId && c.id === toHex(id)),
            )
            .at(0);
        if (credential === undefined) throw new Error('credential not found');

        const clientData = {
            type: 'webauthn.get',
            challenge: base64UrlEncode(publicKey.challenge).replace(/=*$/, ''),
            origin: `https://${publicKey.rpId}`,
        };
        const userVerification = publicKey.userVerification ?? 'preferred';
        const uvFlag = userVerification === UserVerificationRequirement.required ? 0x04 : 0x00;
        const authenticatorData = buildAuthenticatorData(publicKey.rpId, 0x01 | uvFlag, 0);

        const clientDataHash = Buffer.from(hexToBytes(sha256(toBytes(JSON.stringify(clientData)))));
        const dataToSign = Buffer.concat([authenticatorData, clientDataHash]);
        const derSignature = crypto.sign('sha256', dataToSign, credential.privateKey);

        return {
            id: base64UrlEncode(credential.id),
            rawId: b2ab(hexToBytes(credential.id)),
            response: {
                clientDataJSON: b2ab(Buffer.from(JSON.stringify(clientData))),
                authenticatorData: b2ab(authenticatorData),
                signature: b2ab(derSignature),
                userHandle: credential.user,
            },
            type: 'public-key',
        };
    }
}

function base64UrlEncode(data) {
    if (typeof data === 'string') return Buffer.from(hexToBytes(data)).toString('base64url');
    if (data instanceof Uint8Array) return Buffer.from(data).toString('base64url');
    return Buffer.from(new Uint8Array(data)).toString('base64url');
}

function b2ab(buf) {
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function extractPublicKey(response) {
    const attestationObject = CBOR.decode(response.attestationObject);
    const authData = attestationObject.authData;
    const authDataView = new DataView(authData.buffer, authData.byteOffset, authData.byteLength);
    const credentialIdLength = authDataView.getUint16(53);
    const cosePublicKey = authData.subarray(55 + credentialIdLength);
    const key = CBOR.decode(cosePublicKey);
    const bn = (bytes) => BigInt(toHex(bytes));
    return { x: bn(key.get(-2)), y: bn(key.get(-3)) };
}

module.exports = { WebAuthnCredentials, UserVerificationRequirement, extractPublicKey };
