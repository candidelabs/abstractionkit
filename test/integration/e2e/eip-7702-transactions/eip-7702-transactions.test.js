// e2e: the raw-transaction helpers that a node, not a bundler, has to accept.
//
// The account suites delegate EOAs through the bundler (eip7702Auth on a
// userop), so the SDK's own transaction builders never reached a chain:
// createAndSignLegacyRawTransaction, createAndSignEip7702RawTransaction (and
// the signing hash behind it), and the two revoke helpers on the 7702 account
// classes. Each builds bytes the node must decode, recover the sender from and
// execute. This suite broadcasts them to the anvil fork and checks the result
// through eth_getTransactionByHash and the delegation readers.
//
// Steps share EOAs and are ordered, so each chain runs sequentially.

const { Wallet } = require('ethers');
const {
    createAndSignLegacyRawTransaction,
    createAndSignEip7702DelegationAuthorization,
    createAndSignEip7702RawTransaction,
    Simple7702Account,
    Calibur7702Account,
    JsonRpcNode,
    sendJsonRpcRequest,
} = require('../../../../dist/index.cjs');
const { runnable, unrunnable, nodeUrl } = require('../../_runnable.cjs');

jest.setTimeout(180000);

const ONE_ETH_HEX = '0xde0b6b3a7640000';
const TRANSFER = 1_000_000_000_000_000n;
// 21_000 intrinsic + 25_000 per authorization (PER_EMPTY_ACCOUNT_COST), rounded up.
const TYPE4_GAS_LIMIT = 100_000n;

const lower = (a) => a.toLowerCase();

// createAndSignEip7702DelegationAuthorization returns hex strings; the raw
// transaction builder takes bigints.
function toAuthorization(authHex) {
    return {
        chainId: BigInt(authHex.chainId),
        address: authHex.address,
        nonce: BigInt(authHex.nonce),
        yParity: BigInt(authHex.yParity) === 0n ? 0 : 1,
        r: BigInt(authHex.r),
        s: BigInt(authHex.s),
    };
}

const perChain =
    runnable.length > 0
        ? describe.each(runnable)
        : () => test.skip('eip-7702 raw transactions (no runnable chain)', () => {});

