// Offline checks for SafeMultiChainSigAccountV2: the multi-chain signature
// module on EntryPoint v0.9 with the Safe L2 v1.5.0 singleton.
const ak = require("../../dist/index.cjs");

const OWNER = "0x1a02592A3484c2077d2E5D24482497F85e1980C6";
const SAFE_L2_V1_5_0_SINGLETON = "0xEdd160fEBBD92E350D4D398fb636302fccd67C7e";

describe("SafeMultiChainSigAccountV2", () => {
	test("is a SafeMultiChainSigAccountV1 on the same module and EntryPoint", () => {
		const account = ak.SafeMultiChainSigAccountV2.initializeNewAccount([OWNER]);
		expect(account).toBeInstanceOf(ak.SafeMultiChainSigAccountV2);
		expect(account).toBeInstanceOf(ak.SafeMultiChainSigAccountV1);
		expect(account.entrypointAddress).toBe(ak.ENTRYPOINT_V9);
		expect(account.safe4337ModuleAddress).toBe(
			ak.SafeMultiChainSigAccountV1.DEFAULT_SAFE_4337_MODULE_ADDRESS,
		);
	});

	test("defaults to the Safe L2 v1.5.0 singleton, which changes the address", () => {
		const v2 = ak.SafeMultiChainSigAccountV2.initializeNewAccount([OWNER]);
		expect(v2.safeAccountSingleton).toEqual(ak.Safe_L2_V1_5_0);
		expect(v2.safeAccountSingleton.singletonAddress).toBe(SAFE_L2_V1_5_0_SINGLETON);
		expect(v2.accountAddress).toBe(ak.SafeMultiChainSigAccountV2.createAccountAddress([OWNER]));
		expect(v2.accountAddress).toBe(
			ak.SafeMultiChainSigAccountV1.createAccountAddress([OWNER], {
				safeAccountSingleton: ak.Safe_L2_V1_5_0,
			}),
		);
		expect(v2.accountAddress).not.toBe(ak.SafeMultiChainSigAccountV1.createAccountAddress([OWNER]));
		expect(new ak.SafeMultiChainSigAccountV2(v2.accountAddress).safeAccountSingleton).toEqual(
			ak.Safe_L2_V1_5_0,
		);
	});

	test("factory data deploys the v1.5.0 singleton and matches V1 with the override", () => {
		const [factory, data] = ak.SafeMultiChainSigAccountV2.createFactoryAddressAndData([OWNER]);
		const [factoryV1, dataV1] = ak.SafeMultiChainSigAccountV1.createFactoryAddressAndData([OWNER], {
			safeAccountSingleton: ak.Safe_L2_V1_5_0,
		});
		expect(factory).toBe(factoryV1);
		expect(data).toBe(dataV1);
		expect(data.toLowerCase()).toContain(SAFE_L2_V1_5_0_SINGLETON.slice(2).toLowerCase());
	});

	test("uses the Safe Passkey module v0.2.1 WebAuthn defaults", () => {
		expect(ak.SafeMultiChainSigAccountV2.DEFAULT_WEB_AUTHN_SHARED_SIGNER).toBe(
			"0x94a4F6affBd8975951142c3999aEAB7ecee555c2",
		);
		expect(ak.SafeMultiChainSigAccountV2.DEFAULT_WEB_AUTHN_SIGNER_FACTORY).toBe(
			"0x1d31F259eE307358a26dFb23EB365939E8641195",
		);
		expect(ak.SafeMultiChainSigAccountV2.DEFAULT_WEB_AUTHN_PRECOMPILE).toBe(
			"0x0000000000000000000000000000000000000100",
		);
		expect(ak.SafeMultiChainSigAccountV2.DEFAULT_WEB_AUTHN_CONTRACT_VERIFIER).toBe(
			"0xc2b78104907F722DABAc4C69f826a522B2754De4",
		);
	});

	test("V1 still returns V1 and a detached V2 factory call degrades to V1 with the v1.5.0 singleton", () => {
		const v1 = ak.SafeMultiChainSigAccountV1.initializeNewAccount([OWNER]);
		expect(v1).toBeInstanceOf(ak.SafeMultiChainSigAccountV1);
		expect(v1).not.toBeInstanceOf(ak.SafeMultiChainSigAccountV2);
		expect(v1.safeAccountSingleton).toEqual(ak.Safe_L2_V1_4_1);

		const init = ak.SafeMultiChainSigAccountV2.initializeNewAccount;
		const detached = init([OWNER]);
		expect(detached).toBeInstanceOf(ak.SafeMultiChainSigAccountV1);
		expect(detached.accountAddress).toBe(ak.SafeMultiChainSigAccountV2.createAccountAddress([OWNER]));
	});
});

