const { Wallet, recoverAddress, AbiCoder } = require('ethers');
const ak = require('../../dist/index.cjs');

const ENTRYPOINT_V8 = "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108";
const ENTRYPOINT_V9 = "0x433709009B8330FDa32311DF1C2AFA402eD8D009";
const ENTRYPOINT_V7 = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";

const chainId = BigInt(process.env.CHAIN_ID ?? "11155111");
const wallet = Wallet.createRandom();
const ownerAddress = wallet.address;

function makeUserOp(overrides = {}) {
    return {
        sender: ownerAddress,
        nonce: 7n,
        factory: null,
        factoryData: null,
        callData: "0x8dd7712f"
            + "0000000000000000000000000000000000000000000000000000000000000020"
            + "0000000000000000000000000000000000000000000000000000000000000040"
            + "0000000000000000000000000000000000000000000000000000000000000001"
            + "0000000000000000000000000000000000000000000000000000000000000000",
        callGasLimit: 100000n,
        verificationGasLimit: 200000n,
        preVerificationGas: 50000n,
        maxFeePerGas: 1500000000n,
        maxPriorityFeePerGas: 100000000n,
        paymaster: null,
        paymasterVerificationGasLimit: null,
        paymasterPostOpGasLimit: null,
        paymasterData: null,
        signature: "0x" + "00".repeat(65),
        eip7702Auth: null,
        ...overrides,
    };
}

function withPaymaster(op) {
    return {
        ...op,
        paymaster: "0xcccccccccccccccccccccccccccccccccccccccc",
        paymasterVerificationGasLimit: 50000n,
        paymasterPostOpGasLimit: 30000n,
        paymasterData: "0xdeadbeef",
    };
}

function withEip7702Auth(op) {
    return {
        ...op,
        factory: "0x7702",
        factoryData: null,
        eip7702Auth: {
            chainId: "0x1",
            address: "0x000000009B1D0aF20D8C6d0A44e162d11F9b8f00",
            nonce: "0x0",
            yParity: "0x0",
            r: "0x4277ba564d2c138823415df0ec8e8f97f30825056d54ec5128a8b29ec2dd81b2",
            s: "0x1075a1bec7f59848cca899ece93075199cd2aabceb0654b9ae00b881a30044cd",
        },
    };
}

const PERMUTATIONS = [
    { name: "no paymaster, no eip7702Auth", build: () => makeUserOp() },
    { name: "with paymaster", build: () => withPaymaster(makeUserOp()) },
    { name: "with eip7702Auth", build: () => withEip7702Auth(makeUserOp()) },
    { name: "with paymaster + eip7702Auth", build: () => withPaymaster(withEip7702Auth(makeUserOp())) },
];

describe('Calibur7702Account.getUserOperationEip712Hash (v0.8)', () => {
    PERMUTATIONS.forEach(({ name, build }) => {
        test(`hash equals userOpHash — ${name}`, () => {
            const account = new ak.Calibur7702Account(ownerAddress);
            const userOp = build();
            const eip712Hash = ak.Calibur7702Account.getUserOperationEip712Hash(userOp, chainId);
            const userOpHash = ak.createUserOperationHash(userOp, ENTRYPOINT_V8, chainId);
            expect(eip712Hash).toBe(userOpHash);
            expect(eip712Hash).toBe(account.getUserOperationHash(userOp, chainId));
        });
    });
});

describe('Calibur7702Account.getUserOperationEip712Hash (v0.9)', () => {
    PERMUTATIONS.forEach(({ name, build }) => {
        test(`hash equals userOpHash — ${name}`, () => {
            const eip712Hash = ak.Calibur7702Account.getUserOperationEip712Hash(build(), chainId, {
                entrypointAddress: ENTRYPOINT_V9,
            });
            const userOpHash = ak.createUserOperationHash(build(), ENTRYPOINT_V9, chainId);
            expect(eip712Hash).toBe(userOpHash);
        });
    });
});

describe('Calibur7702Account.getUserOperationEip712Data', () => {
    test('v0.8 domain matches EntryPoint v0.8 (default)', () => {
        const td = ak.Calibur7702Account.getUserOperationEip712Data(makeUserOp(), chainId);
        expect(td.domain.name).toBe("ERC4337");
        expect(td.domain.version).toBe("1");
        expect(td.domain.chainId).toBe(chainId);
        expect(td.domain.verifyingContract).toBe(ENTRYPOINT_V8);
        expect(td.primaryType).toBe("PackedUserOperation");
    });

    test('v0.9 domain matches EntryPoint v0.9 (override)', () => {
        const td = ak.Calibur7702Account.getUserOperationEip712Data(makeUserOp(), chainId, {
            entrypointAddress: ENTRYPOINT_V9,
        });
        expect(td.domain.verifyingContract).toBe(ENTRYPOINT_V9);
    });

    test('throws on v0.7 EntryPoint override', () => {
        expect(() =>
            ak.Calibur7702Account.getUserOperationEip712Data(makeUserOp(), chainId, {
                entrypointAddress: ENTRYPOINT_V7,
            }),
        ).toThrow(/EntryPoint v0\.8|v0\.9/i);
    });
});

