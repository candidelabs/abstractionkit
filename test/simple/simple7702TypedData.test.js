const { Wallet, computeAddress, recoverAddress, AbiCoder } = require('ethers');
const ak = require('../../dist/index.cjs');
require('dotenv').config();

jest.setTimeout(60000);

const ENTRYPOINT_V8 = "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108";
const ENTRYPOINT_V9 = "0x433709009B8330FDa32311DF1C2AFA402eD8D009";
const ENTRYPOINT_V7 = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";

const chainId = BigInt(process.env.CHAIN_ID ?? "11155111");
// Use a deterministic test key when PRIVATE_KEY1 is unset so unit tests can
// run without a .env. Hash equivalence checks are signature-based, not
// requiring a funded account.
const TEST_PRIVATE_KEY = process.env.PRIVATE_KEY1
    ?? "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const wallet = new Wallet(TEST_PRIVATE_KEY);
const ownerAddress = wallet.address;

// Build a baseline UserOperationV8 with placeholder gas/fee values.
function makeUserOpV8(overrides = {}) {
    return {
        sender: ownerAddress,
        nonce: 7n,
        factory: null,
        factoryData: null,
        callData: "0xb61d27f6"
            + "000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
            + "0000000000000000000000000000000000000000000000000de0b6b3a7640000"
            + "0000000000000000000000000000000000000000000000000000000000000060"
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
            address: "0xe6Cae83BdE06E4c305530e199D7217f42808555B",
            nonce: "0x0",
            yParity: "0x0",
            r: "0x4277ba564d2c138823415df0ec8e8f97f30825056d54ec5128a8b29ec2dd81b2",
            s: "0x1075a1bec7f59848cca899ece93075199cd2aabceb0654b9ae00b881a30044cd",
        },
    };
}

function batchedCallData() {
    // executeBatch((address,uint256,bytes)[])
    const abi = AbiCoder.defaultAbiCoder();
    const encoded = abi.encode(
        ["(address,uint256,bytes)[]"],
        [[
            ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", 1000n, "0xabcd"],
            ["0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", 0n, "0x"],
        ]],
    );
    return "0x34fcd5be" + encoded.slice(2);
}

const PERMUTATIONS = [
    { name: "no paymaster, no eip7702Auth, single call", build: () => makeUserOpV8() },
    { name: "with paymaster, no eip7702Auth", build: () => withPaymaster(makeUserOpV8()) },
    { name: "no paymaster, with eip7702Auth", build: () => withEip7702Auth(makeUserOpV8()) },
    { name: "with paymaster + eip7702Auth", build: () => withPaymaster(withEip7702Auth(makeUserOpV8())) },
    { name: "batched callData, no paymaster", build: () => makeUserOpV8({ callData: batchedCallData() }) },
    { name: "batched callData, with paymaster + eip7702Auth", build: () => withPaymaster(withEip7702Auth(makeUserOpV8({ callData: batchedCallData() }))) },
];

describe('signTypedData / signHash byte-equivalence (v0.8)', () => {
    PERMUTATIONS.forEach(({ name, build }) => {
        test(name, async () => {
            const account = new ak.Simple7702Account(ownerAddress);
            const userOp = build();

            // Path A: raw-hash signing
            const userOpHash = ak.createUserOperationHash(userOp, ENTRYPOINT_V8, chainId);
            const sigA = wallet.signingKey.sign(userOpHash).serialized;

            // Path B: typed-data signing
            const td = account.getUserOperationEip712TypedData(userOp, chainId);
            const sigB = await wallet.signTypedData(td.domain, td.types, td.message);

            expect(sigB).toBe(sigA);
            expect(recoverAddress(userOpHash, sigB).toLowerCase())
                .toBe(ownerAddress.toLowerCase());
        });
    });
});

