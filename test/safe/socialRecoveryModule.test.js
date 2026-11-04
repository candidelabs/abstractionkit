// Offline tests for the Social Recovery Module v0.1.0 / v0.2.0 encoders.
// Selectors and struct layouts come from candide-contracts tags
// recovery/v0.1.0 and recovery/v0.2.0.

const ak = require('../../dist/index.cjs');
const { AbiCoder, TypedDataEncoder, Wallet, id } = require('ethers');

const coder = AbiCoder.defaultAbiCoder();
const ACCOUNT = '0x1a02592A3484c2077d2E5D24482497F85e1980C6';
const NEW_OWNER = '0x084f4dB6bae8fBb7fb9709c0A25532E21C7A097E';
const LOW = '0x1000000000000000000000000000000000000001';
const HIGH = '0xF000000000000000000000000000000000000002';

function decode(data, selector, types) {
    expect(data.slice(0, 10)).toBe(selector);
    return coder.decode(types, '0x' + data.slice(10));
}

function mockNode(result) {
    return { request: async () => result };
}

describe('SocialRecoveryModule versions', () => {
    test('only versioned classes are exported', () => {
        expect(ak.SocialRecoveryModule).toBeUndefined();
        expect(ak.SocialRecoveryModuleGracePeriodSelector).toBeUndefined();
        expect(new ak.SocialRecoveryModuleV1()).toBeInstanceOf(ak.SocialRecoveryModuleBase);
        expect(new ak.SocialRecoveryModuleV2()).toBeInstanceOf(ak.SocialRecoveryModuleBase);
    });

    test('default addresses are the 3-day deployment of each version', () => {
        expect(new ak.SocialRecoveryModuleV2().moduleAddress).toBe(
            '0x00480F5ecC008995469fA7e12c70Ef3DC9FEe7fD',
        );
        expect(new ak.SocialRecoveryModuleV1().moduleAddress).toBe(
            '0x38275826E1933303E508433dD5f289315Da2541c',
        );
        expect(ak.SocialRecoveryModuleV2.DEFAULT_SOCIAL_RECOVERY_ADDRESS).toBe(
            ak.SocialRecoveryModuleGracePeriodSelectorV2.After3Days,
        );
    });

    test('hardcoded selectors match the contract signatures', () => {
        const sel = (s) => id(s).slice(0, 10);
        expect(sel('confirmRecovery(address,address[],uint256,uint256,bool)')).toBe('0xaa33d34d');
        expect(
            sel('multiConfirmRecovery(address,address[],uint256,uint256,(address,bytes)[],bool)'),
        ).toBe('0x9771fa44');
        expect(sel('confirmRecovery(address,address[],uint256,bool)')).toBe('0x064e2d0e');
        expect(sel('multiConfirmRecovery(address,address[],uint256,(address,bytes)[],bool)')).toBe(
            '0x0728e1e7',
        );
        expect(sel('changeThreshold(uint256)')).toBe('0x694e80c3');
    });

    // Guards against selector drift in the methods both versions inherit from
    // SocialRecoveryModuleBase: each generated calldata must start with the
    // selector of its contract signature.
    test.each([
        ['v0.1.0', () => new ak.SocialRecoveryModuleV1()],
        ['v0.2.0', () => new ak.SocialRecoveryModuleV2()],
    ])('shared methods encode their contract selectors (%s)', async (_, create) => {
        const srm = create();
        const sel = (s) => id(s).slice(0, 10);
        const selectorOf = (tx) => tx.data.slice(0, 10);
        const capture = (result) => {
            const calls = [];
            const node = {
                request: async ({ params }) => {
                    calls.push(params[0].data);
                    return result;
                },
            };
            return { node, selector: () => calls[0].slice(0, 10) };
        };

        expect(selectorOf(srm.createExecuteRecoveryMetaTransaction(ACCOUNT, [NEW_OWNER], 1))).toBe(
            sel('executeRecovery(address,address[],uint256)'),
        );
        expect(selectorOf(srm.createFinalizeRecoveryMetaTransaction(ACCOUNT))).toBe(
            sel('finalizeRecovery(address)'),
        );
        expect(selectorOf(srm.createCancelRecoveryMetaTransaction())).toBe(sel('cancelRecovery()'));
        expect(selectorOf(srm.createAddGuardianWithThresholdMetaTransaction(LOW, 1n))).toBe(
            sel('addGuardianWithThreshold(address,uint256)'),
        );
        expect(
            selectorOf(srm.createStandardRevokeGuardianWithThresholdMetaTransaction(LOW, HIGH, 1n)),
        ).toBe(sel('revokeGuardianWithThreshold(address,address,uint256)'));
        expect(
            selectorOf(
                await srm.createRevokeGuardianWithThresholdMetaTransaction(
                    mockNode('0x'),
                    ACCOUNT,
                    HIGH,
                    1n,
                    { prevGuardianAddress: LOW },
                ),
            ),
        ).toBe(sel('revokeGuardianWithThreshold(address,address,uint256)'));
        expect(selectorOf(srm.createChangeThresholdMetaTransaction(1n))).toBe(
            sel('changeThreshold(uint256)'),
        );

        const views = [
            [
                'getRecoveryHash(address,address[],uint256,uint256)',
                coder.encode(['bytes32'], ['0x' + '11'.repeat(32)]),
                (node) => srm.getRecoveryHash(node, ACCOUNT, [NEW_OWNER], 1, 0n),
            ],
            [
                'getRecoveryApprovals(address,address[],uint256)',
                coder.encode(['uint256'], [0n]),
                (node) => srm.getRecoveryApprovals(node, ACCOUNT, [NEW_OWNER], 1),
            ],
            [
                'hasGuardianApproved(address,address,address[],uint256)',
                coder.encode(['bool'], [false]),
                (node) => srm.hasGuardianApproved(node, ACCOUNT, LOW, [NEW_OWNER], 1),
            ],
            [
                'isGuardian(address,address)',
                coder.encode(['bool'], [false]),
                (node) => srm.isGuardian(node, ACCOUNT, LOW),
            ],
            [
                'guardiansCount(address)',
                coder.encode(['uint256'], [0n]),
                (node) => srm.guardiansCount(node, ACCOUNT),
            ],
            [
                'threshold(address)',
                coder.encode(['uint256'], [0n]),
                (node) => srm.threshold(node, ACCOUNT),
            ],
            [
                'getGuardians(address)',
                coder.encode(['address[]'], [[]]),
                (node) => srm.getGuardians(node, ACCOUNT),
            ],
            ['nonce(address)', coder.encode(['uint256'], [0n]), (node) => srm.nonce(node, ACCOUNT)],
        ];
        for (const [signature, result, call] of views) {
            const { node, selector } = capture(result);
            await call(node);
            expect(selector()).toBe(sel(signature));
        }
    });
});

