// Unit tests for the Signer-interface design. All tests are offline.
//
// Public API:
//   Safe accounts (multi-signer):    signUserOperationWithSigners(op, signers[], chainId)
//   Simple7702 / Calibur (single):   signUserOperationWithSigner(op, signer, chainId)
//
// Equivalence strategy: each test compares the new method's output to a
// signature computed via the legacy sync path or via ethers primitives.

const ak = require('../../dist/index.cjs');
const { Wallet, SigningKey, computeAddress, getBytes } = require('ethers');

const PK1 = '0x' + '11'.repeat(32);
const PK2 = '0x' + '22'.repeat(32);
const CHAIN_ID = 11155111n;

// ─── Fixtures ────────────────────────────────────────────────────────────

function buildSafeV3Op(safe) {
    return {
        sender: safe.accountAddress, nonce: 0n,
        factory: safe.factoryAddress, factoryData: safe.factoryData,
        callData: '0x', callGasLimit: 100000n, verificationGasLimit: 500000n,
        preVerificationGas: 60000n, maxFeePerGas: 10000000n, maxPriorityFeePerGas: 1000000n,
        paymaster: null, paymasterVerificationGasLimit: null, paymasterPostOpGasLimit: null,
        paymasterData: null, signature: '0x',
    };
}

function buildSafeV2Op(safe) {
    return {
        sender: safe.accountAddress, nonce: 0n,
        initCode: safe.factoryAddress + safe.factoryData.slice(2),
        callData: '0x', callGasLimit: 100000n, verificationGasLimit: 500000n,
        preVerificationGas: 60000n, maxFeePerGas: 10000000n, maxPriorityFeePerGas: 1000000n,
        paymasterAndData: '0x', signature: '0x',
    };
}

function buildSafeMultiChainOp(safe) {
    return {
        sender: safe.accountAddress, nonce: 0n,
        factory: safe.factoryAddress, factoryData: safe.factoryData,
        callData: '0x', callGasLimit: 100000n, verificationGasLimit: 500000n,
        preVerificationGas: 60000n, maxFeePerGas: 10000000n, maxPriorityFeePerGas: 1000000n,
        paymaster: null, paymasterVerificationGasLimit: null, paymasterPostOpGasLimit: null,
        paymasterData: null, signature: '0x', eip7702Auth: null,
    };
}

function buildSimpleOp(owner) {
    return {
        sender: owner, nonce: 0n, factory: null, factoryData: null,
        callData: '0x', callGasLimit: 100000n, verificationGasLimit: 100000n,
        preVerificationGas: 50000n, maxFeePerGas: 10000000n, maxPriorityFeePerGas: 1000000n,
        paymaster: null, paymasterVerificationGasLimit: null, paymasterPostOpGasLimit: null,
        paymasterData: null, signature: '0x', eip7702Auth: null,
    };
}

// ─── Adapter tests ───────────────────────────────────────────────────────

describe('fromPrivateKey adapter', () => {
    test('produces a Signer with both signHash and signTypedData', () => {
        const signer = ak.fromPrivateKey(PK1);
        expect(signer.address).toBe(computeAddress(PK1));
        expect(typeof signer.signHash).toBe('function');
        expect(typeof signer.signTypedData).toBe('function');
    });

    test('signHash produces same bytes as ethers signingKey.sign', async () => {
        const signer = ak.fromPrivateKey(PK1);
        const wallet = new Wallet(PK1);
        const hash = '0x' + 'ab'.repeat(32);
        const sigA = await signer.signHash(hash);
        const sigB = wallet.signingKey.sign(hash).serialized;
        expect(sigA).toBe(sigB);
    });
});

describe('fromEthersWallet adapter', () => {
    test('wraps an ethers Wallet and passes through to signingKey.sign', async () => {
        const wallet = new Wallet(PK1);
        const signer = ak.fromEthersWallet(wallet);
        const hash = '0x' + 'cd'.repeat(32);
        expect(await signer.signHash(hash))
            .toBe(wallet.signingKey.sign(hash).serialized);
    });
});

