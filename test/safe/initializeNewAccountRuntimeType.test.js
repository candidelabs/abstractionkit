// Unit tests for issue #116: SafeAccountV1_5_0_M_0_3_0.initializeNewAccount
// must return a SafeAccountV1_5_0_M_0_3_0 instance at runtime, not a plain
// SafeAccountV0_3_0. No network required.

const ak = require("../../dist/index.cjs");

const OWNER = "0x2222222222222222222222222222222222222222";

describe("initializeNewAccount runtime type (#116)", () => {
	test("SafeAccountV1_5_0_M_0_3_0.initializeNewAccount returns a SafeAccountV1_5_0_M_0_3_0", () => {
		const account = ak.SafeAccountV1_5_0_M_0_3_0.initializeNewAccount([OWNER]);
		expect(account).toBeInstanceOf(ak.SafeAccountV1_5_0_M_0_3_0);
	});

	test("instance address matches the class's createAccountAddress (v1.5.0 singleton)", () => {
		const account = ak.SafeAccountV1_5_0_M_0_3_0.initializeNewAccount([OWNER]);
		expect(account.accountAddress).toBe(ak.SafeAccountV1_5_0_M_0_3_0.createAccountAddress([OWNER]));
	});

	test("SafeAccountV0_3_0.initializeNewAccount still returns a plain SafeAccountV0_3_0", () => {
		const account = ak.SafeAccountV0_3_0.initializeNewAccount([OWNER]);
		expect(account).toBeInstanceOf(ak.SafeAccountV0_3_0);
		expect(account).not.toBeInstanceOf(ak.SafeAccountV1_5_0_M_0_3_0);
		expect(account.accountAddress).toBe(ak.SafeAccountV0_3_0.createAccountAddress([OWNER]));
	});

	test("a consumer subclass inheriting the factory gets its own type back", () => {
		class CustomSafe extends ak.SafeAccountV0_3_0 {}
		const account = CustomSafe.initializeNewAccount([OWNER]);
		expect(account).toBeInstanceOf(CustomSafe);
	});
});
