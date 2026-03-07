const ak = require('../../dist/index.umd');
const crypto = require('crypto');
require('dotenv').config();

const chainId = BigInt(process.env.CHAIN_ID);
const providerRpc = process.env.JSON_RPC_NODE_PROVIDER;
const bundlerRpc = process.env.BUNDLER_URL;
const entryPointV9 = "0x433709009B8330FDa32311DF1C2AFA402eD8D009";
const caliburV9Singleton = "0x71032285A847c4311Eb7ec2E7A636aB94A9805Aa";

const eoaPrivateKey = process.env.PRIVATE_KEY1;
const eoaAddress = process.env.PUBLIC_ADDRESS1;

if (!providerRpc || !bundlerRpc || !eoaPrivateKey || !eoaAddress) {
    console.error('Missing required env vars: CHAIN_ID, JSON_RPC_NODE_PROVIDER, BUNDLER_URL, PRIVATE_KEY1, PUBLIC_ADDRESS1');
    console.error('Copy .env.example to .env and fill in the values.');
    process.exit(1);
}

// Generate a P256 key pair for the passkey
const p256KeyPair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pubKeyDer = p256KeyPair.publicKey.export({ type: 'spki', format: 'der' });
// P256 uncompressed public key is the last 64 bytes of the DER-encoded SPKI
const uncompressedKey = pubKeyDer.subarray(-64);
const pubKeyX = BigInt('0x' + uncompressedKey.subarray(0, 32).toString('hex'));
const pubKeyY = BigInt('0x' + uncompressedKey.subarray(32, 64).toString('hex'));

console.log("P256 public key:");
console.log("  x:", pubKeyX.toString(16).substring(0, 20) + "...");
console.log("  y:", pubKeyY.toString(16).substring(0, 20) + "...");

// Helper: base64url encode
function base64url(buf) {
    return Buffer.from(buf).toString('base64url');
}

// Helper: sign with P256 and return r, s as bigints
// Accepts raw Buffer — crypto.sign(null, ...) will SHA-256 hash internally for P256
function p256Sign(data) {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data.slice(2), 'hex');
    const sig = crypto.sign(null, buf, {
        key: p256KeyPair.privateKey,
        dsaEncoding: 'ieee-p1363',
    });
    const r = BigInt('0x' + sig.subarray(0, 32).toString('hex'));
    const s = BigInt('0x' + sig.subarray(32, 64).toString('hex'));
    // Normalize s to low-s form (required by some verifiers)
    const secp256r1Order = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551n;
    const halfOrder = secp256r1Order / 2n;
    return { r, s: s > halfOrder ? secp256r1Order - s : s };
}