describe('signTypedData / signHash byte-equivalence (v0.9)', () => {
    PERMUTATIONS.forEach(({ name, build }) => {
        test(name, async () => {
            const account = new ak.Simple7702AccountV09(ownerAddress);
            const userOp = build();

            const userOpHash = ak.createUserOperationHash(userOp, ENTRYPOINT_V9, chainId);
            const sigA = wallet.signingKey.sign(userOpHash).serialized;

            const td = account.getUserOperationEip712TypedData(userOp, chainId);
            const sigB = await wallet.signTypedData(td.domain, td.types, td.message);

            expect(sigB).toBe(sigA);
            expect(recoverAddress(userOpHash, sigB).toLowerCase())
                .toBe(ownerAddress.toLowerCase());
        });
    });

    test('paymaster with magic signature suffix uses stripped form for hashing', async () => {
        const account = new ak.Simple7702AccountV09(ownerAddress);
        // 32 bytes of paymaster-side data, then 2 bytes sigLen=64, 64 bytes
        // signature, then 8 bytes magic = 0x22e325a297439656
        const sigBytes = "11".repeat(64);
        const sigLenHex = "0040";
        const prefix = "ab".repeat(32);
        const magic = "22e325a297439656";
        const userOp = {
            ...makeUserOpV8(),
            paymaster: "0xcccccccccccccccccccccccccccccccccccccccc",
            paymasterVerificationGasLimit: 50000n,
            paymasterPostOpGasLimit: 30000n,
            paymasterData: "0x" + prefix + sigBytes + sigLenHex + magic,
        };

        const userOpHash = ak.createUserOperationHash(userOp, ENTRYPOINT_V9, chainId);
        const sigA = wallet.signingKey.sign(userOpHash).serialized;

        const td = account.getUserOperationEip712TypedData(userOp, chainId);
        const sigB = await wallet.signTypedData(td.domain, td.types, td.message);

        expect(sigB).toBe(sigA);
    });
});

describe('getUserOperationEip712TypedData domain', () => {
    test('v0.8 domain uses entrypoint v0.8 verifyingContract', () => {
        const account = new ak.Simple7702Account(ownerAddress);
        const td = account.getUserOperationEip712TypedData(makeUserOpV8(), chainId);
        expect(td.domain.name).toBe("ERC4337");
        expect(td.domain.version).toBe("1");
        expect(td.domain.chainId).toBe(chainId);
        expect(td.domain.verifyingContract).toBe(ENTRYPOINT_V8);
        expect(td.primaryType).toBe("PackedUserOperation");
    });

    test('v0.9 domain uses entrypoint v0.9 verifyingContract', () => {
        const account = new ak.Simple7702AccountV09(ownerAddress);
        const td = account.getUserOperationEip712TypedData(makeUserOpV8(), chainId);
        expect(td.domain.verifyingContract).toBe(ENTRYPOINT_V9);
    });

    test('throws on v0.7 EntryPoint override', () => {
        const account = new ak.Simple7702Account(ownerAddress, {
            entrypointAddress: ENTRYPOINT_V7,
        });
        expect(() => account.getUserOperationEip712TypedData(makeUserOpV8(), chainId))
            .toThrow(/typed data|EntryPoint v0\.8|v0\.9/i);
    });
});

describe('signUserOperationWithSigner scheme dispatch', () => {
    function makeAccountAndOp() {
        const account = new ak.Simple7702Account(ownerAddress);
        const userOp = makeUserOpV8();
        return { account, userOp };
    }

    test('signer with both schemes prefers typedData', async () => {
        const { account, userOp } = makeAccountAndOp();
        let typedDataCalled = false;
        let hashCalled = false;
        const signer = {
            address: ownerAddress,
            signTypedData: async (td) => {
                typedDataCalled = true;
                return wallet.signTypedData(td.domain, td.types, td.message);
            },
            signHash: async (hash) => {
                hashCalled = true;
                return wallet.signingKey.sign(hash).serialized;
            },
        };
        const sig = await account.signUserOperationWithSigner(userOp, signer, chainId);
        expect(typedDataCalled).toBe(true);
        expect(hashCalled).toBe(false);
        const expected = wallet.signingKey.sign(
            ak.createUserOperationHash(userOp, ENTRYPOINT_V8, chainId),
        ).serialized;
        expect(sig).toBe(expected);
    });

    test('signTypedData-only signer succeeds', async () => {
        const { account, userOp } = makeAccountAndOp();
        const signer = {
            address: ownerAddress,
            signTypedData: async (td) =>
                wallet.signTypedData(td.domain, td.types, td.message),
        };
        const sig = await account.signUserOperationWithSigner(userOp, signer, chainId);
        const expected = wallet.signingKey.sign(
            ak.createUserOperationHash(userOp, ENTRYPOINT_V8, chainId),
        ).serialized;
        expect(sig).toBe(expected);
    });

    test('signHash-only signer falls back to hash scheme', async () => {
        const { account, userOp } = makeAccountAndOp();
        const signer = {
            address: ownerAddress,
            signHash: async (hash) => wallet.signingKey.sign(hash).serialized,
        };
        const sig = await account.signUserOperationWithSigner(userOp, signer, chainId);
        const expected = wallet.signingKey.sign(
            ak.createUserOperationHash(userOp, ENTRYPOINT_V8, chainId),
        ).serialized;
        expect(sig).toBe(expected);
    });

    test('signer with neither method throws', async () => {
        const { account, userOp } = makeAccountAndOp();
        const signer = { address: ownerAddress };
        await expect(
            account.signUserOperationWithSigner(userOp, signer, chainId),
        ).rejects.toThrow(/No compatible signing scheme/);
    });
});