describe('SocialRecoveryModuleV2 (v0.2.0)', () => {
    const srm = new ak.SocialRecoveryModuleV2();

    // v0.2.0 (Certora L-05) rejects wallet-only calls whose calldata is not exactly
    // 4 + 32 * staticArgs bytes, so any trailing bytes would make them revert.
    test.each([
        ['addGuardianWithThreshold', () => srm.createAddGuardianWithThresholdMetaTransaction(LOW, 1n), 2],
        [
            'revokeGuardianWithThreshold',
            () => srm.createStandardRevokeGuardianWithThresholdMetaTransaction(LOW, HIGH, 1n),
            3,
        ],
        ['changeThreshold', () => srm.createChangeThresholdMetaTransaction(1n), 1],
        ['cancelRecovery', () => srm.createCancelRecoveryMetaTransaction(), 0],
    ])('%s calldata has the canonical length', (_name, build, argsCount) => {
        const { data } = build();
        expect((data.length - 2) / 2).toBe(4 + 32 * argsCount);
    });

    test('confirmRecovery encodes the nonce before execute', () => {
        const tx = srm.createConfirmRecoveryMetaTransaction(ACCOUNT, [NEW_OWNER], 1, 7n, true);
        expect(tx.to).toBe(srm.moduleAddress);
        const [wallet, owners, threshold, nonce, execute] = decode(tx.data, '0xaa33d34d', [
            'address',
            'address[]',
            'uint256',
            'uint256',
            'bool',
        ]);
        expect(wallet).toBe(ACCOUNT);
        expect(owners).toEqual([NEW_OWNER]);
        expect(threshold).toBe(1n);
        expect(nonce).toBe(7n);
        expect(execute).toBe(true);
    });

    test('multiConfirmRecovery encodes the nonce before the sorted signatures', () => {
        const tx = srm.createMultiConfirmRecoveryMetaTransaction(
            ACCOUNT,
            [NEW_OWNER],
            1,
            3n,
            [
                { signer: HIGH, signature: '0xbb' },
                { signer: LOW, signature: '0xaa' },
            ],
            false,
        );
        const [, , , nonce, sigs, execute] = decode(tx.data, '0x9771fa44', [
            'address',
            'address[]',
            'uint256',
            'uint256',
            '(address,bytes)[]',
            'bool',
        ]);
        expect(nonce).toBe(3n);
        expect(sigs.map((s) => s[0].toLowerCase())).toEqual([LOW, HIGH.toLowerCase()]);
        expect(sigs.map((s) => s[1])).toEqual(['0xaa', '0xbb']);
        expect(execute).toBe(false);
    });

    test('multiConfirmRecovery rejects duplicate signers', () => {
        expect(() =>
            srm.createMultiConfirmRecoveryMetaTransaction(
                ACCOUNT,
                [NEW_OWNER],
                1,
                0n,
                [
                    { signer: LOW, signature: '0x' },
                    { signer: LOW.toLowerCase(), signature: '0x' },
                ],
                true,
            ),
        ).toThrow(/Duplicate signer/);
    });

    test('getRecoveryRequest decodes nonce and executableAt', async () => {
        const encoded = coder.encode(
            ['(uint256,uint256,uint256,uint64,address[])'],
            [[2n, 1n, 5n, 1700000000n, [NEW_OWNER]]],
        );
        const request = await srm.getRecoveryRequest(mockNode(encoded), ACCOUNT);
        expect(request).toEqual({
            guardiansApprovalCount: 2n,
            newThreshold: 1n,
            nonce: 5n,
            executableAt: 1700000000n,
            newOwners: [NEW_OWNER],
        });
    });

    test('EIP-712 data uses domain version 0.2.0 and the fetched nonce', async () => {
        const nonceResult = coder.encode(['uint256'], [9n]);
        const { domain, types, messageValue } = await srm.getRecoveryRequestEip712Data(
            mockNode(nonceResult),
            1n,
            ACCOUNT,
            [NEW_OWNER],
            1n,
        );
        expect(domain).toEqual({
            name: 'Social Recovery Module',
            version: '0.2.0',
            chainId: 1,
            verifyingContract: srm.moduleAddress,
        });
        expect(messageValue.nonce).toBe(9n);
        // The typed data must hash with ethers (what guardians sign with).
        const guardian = Wallet.createRandom();
        const sig = await guardian.signTypedData(domain, types, messageValue);
        expect(sig).toMatch(/^0x[0-9a-f]{130}$/);
        expect(TypedDataEncoder.hash(domain, types, messageValue)).toMatch(/^0x[0-9a-f]{64}$/);
    });
});

