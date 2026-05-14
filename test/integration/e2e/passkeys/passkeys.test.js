const { Wallet } = require('ethers');
const { hexToBytes, keccak256, numberToBytes, toBytes } = require('viem');
const {
    SafeAccountV0_3_0,
    fromSafeWebauthn,
    pubkeyCoordinatesFromJson,
    pubkeyCoordinatesToJson,
    sendJsonRpcRequest,
    webauthnSignatureFromAssertion,
} = require('../../../../dist/index.cjs');
const { runnable, unrunnable, nodeUrl, bundlerUrl } = require('../../_runnable.cjs');
const { WebAuthnCredentials, UserVerificationRequirement, extractPublicKey } = require('./_webauthn.cjs');

jest.setTimeout(180000);

const ONE_ETH = 10n ** 18n;
const toHex = (n) => `0x${n.toString(16)}`;

describe('passkeys', () => {
    test.concurrent.each(runnable)(
        'passkey-owned Safe deploys and executes a userop: $name (chainId $chainId)',
        async (chain) => {
            const node = nodeUrl(chain);
            const bundler = bundlerUrl(chain);
            const chainId = BigInt(chain.chainId);

            const navigator = { credentials: new WebAuthnCredentials() };
            const credential = navigator.credentials.create({
                publicKey: {
                    rp: { name: 'Candide', id: 'candide.dev' },
                    user: {
                        id: hexToBytes(keccak256(toBytes('chucknorris'))),
                        name: 'chucknorris',
                        displayName: 'Chuck Norris',
                    },
                    challenge: numberToBytes(Date.now()),
                    pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
                },
            });

            const persisted = pubkeyCoordinatesToJson(extractPublicKey(credential.response));
            const publicKey = pubkeyCoordinatesFromJson(persisted);

            const account = SafeAccountV0_3_0.initializeNewAccount([publicKey]);
            await sendJsonRpcRequest(node, 'anvil_setBalance', [account.accountAddress, toHex(ONE_ETH)]);

            const recipient = Wallet.createRandom().address;
            const value = 1_000_000_000_000_000n;

            const userOp = await account.createUserOperation(
                [{ to: recipient, value, data: '0x' }],
                node,
                bundler,
                { expectedSigners: [publicKey] },
            );

            const isInit = userOp.nonce === 0n;
            const signer = fromSafeWebauthn({
                publicKey,
                isInit,
                accountClass: SafeAccountV0_3_0,
                getAssertion: async (challenge) => {
                    const assertion = navigator.credentials.get({
                        publicKey: {
                            challenge,
                            rpId: 'candide.dev',
                            allowCredentials: [{ type: 'public-key', id: new Uint8Array(credential.rawId) }],
                            userVerification: UserVerificationRequirement.required,
                        },
                    });
                    return webauthnSignatureFromAssertion(assertion.response);
                },
            });

            userOp.signature = await account.signUserOperationWithSigners(userOp, [signer], chainId);

            const receipt = await (await account.sendUserOperation(userOp, bundler)).included();
            expect(receipt?.success).toBe(true);

            const bal = await sendJsonRpcRequest(node, 'eth_getBalance', [recipient, 'latest']);
            expect(BigInt(bal)).toBe(value);
        },
    );

    if (unrunnable.length > 0) {
        test.skip.each(unrunnable)('$name (setup failed)', () => {});
    }
});
