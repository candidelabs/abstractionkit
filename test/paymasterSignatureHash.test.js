// Regression tests: how an EntryPoint v0.9 `paymasterData` that ends with the
// PAYMASTER_SIG_MAGIC is hashed.
//
// The layout is `prefix ‖ signature ‖ uint16(signature length) ‖ MAGIC`, and
// the hash commits to `prefix ‖ MAGIC`. The SDK stripped whenever the data
// ended with the magic, whatever the length field said: a zero length was
// stripped (the EntryPoint hashes that data as is) and a length larger than
// the data silently produced a hash (the EntryPoint reverts).
//
// The expected hashes are EntryPoint v0.9 `getUserOpHash` results read from
// Ethereum mainnet (chain id 1) for the operation below. Offline.

const ak = require('../dist/index.cjs');

const MAGIC = '22e325a297439656';
const BASE = {
    sender: '0x1f9090aaE28b8a3dCeaDf281B0F12828e676c326',
    nonce: 7n,
    callData: '0xb61d27f6deadbeef',
    callGasLimit: 123456n,
    verificationGasLimit: 654321n,
    preVerificationGas: 55555n,
    maxFeePerGas: 30_000_000_000n,
    maxPriorityFeePerGas: 1_500_000_000n,
    signature: '0x1234',
    factory: null,
    factoryData: null,
    eip7702Auth: null,
    paymaster: '0x36A337b8b4cE5CF6ca1dDaeef73Da4928d714DF2',
    paymasterVerificationGasLimit: 45000n,
    paymasterPostOpGasLimit: 46000n,
};
const hashOf = (paymasterData) => ak.createUserOperationHash({ ...BASE, paymasterData }, ak.ENTRYPOINT_V9, 1n);

const BARE_MAGIC_HASH = '0xcedfb2ddaf87e0525f7c94d441882c407a09d1bec15c44d11518a5db30f2a569';
const PREFIX_AABB_HASH = '0x5d4977581fd62b031127b9026a58c847d1d567aa09bd9bc0af1615716d79d84b';

describe('createUserOperationHash on EntryPoint v0.9 matches the EntryPoint', () => {
    test.each([
        ['no magic', '0xc0ffee', '0x497d881c4d619078c9496bd8496ade1414ee6327a1c471a0def4cfb2481f7b52'],
        ['empty', '0x', '0x934e6e045dab71d729ca3512de5ae8a085939f0c614fcee8f4a5126703d6f549'],
        ['the bare magic', '0x' + MAGIC, BARE_MAGIC_HASH],
        [
            'one byte and the magic, no room for a length',
            '0xab' + MAGIC,
            '0x509258886a55546dfb78d06adae514ba7dbadc7abe6abe2b7337267e8318c591',
        ],
        [
            'a zero length and the magic',
            '0x0000' + MAGIC,
            '0xf832d4b705b19501d26a8f588f5891c3743340ecb2bc1a0f8e46df0d4343c35c',
        ],
        [
            'a prefix, a zero length and the magic',
            '0xc0ffee0000' + MAGIC,
            '0x5960a5ecc48162cca0805d06d30404b4fdbad2370ce7891c154946fe0c981bf7',
        ],
        ['a 3-byte signature and no prefix', '0x112233' + '0003' + MAGIC, BARE_MAGIC_HASH],
        ['a 32-byte signature and no prefix', '0x' + '11'.repeat(32) + '0020' + MAGIC, BARE_MAGIC_HASH],
        ['a prefix and a 3-byte signature', '0xaabb112233' + '0003' + MAGIC, PREFIX_AABB_HASH],
        ['an uppercase magic', '0xaabb112233' + '0003' + MAGIC.toUpperCase(), PREFIX_AABB_HASH],
    ])('%s', (_name, paymasterData, expected) => {
        expect(hashOf(paymasterData)).toBe(expected);
    });

    test('the signature bytes do not change the hash, the prefix does', () => {
        expect(hashOf('0xaabb' + 'ffeedd' + '0003' + MAGIC)).toBe(PREFIX_AABB_HASH);
        expect(hashOf('0xaabc' + '112233' + '0003' + MAGIC)).not.toBe(PREFIX_AABB_HASH);
    });

    // The EntryPoint reverts on these; returning a hash would let an owner
    // sign something that can never be validated.
    test.each([
        ['a length of 1 with nothing before it', '0x0001' + MAGIC],
        ['a length one byte larger than the data', '0x112233' + '0004' + MAGIC],
        ['a prefix read as a huge length', '0xc0ffee' + MAGIC],
    ])('rejects %s', (_name, paymasterData) => {
        expect(() => hashOf(paymasterData)).toThrow(RangeError);
        expect(() => hashOf(paymasterData)).toThrow(/paymaster signature length/);
    });

    test('earlier EntryPoints never strip', () => {
        const withSignature = { ...BASE, paymasterData: '0xaabb112233' + '0003' + MAGIC };
        const otherSignature = { ...BASE, paymasterData: '0xaabbffeedd' + '0003' + MAGIC };
        for (const entrypoint of [ak.ENTRYPOINT_V7, ak.ENTRYPOINT_V8]) {
            expect(ak.createUserOperationHash(withSignature, entrypoint, 1n)).not.toBe(
                ak.createUserOperationHash(otherSignature, entrypoint, 1n),
            );
        }
    });
});

describe.each([
    ['SafeMultiChainSigAccountV1', ak.SafeMultiChainSigAccountV1],
    ['SafeMultiChainSigAccountV2', ak.SafeMultiChainSigAccountV2],
])('%s SafeOp hash follows the same rules', (_name, Account) => {
    const safeHash = (paymasterData) => Account.getUserOperationEip712Hash({ ...BASE, paymasterData }, 1n);

    test('the signature is excluded, the prefix is not', () => {
        expect(safeHash('0xaabb' + '112233' + '0003' + MAGIC)).toBe(safeHash('0xaabb' + 'ffeedd' + '0003' + MAGIC));
        expect(safeHash('0xaabb' + '112233' + '0003' + MAGIC)).not.toBe(safeHash('0xaabc' + '112233' + '0003' + MAGIC));
    });

    test('a zero length is hashed as is, not stripped', () => {
        // stripping `0000` would make this equal to the hash of prefix ‖ MAGIC
        expect(safeHash('0xc0ffee0000' + MAGIC)).not.toBe(safeHash('0xc0ffee' + '11' + '0001' + MAGIC));
    });

    test('a length larger than the data is rejected', () => {
        expect(() => safeHash('0x112233' + '0004' + MAGIC)).toThrow(/paymaster signature length/);
    });
});
