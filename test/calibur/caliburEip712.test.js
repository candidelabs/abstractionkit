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
            const eip712Hash = account.getUserOperationEip712Hash(userOp, chainId);
            const userOpHash = ak.createUserOperationHash(userOp, ENTRYPOINT_V8, chainId);
            expect(eip712Hash).toBe(userOpHash);
            expect(eip712Hash).toBe(account.getUserOperationHash(userOp, chainId));
        });
    });
});

describe('Calibur7702Account.getUserOperationEip712Hash (v0.9)', () => {
    PERMUTATIONS.forEach(({ name, build }) => {
        test(`hash equals userOpHash — ${name}`, () => {
            const account = new ak.Calibur7702Account(ownerAddress, {
                entrypointAddress: ENTRYPOINT_V9,
                delegateeAddress: ak.CALIBUR_CANDIDE_V0_1_0_SINGLETON_ADDRESS,
            });
            const userOp = build();
            const eip712Hash = account.getUserOperationEip712Hash(userOp, chainId);
            const userOpHash = ak.createUserOperationHash(userOp, ENTRYPOINT_V9, chainId);
            expect(eip712Hash).toBe(userOpHash);
        });
    });
});

describe('Calibur7702Account.getUserOperationEip712Data', () => {
    test('v0.8 domain matches EntryPoint v0.8', () => {
        const account = new ak.Calibur7702Account(ownerAddress);
        const td = account.getUserOperationEip712Data(makeUserOp(), chainId);
        expect(td.domain.name).toBe("ERC4337");
        expect(td.domain.version).toBe("1");
        expect(td.domain.chainId).toBe(chainId);
        expect(td.domain.verifyingContract).toBe(ENTRYPOINT_V8);
        expect(td.primaryType).toBe("PackedUserOperation");
    });

    test('v0.9 domain matches EntryPoint v0.9', () => {
        const account = new ak.Calibur7702Account(ownerAddress, {
            entrypointAddress: ENTRYPOINT_V9,
            delegateeAddress: ak.CALIBUR_CANDIDE_V0_1_0_SINGLETON_ADDRESS,
        });
        const td = account.getUserOperationEip712Data(makeUserOp(), chainId);
        expect(td.domain.verifyingContract).toBe(ENTRYPOINT_V9);
    });

    test('throws on v0.7 EntryPoint override', () => {
        const account = new ak.Calibur7702Account(ownerAddress, {
            entrypointAddress: ENTRYPOINT_V7,
        });
        expect(() => account.getUserOperationEip712Data(makeUserOp(), chainId))
            .toThrow(/EntryPoint v0\.8|v0\.9/i);
    });
});

describe('Calibur signTypedData / signHash byte-equivalence (root key)', () => {
    PERMUTATIONS.forEach(({ name, build }) => {
        test(`v0.8 — ${name}`, async () => {
            const account = new ak.Calibur7702Account(ownerAddress);
            const userOp = build();

            // Path A: raw-hash signing (the existing Calibur path)
            const userOpHash = ak.createUserOperationHash(userOp, ENTRYPOINT_V8, chainId);
            const sigA = wallet.signingKey.sign(userOpHash).serialized;

            // Path B: typed-data signing
            const td = account.getUserOperationEip712Data(userOp, chainId);
            const sigB = await wallet.signTypedData(td.domain, td.types, td.message);

            // For deterministic ECDSA (ethers), both signatures are byte-identical.
            expect(sigB).toBe(sigA);
            expect(recoverAddress(userOpHash, sigB).toLowerCase())
                .toBe(ownerAddress.toLowerCase());
        });
    });
});