// ─── SignContext delivery ────────────────────────────────────────────────

describe('SignContext is forwarded to signers', () => {
    const owner = computeAddress(PK1);

    test('single-op accounts pass { userOperation, chainId, entryPoint }', async () => {
        const safe = ak.SafeAccountV0_3_0.initializeNewAccount([owner]);
        const op = buildSafeV3Op(safe);
        const wallet = new Wallet(PK1);
        let captured = null;
        const inspecting = {
            address: wallet.address,
            signHash: async (h, ctx) => {
                captured = ctx;
                return wallet.signingKey.sign(h).serialized;
            },
        };
        await safe.signUserOperationWithSigners(op, [inspecting], CHAIN_ID);
        expect(captured).not.toBeNull();
        expect('userOperation' in captured).toBe(true);
        expect(captured.userOperation.sender).toBe(op.sender);
        expect(captured.chainId).toBe(CHAIN_ID);
        expect(captured.entryPoint).toBe(safe.entrypointAddress);
    });

    test('Simple7702 / Calibur forward the same single-op shape', async () => {
        const wallet = new Wallet(PK1);

        // Simple7702
        const simple = new ak.Simple7702Account(owner);
        const simpleOp = buildSimpleOp(owner);
        let simpleCtx = null;
        await simple.signUserOperationWithSigner(simpleOp, {
            address: wallet.address,
            signHash: async (h, ctx) => {
                simpleCtx = ctx;
                return wallet.signingKey.sign(h).serialized;
            },
        }, CHAIN_ID);
        expect('userOperation' in simpleCtx).toBe(true);
        expect(simpleCtx.userOperation.nonce).toBe(simpleOp.nonce);
        expect(simpleCtx.chainId).toBe(CHAIN_ID);
        expect(simpleCtx.entryPoint).toBe(simple.entrypointAddress);

        // Calibur
        const calibur = new ak.Calibur7702Account(owner);
        const caliburOp = buildSimpleOp(owner);
        let caliburCtx = null;
        await calibur.signUserOperationWithSigner(caliburOp, {
            address: wallet.address,
            signHash: async (h, ctx) => {
                caliburCtx = ctx;
                return wallet.signingKey.sign(h).serialized;
            },
        }, CHAIN_ID);
        expect('userOperation' in caliburCtx).toBe(true);
        expect(caliburCtx.userOperation.nonce).toBe(caliburOp.nonce);
        expect(caliburCtx.chainId).toBe(CHAIN_ID);
        expect(caliburCtx.entryPoint).toBe(calibur.entrypointAddress);
    });

    test('multi-op Merkle path passes { userOperations[], entryPoint }', async () => {
        const safe = ak.SafeMultiChainSigAccountV1.initializeNewAccount([owner]);
        const op = buildSafeMultiChainOp(safe);
        const op2 = { ...op, nonce: 1n };
        const wallet = new Wallet(PK1);
        let captured = null;
        await safe.signUserOperationsWithSigners(
            [
                { userOperation: op, chainId: 1n, validAfter: 0n, validUntil: 0n },
                { userOperation: op2, chainId: 10n, validAfter: 0n, validUntil: 0n },
            ],
            [{
                address: wallet.address,
                signHash: async (h, ctx) => {
                    captured = ctx;
                    return wallet.signingKey.sign(h).serialized;
                },
            }],
        );
        expect('userOperations' in captured).toBe(true);
        expect(captured.userOperations).toHaveLength(2);
        expect(captured.userOperations[0].chainId).toBe(1n);
        expect(captured.userOperations[1].chainId).toBe(10n);
        expect(captured.userOperations[1].userOperation.nonce).toBe(1n);
        expect(captured.entryPoint).toBe(safe.entrypointAddress);
    });

    test('signUserOperationsWithSigners with length=1 still passes multi-op context', async () => {
        // Regression: previously the length=1 path delegated to the single-op
        // method which built single-op context, so a multi-op-typed signer
        // would see `userOperations` undefined at runtime. Now the plural
        // method always passes multi-op context regardless of bundle length.
        const safe = ak.SafeMultiChainSigAccountV1.initializeNewAccount([owner]);
        const op = buildSafeMultiChainOp(safe);
        const wallet = new Wallet(PK1);
        let captured = null;
        await safe.signUserOperationsWithSigners(
            [{ userOperation: op, chainId: CHAIN_ID, validAfter: 0n, validUntil: 0n }],
            [{
                address: wallet.address,
                signHash: async (h, ctx) => {
                    captured = ctx;
                    return wallet.signingKey.sign(h).serialized;
                },
            }],
        );
        expect('userOperations' in captured).toBe(true);
        expect(captured.userOperations).toHaveLength(1);
        expect(captured.userOperations[0].chainId).toBe(CHAIN_ID);
        expect(captured.userOperations[0].userOperation.sender).toBe(op.sender);
        expect('userOperation' in captured).toBe(false);
    });

    test('signTypedData receives the same context shape', async () => {
        const safe = ak.SafeAccountV0_3_0.initializeNewAccount([owner]);
        const op = buildSafeV3Op(safe);
        const wallet = new Wallet(PK1);
        let captured = null;
        await safe.signUserOperationWithSigners(op, [{
            address: wallet.address,
            signTypedData: async (td, ctx) => {
                captured = ctx;
                return wallet.signTypedData(td.domain, td.types, td.message);
            },
        }], CHAIN_ID);
        expect('userOperation' in captured).toBe(true);
        expect(captured.chainId).toBe(CHAIN_ID);
    });
});

