// Regression tests for what the SDK does with an ExternalSigner's output and
// for the viem adapter. Offline.
//
// - KMS / HSM / MPC raw-sign APIs often return the recovery id as 0 / 1. The
//   signature was embedded as is: a Safe reads v = 0 as a contract signature
//   and v = 1 as an approved hash, an ECDSA recover rejects both, and the
//   operation failed only at the bundler.
// - fromViem required `sign`, which viem's LocalAccount declares optional
//   (custom `toAccount` accounts), and advertised raw-hash signing even
//   when the account could not do it.

const ak = require('../../dist/index.cjs');
const { Wallet, SigningKey } = require('ethers');

const wallet = new Wallet('0x' + '11'.repeat(32));
const CHAIN_ID = 11155111n;

// r ‖ s ‖ yParity (0 / 1), as a raw-sign API returns it
function yParitySignature(hash) {
    const signature = new SigningKey(wallet.privateKey).sign(hash);
    return signature.r + signature.s.slice(2) + (signature.yParity === 0 ? '00' : '01');
}
const canonicalSignature = (hash) => new SigningKey(wallet.privateKey).sign(hash).serialized;

const v8Op = (sender) => ({
    sender,
    nonce: 0n,
    factory: null,
    factoryData: null,
    callData: '0x',
    callGasLimit: 1n,
    verificationGasLimit: 1n,
    preVerificationGas: 1n,
    maxFeePerGas: 1n,
    maxPriorityFeePerGas: 1n,
    paymaster: null,
    paymasterVerificationGasLimit: null,
    paymasterPostOpGasLimit: null,
    paymasterData: null,
    signature: '0x',
    eip7702Auth: null,
});

describe('a signer that returns the recovery id as 0 / 1', () => {
    const rawSigner = { address: wallet.address, signHash: async (hash) => yParitySignature(hash) };
    const canonicalSigner = { address: wallet.address, signHash: async (hash) => canonicalSignature(hash) };

    test.each([
        ['Simple7702Account', ak.Simple7702Account],
        ['Simple7702AccountV09', ak.Simple7702AccountV09],
        ['Calibur7702Account', ak.Calibur7702Account],
    ])('%s gets the same signature as from a 27 / 28 signer', async (_name, Account) => {
        const account = new Account(wallet.address);
        const op = v8Op(wallet.address);
        const fromRaw = await account.signUserOperationWithSigner(op, rawSigner, CHAIN_ID);
        const fromCanonical = await account.signUserOperationWithSigner(op, canonicalSigner, CHAIN_ID);
        expect(fromRaw).toBe(fromCanonical);
    });

    test('SafeAccountV0_3_0 gets the same signature as from a 27 / 28 signer', async () => {
        const account = ak.SafeAccountV0_3_0.initializeNewAccount([wallet.address]);
        const op = { ...v8Op(account.accountAddress), factory: account.factoryAddress, factoryData: account.factoryData };
        delete op.eip7702Auth;
        const fromRaw = await account.signUserOperationWithSigners(op, [rawSigner], CHAIN_ID);
        const fromCanonical = await account.signUserOperationWithSigners(op, [canonicalSigner], CHAIN_ID);
        expect(fromRaw).toBe(fromCanonical);
        expect(['1b', '1c']).toContain(fromRaw.slice(-2));
    });

    test('a typed-data signer is normalized too', async () => {
        const account = ak.SafeAccountV0_3_0.initializeNewAccount([wallet.address]);
        const op = { ...v8Op(account.accountAddress), factory: account.factoryAddress, factoryData: account.factoryData };
        delete op.eip7702Auth;
        const reference = await account.signUserOperationWithSigners(op, [ak.fromEthersWallet(wallet)], CHAIN_ID);
        const typedDataSigner = {
            address: wallet.address,
            signTypedData: async (typedData) => {
                const canonical = await wallet.signTypedData(typedData.domain, typedData.types, typedData.message);
                return canonical.slice(0, -2) + (canonical.slice(-2) === '1b' ? '00' : '01');
            },
        };
        expect(await account.signUserOperationWithSigners(op, [typedDataSigner], CHAIN_ID)).toBe(reference);
    });
});

describe('signatures that must pass through unchanged', () => {
    const account = ak.SafeAccountV0_3_0.initializeNewAccount([wallet.address]);
    const op = { ...v8Op(account.accountAddress), factory: account.factoryAddress, factoryData: account.factoryData };
    delete op.eip7702Auth;
    const sign = (signer) => account.signUserOperationWithSigners(op, [signer], CHAIN_ID);
    const paddedOwner = '0x' + '00'.repeat(12) + wallet.address.slice(2).toLowerCase();

    test("Safe's approved-hash encoding (padded owner, v = 1)", async () => {
        const approvedHash = paddedOwner + '00'.repeat(32) + '01';
        expect((await sign({ address: wallet.address, signHash: async () => approvedHash })).endsWith('01')).toBe(true);
    });

    test('a 27 / 28 signature and an eth_sign style v = 31 / 32', async () => {
        for (const v of ['1b', '1c', '1f', '20']) {
            const signature = '0x' + 'ab'.repeat(64) + v;
            expect((await sign({ address: wallet.address, signHash: async () => signature })).endsWith(v)).toBe(true);
        }
    });

    test('a contract signer, whatever its bytes end with', async () => {
        const blob = '0x' + 'ab'.repeat(64) + '00';
        const signature = await sign({ address: wallet.address, type: 'contract', signHash: async () => blob });
        expect(signature).toContain('ab'.repeat(64) + '00');
        expect(signature).not.toContain('ab'.repeat(64) + '1b');
    });
});

describe('fromViem', () => {
    const typedData = { domain: {}, types: { T: [] }, primaryType: 'T', message: {} };

    test('an account without `sign` exposes typed-data signing only', async () => {
        const account = {
            address: wallet.address,
            signTypedData: async (args) => `0x${args.primaryType}`,
        };
        const signer = ak.fromViem(account);
        expect(signer.address).toBe(wallet.address);
        expect(signer.signHash).toBeUndefined();
        expect(await signer.signTypedData(typedData)).toBe('0xT');
    });

    test('an account with `sign` exposes both, and `sign` keeps its receiver', async () => {
        const account = {
            address: wallet.address,
            prefix: '0xfrom-this',
            async sign({ hash }) {
                return `${this.prefix}:${hash}`;
            },
            signTypedData: async () => '0xtyped',
        };
        const signer = ak.fromViem(account);
        expect(await signer.signHash('0xhash')).toBe('0xfrom-this:0xhash');
        expect(await signer.signTypedData(typedData)).toBe('0xtyped');
    });

    test('a typed-data-only viem account signs a Safe operation', async () => {
        const account = {
            address: wallet.address,
            signTypedData: (args) => wallet.signTypedData(args.domain, args.types, args.message),
        };
        const safe = ak.SafeAccountV0_3_0.initializeNewAccount([wallet.address]);
        const op = { ...v8Op(safe.accountAddress), factory: safe.factoryAddress, factoryData: safe.factoryData };
        delete op.eip7702Auth;
        expect(await safe.signUserOperationWithSigners(op, [ak.fromViem(account)], CHAIN_ID)).toBe(
            await safe.signUserOperationWithSigners(op, [ak.fromEthersWallet(wallet)], CHAIN_ID),
        );
    });
});