describe('SocialRecoveryModuleV1 (v0.1.0)', () => {
    const srm = new ak.SocialRecoveryModuleV1();

    test('confirmRecovery keeps the v0.1.0 layout', () => {
        const tx = srm.createConfirmRecoveryMetaTransaction(ACCOUNT, [NEW_OWNER], 1, true);
        const [, , , execute] = decode(tx.data, '0x064e2d0e', [
            'address',
            'address[]',
            'uint256',
            'bool',
        ]);
        expect(execute).toBe(true);
    });

    test('multiConfirmRecovery keeps the v0.1.0 layout', () => {
        const tx = srm.createMultiConfirmRecoveryMetaTransaction(
            ACCOUNT,
            [NEW_OWNER],
            1,
            [{ signer: LOW, signature: '0xaa' }],
            true,
        );
        decode(tx.data, '0x0728e1e7', [
            'address',
            'address[]',
            'uint256',
            '(address,bytes)[]',
            'bool',
        ]);
    });

    test('getRecoveryRequest decodes executeAfter', async () => {
        const encoded = coder.encode(
            ['(uint256,uint256,uint64,address[])'],
            [[2n, 1n, 1700000000n, [NEW_OWNER]]],
        );
        const request = await srm.getRecoveryRequest(mockNode(encoded), ACCOUNT);
        expect(request).toEqual({
            guardiansApprovalCount: 2n,
            newThreshold: 1n,
            executeAfter: 1700000000n,
            newOwners: [NEW_OWNER],
        });
    });

    test('EIP-712 data uses domain version 0.0.1', async () => {
        const { domain } = await srm.getRecoveryRequestEip712Data(
            mockNode('0x'),
            1n,
            ACCOUNT,
            [NEW_OWNER],
            1n,
            { recoveryNonce: 0n },
        );
        expect(domain.version).toBe('0.0.1');
    });
});