// ─── Safe accounts (multi-signer, plural method name) ───────────────────

describe('SafeAccountV0_3_0 signUserOperationWithSigners', () => {
    const owner = computeAddress(PK1);
    const safe = ak.SafeAccountV0_3_0.initializeNewAccount([owner]);
    const op = buildSafeV3Op(safe);

    test('with fromPrivateKey matches legacy sync signUserOperation', async () => {
        const pkSig = safe.signUserOperation(op, [PK1], CHAIN_ID);
        const signerSig = await safe.signUserOperationWithSigners(
            op, [ak.fromPrivateKey(PK1)], CHAIN_ID,
        );
        expect(signerSig).toBe(pkSig);
    });

    test('sorts multi-signer by address regardless of input order', async () => {
        const owner2 = computeAddress(PK2);
        const multi = ak.SafeAccountV0_3_0.initializeNewAccount([owner, owner2]);
        const mop = buildSafeV3Op(multi);
        const expected = multi.signUserOperation(mop, [PK1, PK2], CHAIN_ID);
        const forward = await multi.signUserOperationWithSigners(
            mop, [ak.fromPrivateKey(PK1), ak.fromPrivateKey(PK2)], CHAIN_ID,
        );
        const reverse = await multi.signUserOperationWithSigners(
            mop, [ak.fromPrivateKey(PK2), ak.fromPrivateKey(PK1)], CHAIN_ID,
        );
        expect(forward).toBe(expected);
        expect(reverse).toBe(expected);
    });

    test('custom hash-only Signer matches PK path', async () => {
        const wallet = new Wallet(PK1);
        const custom = {
            address: wallet.address,
            signHash: async (h) => wallet.signingKey.sign(h).serialized,
        };
        const pkSig = safe.signUserOperation(op, [PK1], CHAIN_ID);
        const customSig = await safe.signUserOperationWithSigners(op, [custom], CHAIN_ID);
        expect(customSig).toBe(pkSig);
    });

    test('signTypedData-only Signer works (typedData scheme)', async () => {
        const wallet = new Wallet(PK1);
        const tdOnly = {
            address: wallet.address,
            signTypedData: async (td) =>
                wallet.signTypedData(td.domain, td.types, td.message),
        };
        const pkSig = safe.signUserOperation(op, [PK1], CHAIN_ID);
        const tdSig = await safe.signUserOperationWithSigners(op, [tdOnly], CHAIN_ID);
        expect(tdSig).toBe(pkSig);
    });

    test('throws with actionable message on capability mismatch', async () => {
        const empty = { address: '0x' + '0'.repeat(40) };
        await expect(
            safe.signUserOperationWithSigners(op, [empty], CHAIN_ID),
        ).rejects.toThrow(
            /No compatible signing scheme.*Signer must implement at least one of/s,
        );
    });

    test('does NOT accept raw private-key strings (type-level only)', async () => {
        // At runtime the call still throws a meaningful error — strings lack
        // the required .address / sign methods. Type system enforces Signer-
        // only arguments; this test documents the runtime fallback.
        await expect(
            safe.signUserOperationWithSigners(op, [PK1], CHAIN_ID),
        ).rejects.toThrow();
    });
});

