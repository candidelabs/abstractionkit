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