const WEBAUTHN_KEY = {
	x: 0x7a2fa39b3c61b3cbab8e44abeac8c9c7a4c1f76d42ae6f47b3b2a96d5c4f1a2bn,
	y: 0x2e8c5f6d4b7a9c1e3f5a8d7b6c4e2f1a9d8c7b6a5e4f3d2c1b0a9f8e7d6c5b4an,
};
const hex = (addr) => addr.slice(2).toLowerCase();

describe("SafeMultiChainSigAccountV2 with a WebAuthn owner", () => {
	test("initializes the passkey state and the v1.5.0 address", () => {
		const account = ak.SafeMultiChainSigAccountV2.initializeNewAccount([WEBAUTHN_KEY]);
		expect(account).toBeInstanceOf(ak.SafeMultiChainSigAccountV2);
		expect(account.isInitWebAuthn).toBe(true);
		expect(account.x).toBe(WEBAUTHN_KEY.x);
		expect(account.y).toBe(WEBAUTHN_KEY.y);
		expect(account.accountAddress).toBe(
			ak.SafeMultiChainSigAccountV2.createAccountAddress([WEBAUTHN_KEY]),
		);
		expect(account.accountAddress).not.toBe(
			ak.SafeMultiChainSigAccountV1.createAccountAddress([WEBAUTHN_KEY]),
		);
	});

	test("factory data configures the Passkey module v0.2.1 shared signer and verifiers", () => {
		const account = ak.SafeMultiChainSigAccountV2.initializeNewAccount([WEBAUTHN_KEY]);
		const data = account.factoryData.toLowerCase();
		expect(data).toContain(hex(ak.SafeMultiChainSigAccountV2.DEFAULT_WEB_AUTHN_SHARED_SIGNER));
		expect(data).toContain(hex(ak.SafeMultiChainSigAccountV2.DEFAULT_WEB_AUTHN_CONTRACT_VERIFIER));
		// The RIP-7951 precompile is packed into the verifiers word next to the contract verifier.
		expect(data).toContain(
			"0100" + hex(ak.SafeMultiChainSigAccountV2.DEFAULT_WEB_AUTHN_CONTRACT_VERIFIER),
		);
		// Not the Passkey module v0.2.0 shared signer that SafeAccountV0_3_0 uses.
		expect(data).not.toContain(hex(ak.SafeAccountV0_3_0.DEFAULT_WEB_AUTHN_SHARED_SIGNER));
	});

	test("derives the same verifier proxy as V1 (same v0.2.1 factory) and a different one than v0.2.0", () => {
		const v2 = ak.SafeMultiChainSigAccountV2.createWebAuthnSignerVerifierAddress(
			WEBAUTHN_KEY.x,
			WEBAUTHN_KEY.y,
		);
		expect(v2).toBe(
			ak.SafeMultiChainSigAccountV1.createWebAuthnSignerVerifierAddress(WEBAUTHN_KEY.x, WEBAUTHN_KEY.y),
		);
		expect(v2).not.toBe(
			ak.SafeAccountV0_3_0.createWebAuthnSignerVerifierAddress(WEBAUTHN_KEY.x, WEBAUTHN_KEY.y),
		);
	});
});