// Regression for the executor-calldata decode in
// prependTokenPaymasterApproveToCallDataStatic. Before the fix, the inner
// `data` bytes of each BatchedCall were UTF-8-decoded (TextDecoder, then
// fromUtf8Bytes), which corrupted any byte >= 0x80. The fix hex-encodes
// instead. Randomized so the test covers a broad set of binary payloads
// rather than a single hand-crafted vector.
describe('Calibur prependTokenPaymasterApproveToCallDataStatic round-trip', () => {
    const coder = AbiCoder.defaultAbiCoder();
    const EXECUTE_USER_OP_SELECTOR = '0x8dd7712f';
    const TOKEN = '0x' + '11'.repeat(20);
    const PAYMASTER = '0x' + '22'.repeat(20);

    // Seeded PRNG so failures are reproducible; mirrors the style used in
    // test/ethereUtils.test.js. Mulberry32 — fine for property tests.
    let _seed = 0x9e3779b1 >>> 0;
    const resetRng = (s = 0x9e3779b1) => { _seed = s >>> 0; };
    const randInt = (maxExclusive) => {
        _seed = (_seed + 0x6d2b79f5) >>> 0;
        let t = _seed;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) % maxExclusive;
    };
    const randomBytes = (n) => {
        const out = new Uint8Array(n);
        for (let i = 0; i < n; i++) out[i] = randInt(256);
        return out;
    };
    const randomAddress = () =>
        '0x' + Array.from(randomBytes(20), (b) => b.toString(16).padStart(2, '0')).join('');
    const randomHex = (n) =>
        '0x' + Array.from(randomBytes(n), (b) => b.toString(16).padStart(2, '0')).join('');

    function buildExecuteUserOpCalldata(calls, revertOnFailure) {
        const encoded = coder.encode(
            ['tuple(tuple(address to, uint256 value, bytes data)[] calls, bool revertOnFailure)'],
            [{ calls, revertOnFailure }],
        );
        return EXECUTE_USER_OP_SELECTOR + encoded.slice(2);
    }

    function decodeBatchedCallFromCalldata(callData) {
        const body = '0x' + callData.slice(10);
        const [decoded] = coder.decode(
            ['tuple(tuple(address to, uint256 value, bytes data)[] calls, bool revertOnFailure)'],
            body,
        );
        return { calls: decoded[0], revertOnFailure: decoded[1] };
    }

    const ITER = 25;
    test(`property: ${ITER} random batches preserve binary data bytes through prepend`, () => {
        resetRng();
        for (let iter = 0; iter < ITER; iter++) {
            // Build N random calls with random binary data payloads — sizes
            // chosen so we hit empty, sub-32-byte, 32-byte aligned, and
            // ragged (>32 with trailing partial word) shapes within the run.
            const n = 1 + randInt(4);
            const originals = [];
            for (let i = 0; i < n; i++) {
                const dataLen = randInt(80); // 0..79 bytes
                originals.push({
                    to: randomAddress(),
                    value: BigInt(randInt(1_000_000)),
                    data: randomHex(dataLen),
                });
            }

            const revertOnFailure = randInt(2) === 1;
            const calldata = buildExecuteUserOpCalldata(
                originals.map((c) => [c.to, c.value, c.data]),
                revertOnFailure,
            );

            const approveAmount = BigInt(randInt(1_000_000_000));
            const out = ak.Calibur7702Account.prependTokenPaymasterApproveToCallDataStatic(
                calldata,
                TOKEN,
                PAYMASTER,
                approveAmount,
            );

            const { calls: outCalls, revertOnFailure: outRevert } =
                decodeBatchedCallFromCalldata(out);

            // First call is the prepended approve(token, paymaster, amount).
            expect(outCalls.length).toBe(originals.length + 1);
            expect(outCalls[0][0].toLowerCase()).toBe(TOKEN.toLowerCase());
            expect(outCalls[0][1]).toBe(0n);
            expect(outRevert).toBe(revertOnFailure);

            // The N original calls are preserved at indices 1..n with binary
            // data round-tripping bit-for-bit. This is what the bug broke:
            // bytes >= 0x80 used to be UTF-8-decoded into multi-byte garbage.
            for (let i = 0; i < originals.length; i++) {
                const orig = originals[i];
                const got = outCalls[i + 1];
                expect(got[0].toLowerCase()).toBe(orig.to.toLowerCase());
                expect(got[1]).toBe(orig.value);
                expect(got[2].toLowerCase()).toBe(orig.data.toLowerCase());
            }
        }
    });

    // Explicit single-vector test pinning the exact byte ≥ 0x80 case that
    // demonstrates the bug — keeps the regression obvious even if the
    // randomized run happens to miss it on a future RNG change.
    test('preserves a call whose data is all bytes >= 0x80 (the explicit bug case)', () => {
        const trickyData = '0x' + Array.from({ length: 32 }, (_, i) => (0x80 + i).toString(16).padStart(2, '0')).join('');
        const calldata = buildExecuteUserOpCalldata(
            [['0x' + '33'.repeat(20), 0n, trickyData]],
            false,
        );

        const out = ak.Calibur7702Account.prependTokenPaymasterApproveToCallDataStatic(
            calldata, TOKEN, PAYMASTER, 1n,
        );
        const { calls } = decodeBatchedCallFromCalldata(out);
        expect(calls[1][2].toLowerCase()).toBe(trickyData.toLowerCase());
    });
});

describe('Calibur signTypedData / signHash byte-equivalence (root key)', () => {
    PERMUTATIONS.forEach(({ name, build }) => {
        test(`v0.8 — ${name}`, async () => {
            const userOp = build();

            // Path A: raw-hash signing (the existing Calibur path)
            const userOpHash = ak.createUserOperationHash(userOp, ENTRYPOINT_V8, chainId);
            const sigA = wallet.signingKey.sign(userOpHash).serialized;

            // Path B: typed-data signing
            const td = ak.Calibur7702Account.getUserOperationEip712Data(userOp, chainId);
            const sigB = await wallet.signTypedData(td.domain, td.types, td.message);

            // For deterministic ECDSA (ethers), both signatures are byte-identical.
            expect(sigB).toBe(sigA);
            expect(recoverAddress(userOpHash, sigB).toLowerCase())
                .toBe(ownerAddress.toLowerCase());
        });
    });
});