describe('SafeAccountV0_2_0 signUserOperationWithSigners', () => {
    const owner = computeAddress(PK1);
    const safe = ak.SafeAccountV0_2_0.initializeNewAccount([owner]);
    const op = buildSafeV2Op(safe);

    test('matches legacy sync signUserOperation', async () => {
        const pkSig = safe.signUserOperation(op, [PK1], CHAIN_ID);
        const signerSig = await safe.signUserOperationWithSigners(
            op, [ak.fromPrivateKey(PK1)], CHAIN_ID,
        );
        expect(signerSig).toBe(pkSig);
    });
});

describe('SafeMultiChainSigAccountV1 signUserOperationWithSigners', () => {
    const owner = computeAddress(PK1);
    const safe = ak.SafeMultiChainSigAccountV1.initializeNewAccount([owner]);
    const op = buildSafeMultiChainOp(safe);

    test('single-op: matches legacy sync path with isMultiChainSignature set', async () => {
        const pkSig = safe.signUserOperation(op, [PK1], CHAIN_ID);
        const signerSig = await safe.signUserOperationWithSigners(
            op, [ak.fromPrivateKey(PK1)], CHAIN_ID,
        );
        expect(signerSig).toBe(pkSig);
    });

    test('signUserOperationsWithSigners with single op delegates correctly', async () => {
        const [sig] = await safe.signUserOperationsWithSigners(
            [{ userOperation: op, chainId: CHAIN_ID, validAfter: 0n, validUntil: 0n }],
            [ak.fromPrivateKey(PK1)],
        );
        const ref = safe.signUserOperation(op, [PK1], CHAIN_ID);
        expect(sig).toBe(ref);
    });

    test('signUserOperationsWithSigners with multi ops emits distinct signatures', async () => {
        const op2 = { ...op, nonce: 1n };
        const [s1, s2] = await safe.signUserOperationsWithSigners(
            [
                { userOperation: op, chainId: 1n, validAfter: 0n, validUntil: 0n },
                { userOperation: op2, chainId: 10n, validAfter: 0n, validUntil: 0n },
            ],
            [ak.fromPrivateKey(PK1)],
        );
        expect(s1).toMatch(/^0x/);
        expect(s2).toMatch(/^0x/);
        expect(s1).not.toBe(s2);
    });

    test('signUserOperationsWithSigners matches legacy signUserOperations for multi', async () => {
        const op2 = { ...op, nonce: 1n };
        const opsToSign = [
            { userOperation: op, chainId: 1n, validAfter: 0n, validUntil: 0n },
            { userOperation: op2, chainId: 10n, validAfter: 0n, validUntil: 0n },
        ];
        const legacySigs = safe.signUserOperations(opsToSign, [PK1]);
        const newSigs = await safe.signUserOperationsWithSigners(
            opsToSign, [ak.fromPrivateKey(PK1)],
        );
        expect(newSigs).toEqual(legacySigs);
    });
});

// ─── Single-signer accounts (singular method name) ──────────────────────

