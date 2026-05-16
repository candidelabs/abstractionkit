const { Wallet } = require('ethers');
const {
    sendJsonRpcRequest,
    createAndSignEip7702DelegationAuthorization,
} = require('../../../../dist/index.cjs');
const { runnableMatrix, unrunnable, nodeUrl, bundlerUrl } = require('../../_runnable.cjs');

jest.setTimeout(120000);

const ONE_ETH = 10n ** 18n;
const toHex = (n) => `0x${n.toString(16)}`;

describe('eip-712 signing', () => {
    test.concurrent.each(runnableMatrix())(
        'sign userop via EIP-712 typed data: $chainName / $accountVersion (chainId $chainId)',
        async (entry) => {
            const node = nodeUrl(entry);
            const bundler = bundlerUrl(entry);
            const { accountClass: Account } = entry;

            const owner = Wallet.createRandom();
            // EIP-7702 accounts: the EOA address IS the account address, so
            // construct from the random wallet's own address.
            let account;
            if (entry.isSafeMultiSig) {
                account = Account.initializeNewAccount([owner.address]);
            } else {
                account = new Account(owner.address);
            }

            await sendJsonRpcRequest(node, 'anvil_setBalance', [account.accountAddress, toHex(ONE_ETH)]);

            const recipient = Wallet.createRandom().address;
            const value = 1_000_000_000_000_000n;

            // First 7702 userOp must carry an eip7702Auth so the EOA gets
            // delegated to the singleton; pass `{ chainId }` for dummy r/s
            // during gas estimation and overwrite with a real signed auth
            // before sending.
            const createOverrides = {};
            if (!entry.isSafeMultiSig) {
                createOverrides.eip7702Auth = { chainId: BigInt(entry.chainId) };
            }
            const userOp = await account.createUserOperation(
                [{ to: recipient, value, data: '0x' }],
                node,
                bundler,
                createOverrides,
            );

            const { domain, types, messageValue, message } = Account.getUserOperationEip712Data(
                userOp,
                BigInt(entry.chainId),
            );
            const { EIP712Domain, ...typesForSigning } = types;
            // Safe's helper exposes the typed value under `messageValue`; the
            // shared v8/v9 helper (Calibur, Simple7702) exposes it under
            // `message`. Take whichever is defined.
            const signature = await owner.signTypedData(
                domain,
                typesForSigning,
                messageValue ?? message,
            );

            if (entry.isSafeMultiSig) {
                // MultiChainSigV1's on-chain module verifies against a Merkle
                // root even for single-op signatures, so the formatter needs
                // to mark this signature as multi-chain so the wrapper
                // includes the Merkle proof bit. Other Safe versions ignore.
                const isMultiChain = entry.accountVersion === 'MultiChainSigV1';
                const singleFormatted = Account.formatEip712SingleSignatureToUseroperationSignature(
                    signature,
                    { isMultiChainSignature: isMultiChain },
                );
                const pluralFormatted = Account.formatEip712SignaturesToUseroperationSignature(
                    [owner.address],
                    [signature],
                    { isMultiChainSignature: isMultiChain },
                );
                expect(singleFormatted).toBe(pluralFormatted);
                userOp.signature = singleFormatted;
            } else {
                // Replace the SDK's dummy 7702 auth with a real one signed by
                // the EOA; only needed on the first userOp per EOA.
                userOp.eip7702Auth = createAndSignEip7702DelegationAuthorization(
                    BigInt(userOp.eip7702Auth.chainId),
                    userOp.eip7702Auth.address,
                    BigInt(userOp.eip7702Auth.nonce),
                    owner.privateKey,
                );
                if (entry.accountVersion === 'Calibur') {
                    // Calibur wraps as abi.encode(keyHash, sig, hookData);
                    // the default keyHash is bytes32(0) — the EOA's root key.
                    userOp.signature = Account.formatEip712SingleSignatureToUseroperationSignature(
                        signature,
                    );
                } else {
                    // Simple7702 (v8 / v09): raw ECDSA signature, no wrapping.
                    userOp.signature = signature;
                }
            }

            const sent = await account.sendUserOperation(userOp, bundler);
            const receipt = await sent.included();

            expect(receipt).not.toBeNull();
            expect(receipt.success).toBe(true);

            const bal = await sendJsonRpcRequest(node, 'eth_getBalance', [recipient, 'latest']);
            expect(BigInt(bal)).toBe(value);
        },
    );

    if (unrunnable.length > 0) {
        test.skip.each(unrunnable)('$name (setup failed)', () => {});
    }
});