perChain('eip-7702 raw transactions: $name (chainId $chainId)', (chain) => {
    const node = nodeUrl(chain);
    const chainId = BigInt(chain.chainId);
    const rpc = JsonRpcNode.from(node);

    async function fund(address) {
        await sendJsonRpcRequest(node, 'anvil_setBalance', [address, ONE_ETH_HEX]);
    }

    async function fees() {
        const gasPrice = BigInt(await sendJsonRpcRequest(node, 'eth_gasPrice', []));
        return { gasPrice: gasPrice * 2n, maxFeePerGas: gasPrice * 2n, maxPriorityFeePerGas: gasPrice };
    }

    async function nonceOf(address) {
        return BigInt(await sendJsonRpcRequest(node, 'eth_getTransactionCount', [address, 'latest']));
    }

    // anvil automines, but give the receipt a few polls to appear. Until the
    // block is mined anvil forwards the lookup to the fork URL, and some
    // public endpoints (Optimism publicnode) answer an unknown hash with an
    // "archive requests" error instead of null, so a failed poll is retried.
    async function broadcast(raw) {
        const hash = await sendJsonRpcRequest(node, 'eth_sendRawTransaction', [raw]);
        let lastError;
        for (let i = 0; i < 40; i++) {
            try {
                const receipt = await sendJsonRpcRequest(node, 'eth_getTransactionReceipt', [hash]);
                if (receipt != null) return { hash, receipt };
            } catch (e) {
                lastError = e;
            }
            await new Promise((r) => setTimeout(r, 250));
        }
        throw new Error(`no receipt for ${hash}${lastError ? `: ${lastError.message}` : ''}`);
    }

    async function delegateWithRawTransaction(eoa, delegatee) {
        const nonce = await nonceOf(eoa.address);
        const { maxFeePerGas, maxPriorityFeePerGas } = await fees();
        // The sender's nonce is bumped before the authorization list is
        // processed, so a self-sponsored authorization signs nonce + 1.
        const authorization = toAuthorization(
            createAndSignEip7702DelegationAuthorization(chainId, delegatee, nonce + 1n, eoa.privateKey),
        );
        const raw = createAndSignEip7702RawTransaction(
            chainId,
            nonce,
            maxPriorityFeePerGas,
            maxFeePerGas,
            TYPE4_GAS_LIMIT,
            eoa.address,
            0n,
            '0x',
            [],
            [authorization],
            eoa.privateKey,
        );
        return broadcast(raw);
    }

    const legacySender = Wallet.createRandom();
    const simpleEoa = Wallet.createRandom();
    const caliburEoa = Wallet.createRandom();

    beforeAll(async () => {
        await fund(legacySender.address);
        await fund(simpleEoa.address);
        await fund(caliburEoa.address);
    });

    test('createAndSignLegacyRawTransaction: the node recovers the sender and executes the transfer', async () => {
        const recipient = Wallet.createRandom().address;
        const { gasPrice } = await fees();
        const raw = createAndSignLegacyRawTransaction(
            chainId,
            await nonceOf(legacySender.address),
            gasPrice,
            21_000n,
            recipient,
            TRANSFER,
            '0x',
            legacySender.privateKey,
        );

        const { hash, receipt } = await broadcast(raw);
        expect(receipt.status).toBe('0x1');

        const tx = await sendJsonRpcRequest(node, 'eth_getTransactionByHash', [hash]);
        expect(lower(tx.from)).toBe(lower(legacySender.address));
        expect(lower(tx.to)).toBe(lower(recipient));
        expect(BigInt(await sendJsonRpcRequest(node, 'eth_getBalance', [recipient, 'latest']))).toBe(TRANSFER);
    });

    test('createAndSignEip7702RawTransaction: a type-4 transaction delegates the EOA to Simple7702Account', async () => {
        const delegatee = Simple7702Account.DEFAULT_DELEGATEE_ADDRESS;
        const { hash, receipt } = await delegateWithRawTransaction(simpleEoa, delegatee);
        expect(receipt.status).toBe('0x1');

        // The node recovered our EOA from the signature over the signing hash,
        // and decoded the authorization list we encoded.
        const tx = await sendJsonRpcRequest(node, 'eth_getTransactionByHash', [hash]);
        expect(BigInt(tx.type)).toBe(4n);
        expect(lower(tx.from)).toBe(lower(simpleEoa.address));
        expect(tx.authorizationList).toHaveLength(1);
        expect(lower(tx.authorizationList[0].address)).toBe(lower(delegatee));

        expect(lower(await rpc.getDelegatedAddress(simpleEoa.address))).toBe(lower(delegatee));
        expect(await new Simple7702Account(simpleEoa.address).isDelegatedToThisAccount(node)).toBe(true);
        expect(await new Calibur7702Account(simpleEoa.address).isDelegatedToThisAccount(node)).toBe(false);
    });

    test('Simple7702Account.createRevokeDelegationTransaction restores a plain EOA', async () => {
        const account = new Simple7702Account(simpleEoa.address);
        const raw = await account.createRevokeDelegationTransaction(simpleEoa.privateKey, node);

        const { receipt } = await broadcast(raw);
        expect(receipt.status).toBe('0x1');

        expect(await rpc.getDelegatedAddress(simpleEoa.address)).toBeNull();
        expect(await account.isDelegatedToThisAccount(node)).toBe(false);
        expect(await sendJsonRpcRequest(node, 'eth_getCode', [simpleEoa.address, 'latest'])).toBe('0x');

        // Nothing left to revoke.
        await expect(account.createRevokeDelegationTransaction(simpleEoa.privateKey, node)).rejects.toThrow(
            /nothing to revoke/,
        );
    });

    test('Calibur7702Account.createRevokeDelegationRawTransaction revokes a Calibur delegation, and only that one', async () => {
        const calibur = new Calibur7702Account(caliburEoa.address);
        const { receipt: delegated } = await delegateWithRawTransaction(caliburEoa, calibur.delegateeAddress);
        expect(delegated.status).toBe('0x1');
        expect(await calibur.isDelegatedToThisAccount(node)).toBe(true);

        // The Simple7702 helper refuses to revoke a delegation it does not own.
        await expect(
            new Simple7702Account(caliburEoa.address).createRevokeDelegationTransaction(caliburEoa.privateKey, node),
        ).rejects.toThrow(/different address/);

        const raw = await calibur.createRevokeDelegationRawTransaction(chainId, caliburEoa.privateKey, node);
        const { receipt } = await broadcast(raw);
        expect(receipt.status).toBe('0x1');
        expect(await rpc.getDelegatedAddress(caliburEoa.address)).toBeNull();
        expect(await calibur.isDelegatedToThisAccount(node)).toBe(false);
    });

    test('a revoke signed by a different key is refused before anything is broadcast', async () => {
        const stranger = Wallet.createRandom();
        await expect(
            new Simple7702Account(simpleEoa.address).createRevokeDelegationTransaction(stranger.privateKey, node),
        ).rejects.toThrow(/does not match accountAddress/);
    });
});

if (unrunnable.length > 0) {
    test.skip.each(unrunnable)('$name (setup failed)', () => {});
}