describe('Simple7702Account signUserOperationWithSigner', () => {
    const owner = computeAddress(PK1);
    const simple = new ak.Simple7702Account(owner);
    const op = buildSimpleOp(owner);

    test('matches legacy sync signUserOperation(pk)', async () => {
        const pkSig = simple.signUserOperation(op, PK1, CHAIN_ID);
        const signerSig = await simple.signUserOperationWithSigner(
            op, ak.fromPrivateKey(PK1), CHAIN_ID,
        );
        expect(signerSig).toBe(pkSig);
    });

    test('fromViem-shaped signer via fromEthersWallet matches PK path', async () => {
        const wallet = new Wallet(PK1);
        const pkSig = simple.signUserOperation(op, PK1, CHAIN_ID);
        const signerSig = await simple.signUserOperationWithSigner(
            op, ak.fromEthersWallet(wallet), CHAIN_ID,
        );
        expect(signerSig).toBe(pkSig);
    });

    test('rejects signTypedData-only signer with actionable error', async () => {
        const tdOnly = {
            address: owner,
            signTypedData: async () => '0x',
        };
        await expect(
            simple.signUserOperationWithSigner(op, tdOnly, CHAIN_ID),
        ).rejects.toThrow(/accepts: \[hash\]; signer provides: \[typedData\]/);
    });
});

describe('Simple7702AccountV09 signUserOperationWithSigner', () => {
    const owner = computeAddress(PK1);
    const simple = new ak.Simple7702AccountV09(owner);
    const op = buildSimpleOp(owner);

    test('matches legacy sync signUserOperation(pk)', async () => {
        const pkSig = simple.signUserOperation(op, PK1, CHAIN_ID);
        const signerSig = await simple.signUserOperationWithSigner(
            op, ak.fromPrivateKey(PK1), CHAIN_ID,
        );
        expect(signerSig).toBe(pkSig);
    });
});

describe('Calibur7702Account signUserOperationWithSigner', () => {
    const owner = computeAddress(PK1);
    const calibur = new ak.Calibur7702Account(owner);
    const op = buildSimpleOp(owner);

    test('matches legacy sync signUserOperation(pk)', async () => {
        const pkSig = calibur.signUserOperation(op, PK1, CHAIN_ID);
        const signerSig = await calibur.signUserOperationWithSigner(
            op, ak.fromPrivateKey(PK1), CHAIN_ID,
        );
        expect(signerSig).toBe(pkSig);
    });

    test('keyHash override flows through to wrapped signature', async () => {
        const keyHash = '0x' + 'ee'.repeat(32);
        const pkSig = calibur.signUserOperation(op, PK1, CHAIN_ID, { keyHash });
        const signerSig = await calibur.signUserOperationWithSigner(
            op, ak.fromPrivateKey(PK1), CHAIN_ID, { keyHash },
        );
        expect(signerSig).toBe(pkSig);
    });

    test('rejects signTypedData-only signer', async () => {
        const tdOnly = {
            address: owner,
            signTypedData: async () => '0x',
        };
        await expect(
            calibur.signUserOperationWithSigner(op, tdOnly, CHAIN_ID),
        ).rejects.toThrow(/accepts: \[hash,\s*webauthn\].*signer provides: \[typedData\]/);
    });
});

// ─── Uint8Array / HSM / secure-dispose ──────────────────────────────────