describe("SafeMultiChainSigAccountV2 subclassing", () => {
	class ConsumerAccount extends ak.SafeMultiChainSigAccountV2 {}

	test("a consumer subclass of V2 gets its own instance back from initializeNewAccount", () => {
		const account = ConsumerAccount.initializeNewAccount([OWNER]);
		expect(account).toBeInstanceOf(ConsumerAccount);
		expect(account).toBeInstanceOf(ak.SafeMultiChainSigAccountV2);
		expect(account.safeAccountSingleton).toEqual(ak.Safe_L2_V1_5_0);
		expect(account.accountAddress).toBe(ak.SafeMultiChainSigAccountV2.createAccountAddress([OWNER]));
	});

	test("a subclass can still override the singleton default", () => {
		class V141Account extends ak.SafeMultiChainSigAccountV2 {
			constructor(address, overrides = {}) {
				super(address, { ...overrides, safeAccountSingleton: overrides.safeAccountSingleton ?? ak.Safe_L2_V1_4_1 });
			}
			static initializeNewAccount(owners, overrides = {}) {
				return super.initializeNewAccount(owners, {
					...overrides,
					safeAccountSingleton: overrides.safeAccountSingleton ?? ak.Safe_L2_V1_4_1,
				});
			}
		}
		const account = V141Account.initializeNewAccount([OWNER]);
		expect(account).toBeInstanceOf(V141Account);
		expect(account.safeAccountSingleton).toEqual(ak.Safe_L2_V1_4_1);
		expect(account.accountAddress).toBe(ak.SafeMultiChainSigAccountV1.createAccountAddress([OWNER]));
	});
});

describe("SafeMultiChainSigAccountV2 override passthrough", () => {
	test("createProxyAddress defaults to the v1.5.0 init hash and honours an explicit one", () => {
		const init = "0x" + "ab".repeat(32);
		const byDefault = ak.SafeMultiChainSigAccountV2.createProxyAddress(init);
		expect(byDefault).toBe(
			ak.SafeMultiChainSigAccountV1.createProxyAddress(init, {
				singletonInitHash: ak.Safe_L2_V1_5_0.singletonInitHash,
			}),
		);
		expect(byDefault).not.toBe(ak.SafeMultiChainSigAccountV1.createProxyAddress(init));
		expect(
			ak.SafeMultiChainSigAccountV2.createProxyAddress(init, {
				singletonInitHash: ak.Safe_L2_V1_4_1.singletonInitHash,
			}),
		).toBe(ak.SafeMultiChainSigAccountV1.createProxyAddress(init));
	});

	test("the singleton is the only difference: V2 with Safe_L2_V1_4_1 reproduces V1", () => {
		const override = { safeAccountSingleton: ak.Safe_L2_V1_4_1 };
		expect(ak.SafeMultiChainSigAccountV2.createAccountAddress([OWNER], override)).toBe(
			ak.SafeMultiChainSigAccountV1.createAccountAddress([OWNER]),
		);
		expect(ak.SafeMultiChainSigAccountV2.createFactoryAddressAndData([OWNER], override)).toEqual(
			ak.SafeMultiChainSigAccountV1.createFactoryAddressAndData([OWNER]),
		);
		const account = ak.SafeMultiChainSigAccountV2.initializeNewAccount([OWNER], override);
		expect(account).toBeInstanceOf(ak.SafeMultiChainSigAccountV2);
		expect(account.accountAddress).toBe(ak.SafeMultiChainSigAccountV1.createAccountAddress([OWNER]));
	});

	test("constructor forwards module and EntryPoint overrides and keeps the v1.5.0 singleton", () => {
		const module = "0x" + "11".repeat(20);
		const entrypoint = "0x" + "22".repeat(20);
		const account = new ak.SafeMultiChainSigAccountV2(OWNER, {
			safe4337ModuleAddress: module,
			entrypointAddress: entrypoint,
		});
		expect(account.safe4337ModuleAddress).toBe(module);
		expect(account.entrypointAddress).toBe(entrypoint);
		expect(account.safeAccountSingleton).toEqual(ak.Safe_L2_V1_5_0);
	});
});
