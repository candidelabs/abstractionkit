// Unit tests for issue #116: SafeAccountV0_4_0.initializeNewAccount
// must return a SafeAccountV0_4_0 instance at runtime, not a plain
// SafeAccountV0_3_0. No network required.

const ak = require("../../dist/index.cjs");

const OWNER = "0x2222222222222222222222222222222222222222";

describe("initializeNewAccount runtime type (#116)", () => {
	test("SafeAccountV0_4_0.initializeNewAccount returns a SafeAccountV0_4_0", () => {
		const account = ak.SafeAccountV0_4_0.initializeNewAccount([OWNER]);
		expect(account).toBeInstanceOf(ak.SafeAccountV0_4_0);
	});

	test("instance address matches the class's createAccountAddress (v1.5.0 singleton)", () => {
		const account = ak.SafeAccountV0_4_0.initializeNewAccount([OWNER]);
		expect(account.accountAddress).toBe(ak.SafeAccountV0_4_0.createAccountAddress([OWNER]));
	});

	test("SafeAccountV0_3_0.initializeNewAccount still returns a plain SafeAccountV0_3_0", () => {
		const account = ak.SafeAccountV0_3_0.initializeNewAccount([OWNER]);
		expect(account).toBeInstanceOf(ak.SafeAccountV0_3_0);
		expect(account).not.toBeInstanceOf(ak.SafeAccountV0_4_0);
		expect(account.accountAddress).toBe(ak.SafeAccountV0_3_0.createAccountAddress([OWNER]));
	});

	test("a consumer subclass inheriting the factory gets its own type back", () => {
		class CustomSafe extends ak.SafeAccountV0_3_0 {}
		const account = CustomSafe.initializeNewAccount([OWNER]);
		expect(account).toBeInstanceOf(CustomSafe);
	});

	// Plain-JS consumers may extract the factory into a bare function,
	// leaving strict-mode `this` undefined. That worked before the
	// polymorphic factory and must keep working (falling back to the
	// pre-polymorphic behavior of constructing the base class).
	test("detached base factory call still works and returns a SafeAccountV0_3_0", () => {
		const init = ak.SafeAccountV0_3_0.initializeNewAccount;
		const account = init([OWNER]);
		expect(account).toBeInstanceOf(ak.SafeAccountV0_3_0);
		expect(account.accountAddress).toBe(ak.SafeAccountV0_3_0.createAccountAddress([OWNER]));
	});

	test("detached subclass factory call still works with v1.5.0 defaults applied", () => {
		const init = ak.SafeAccountV0_4_0.initializeNewAccount;
		const account = init([OWNER]);
		// Pre-polymorphic behavior: the wrapper class degrades to the base,
		// but the v1.5.0 singleton override still applies.
		expect(account).toBeInstanceOf(ak.SafeMultiChainSigAccountV1);
		expect(account.accountAddress).toBe(ak.SafeAccountV0_4_0.createAccountAddress([OWNER]));
	});

	test("SafeAccountV0_4_0 runs on EntryPoint v0.9 with Safe v1.5.0 and Passkey module v0.2.1", () => {
		const account = ak.SafeAccountV0_4_0.initializeNewAccount([OWNER]);
		expect(account).toBeInstanceOf(ak.SafeMultiChainSigAccountV1);
		expect(account.entrypointAddress).toBe(ak.ENTRYPOINT_V9);
		expect(account.safe4337ModuleAddress).toBe(
			ak.SafeMultiChainSigAccountV1.DEFAULT_SAFE_4337_MODULE_ADDRESS,
		);
		expect(account.safeAccountSingleton).toEqual(ak.Safe_L2_V1_5_0);
		// Same owners, different singleton: a different address than the v1.4.1 account.
		expect(account.accountAddress).not.toBe(
			ak.SafeMultiChainSigAccountV1.createAccountAddress([OWNER]),
		);
		// The WebAuthn defaults are the full Safe Passkey module v0.2.1 set.
		expect(ak.SafeAccountV0_4_0.DEFAULT_WEB_AUTHN_SHARED_SIGNER).toBe(
			"0x94a4F6affBd8975951142c3999aEAB7ecee555c2",
		);
		expect(ak.SafeAccountV0_4_0.DEFAULT_WEB_AUTHN_SIGNER_FACTORY).toBe(
			"0x1d31F259eE307358a26dFb23EB365939E8641195",
		);
		expect(ak.SafeAccountV0_4_0.DEFAULT_WEB_AUTHN_PRECOMPILE).toBe(
			"0x0000000000000000000000000000000000000100",
		);
		expect(ak.SafeAccountV0_4_0.DEFAULT_WEB_AUTHN_CONTRACT_VERIFIER).toBe(
			"0xc2b78104907F722DABAc4C69f826a522B2754De4",
		);
	});
});