describe('Uint8Array-only / secure-dispose signers', () => {
    function fromPrivateKeyBytes(pkBytes) {
        if (!(pkBytes instanceof Uint8Array) || pkBytes.length !== 32) {
            throw new Error('expected 32-byte Uint8Array');
        }
        const signingKey = new SigningKey(pkBytes);
        const address = computeAddress(signingKey.publicKey);
        let disposed = false;
        return {
            address,
            signHash: async (hash) => {
                if (disposed) throw new Error('signer disposed');
                return signingKey.sign(hash).serialized;
            },
            dispose() {
                pkBytes.fill(0);
                disposed = true;
            },
        };
    }

    test('Uint8Array-held Signer produces same signature as legacy PK path', async () => {
        const hexPk = '0x' + '33'.repeat(32);
        const bytes = getBytes(hexPk);
        const signer = fromPrivateKeyBytes(bytes);
        const safe = ak.SafeAccountV0_3_0.initializeNewAccount([signer.address]);
        const op = buildSafeV3Op(safe);

        const pkSig = safe.signUserOperation(op, [hexPk], CHAIN_ID);
        const signerSig = await safe.signUserOperationWithSigners(op, [signer], CHAIN_ID);
        expect(signerSig).toBe(pkSig);
    });

    test('dispose() zeros the buffer and blocks subsequent signing', async () => {
        const hexPk = '0x' + '44'.repeat(32);
        const bytes = getBytes(hexPk);
        const signer = fromPrivateKeyBytes(bytes);

        const safe = ak.SafeAccountV0_3_0.initializeNewAccount([signer.address]);
        const op = buildSafeV3Op(safe);
        await expect(safe.signUserOperationWithSigners(op, [signer], CHAIN_ID))
            .resolves.toMatch(/^0x/);
        expect(Array.from(bytes).some((b) => b !== 0)).toBe(true);
        signer.dispose();
        expect(Array.from(bytes).every((b) => b === 0)).toBe(true);
        await expect(safe.signUserOperationWithSigners(op, [signer], CHAIN_ID))
            .rejects.toThrow(/signer disposed/);
    });

    test('works on Simple7702 / Calibur (hash-only accounts)', async () => {
        const hexPk = '0x' + '55'.repeat(32);
        const bytes = getBytes(hexPk);
        const signer = fromPrivateKeyBytes(bytes);
        const owner = signer.address;

        const simple = new ak.Simple7702Account(owner);
        const calibur = new ak.Calibur7702Account(owner);
        const op = buildSimpleOp(owner);

        const simplePk = simple.signUserOperation(op, hexPk, CHAIN_ID);
        expect(await simple.signUserOperationWithSigner(op, signer, CHAIN_ID)).toBe(simplePk);

        const caliburPk = calibur.signUserOperation(op, hexPk, CHAIN_ID);
        expect(await calibur.signUserOperationWithSigner(op, signer, CHAIN_ID)).toBe(caliburPk);
    });

    test('async HSM-style signer (no key material in memory)', async () => {
        const hexPk = '0x' + '66'.repeat(32);
        const refWallet = new Wallet(hexPk);
        let hsmCallCount = 0;
        const hsmSigner = {
            address: refWallet.address,
            signHash: async (hash) => {
                hsmCallCount++;
                return refWallet.signingKey.sign(hash).serialized;
            },
        };

        const safe = ak.SafeAccountV0_3_0.initializeNewAccount([refWallet.address]);
        const op = buildSafeV3Op(safe);
        const pkSig = safe.signUserOperation(op, [hexPk], CHAIN_ID);
        expect(await safe.signUserOperationWithSigners(op, [hsmSigner], CHAIN_ID)).toBe(pkSig);
        expect(hsmCallCount).toBe(1);
    });

    test('using-pattern helper guarantees dispose even on error', async () => {
        async function withSecureSigner(pkBytes, fn) {
            const signer = fromPrivateKeyBytes(pkBytes);
            try { return await fn(signer); }
            finally { signer.dispose(); }
        }

        const hexPk = '0x' + '77'.repeat(32);
        const bytes = getBytes(hexPk);

        const result = await withSecureSigner(bytes, async (signer) => {
            const safe = ak.SafeAccountV0_3_0.initializeNewAccount([signer.address]);
            return safe.signUserOperationWithSigners(buildSafeV3Op(safe), [signer], CHAIN_ID);
        });
        expect(result).toMatch(/^0x/);
        expect(Array.from(bytes).every((b) => b === 0)).toBe(true);

        const bytes2 = getBytes('0x' + '88'.repeat(32));
        await expect(withSecureSigner(bytes2, async () => {
            throw new Error('something went wrong');
        })).rejects.toThrow(/something went wrong/);
        expect(Array.from(bytes2).every((b) => b === 0)).toBe(true);
    });
});