async function main() {
    const account = new ak.Calibur7702Account(eoaAddress, {
        entrypointAddress: entryPointV9,
        delegateeAddress: caliburV9Singleton,
    });

    const balance = await ak.sendJsonRpcRequest(providerRpc, "eth_getBalance", [eoaAddress, "latest"]);
    console.log("\nEOA balance:", Number(BigInt(balance)) / 1e18, "ETH");

    // ─── Step 1: Register the passkey using root key ───────────────────
    console.log("\n=== Step 1: Register passkey ===");

    const webAuthnKey = ak.Calibur7702Account.createWebAuthnP256Key(pubKeyX, pubKeyY);
    const keyHash = ak.Calibur7702Account.getKeyHash(webAuthnKey);
    console.log("Key hash:", keyHash);

    const registerTxs = ak.Calibur7702Account.createRegisterKeyMetaTransactions(webAuthnKey, {
        expiration: Math.floor(Date.now() / 1000) + 86400 * 365, // 1 year
    });
    console.log("Register txs:", registerTxs.length);

    const registerOp = await account.createUserOperation(
        registerTxs,
        providerRpc,
        bundlerRpc,
    );
    console.log("Register UserOp created, gas:", {
        callGasLimit: registerOp.callGasLimit,
        verificationGasLimit: registerOp.verificationGasLimit,
    });

    // Sign with root key
    registerOp.signature = account.signUserOperation(registerOp, eoaPrivateKey, chainId);

    // Send
    console.log("Sending register UserOp...");
    const registerResponse = await account.sendUserOperation(registerOp, bundlerRpc);
    console.log("Register sent! Hash:", registerResponse.userOperationHash);
    const registerReceipt = await registerResponse.included();
    console.log("Register SUCCESS! Tx:", registerReceipt.receipt.transactionHash);

    // ─── Step 2: Send a UserOp signed with the passkey ─────────────────
    console.log("\n=== Step 2: Send UserOp with passkey ===");

    // Use bundler for gas estimation with a dummy WebAuthn sig for the registered key
    const dummyWebAuthnSig = ak.Calibur7702Account.createDummyWebAuthnSignature(keyHash);
    const passkeyOp = await account.createUserOperation(
        [{ to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', value: 0n, data: '0x' }],
        providerRpc,
        bundlerRpc,
        {
            dummySignature: dummyWebAuthnSig,
            verificationGasLimit: 500000n,
        },
    );
    console.log("Passkey UserOp created, nonce:", passkeyOp.nonce);
    console.log("Gas limits:", {
        callGasLimit: passkeyOp.callGasLimit,
        verificationGasLimit: passkeyOp.verificationGasLimit,
        preVerificationGas: passkeyOp.preVerificationGas,
    });

    // Compute the userOpHash
    const userOpHash = ak.createUserOperationHash(
        passkeyOp,
        entryPointV9,
        chainId,
    );
    console.log("UserOp hash:", userOpHash);

    // Build WebAuthn assertion data
    // authenticatorData: rpIdHash (32 bytes) + flags (1 byte) + signCount (4 bytes) = 37 bytes
    const rpIdHash = crypto.createHash('sha256').update('localhost').digest();
    const flags = Buffer.from([0x05]); // UP + UV
    const signCount = Buffer.alloc(4);
    const authenticatorData = Buffer.concat([rpIdHash, flags, signCount]);
    const authenticatorDataHex = '0x' + authenticatorData.toString('hex');

    // clientDataJSON: the challenge must be base64url(userOpHash)
    const challengeB64 = base64url(Buffer.from(userOpHash.slice(2), 'hex'));
    const clientDataJSON = JSON.stringify({
        type: "webauthn.get",
        challenge: challengeB64,
        origin: "https://localhost",
    });

    // Find indices in clientDataJSON (WebAuthn.sol expects these to point to the full key-value)
    const challengeIndex = BigInt(clientDataJSON.indexOf('"challenge":"'));
    const typeIndex = BigInt(clientDataJSON.indexOf('"type":"webauthn.get"'));

    // The on-chain verifier computes: sha256(authenticatorData || sha256(clientDataJSON))
    // and checks the P256 signature against that hash.
    // crypto.sign(null, data, key) for P256 internally applies SHA-256, so we
    // pass the raw concatenation and let Node hash it (no pre-hashing).
    const clientDataHash = crypto.createHash('sha256').update(clientDataJSON).digest();
    const signedData = Buffer.concat([authenticatorData, clientDataHash]);
    const { r, s } = p256Sign(signedData);

    console.log("WebAuthn signature computed");
    console.log("  challengeIndex:", challengeIndex);
    console.log("  typeIndex:", typeIndex);

    // Format the signature using the SDK
    passkeyOp.signature = account.formatWebAuthnSignature(keyHash, {
        authenticatorData: authenticatorDataHex,
        clientDataJSON: clientDataJSON,
        challengeIndex: challengeIndex,
        typeIndex: typeIndex,
        r: r,
        s: s,
    });
    console.log("Passkey signature formatted, length:", passkeyOp.signature.length);

    // Send
    console.log("Sending passkey UserOp...");
    const passkeyResponse = await account.sendUserOperation(passkeyOp, bundlerRpc);
    console.log("Passkey sent! Hash:", passkeyResponse.userOperationHash);
    const passkeyReceipt = await passkeyResponse.included();
    console.log("Passkey SUCCESS! Tx:", passkeyReceipt.receipt.transactionHash);
}

main().catch(e => {
    console.error("Fatal:", e.message);
    if (e.cause) console.error("  cause:", e.cause.message);
    process.exit(1);
});
