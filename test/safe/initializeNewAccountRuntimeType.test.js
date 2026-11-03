// Unit tests for issue #116: SafeAccountV0_3_0.initializeNewAccount must
// construct the calling class, so a subclass gets its own type back at
// runtime instead of a plain SafeAccountV0_3_0.

const ak = require("../../dist/index.cjs");

const OWNER = "0x1a02592A3484c2077d2E5D24482497F85e1980C6";

// A consumer-defined subclass that changes a factory default, the way the
// removed SafeAccountV1_5_0_M_0_3_0 did with the Safe v1.5.0 singleton.
class SubclassAccount extends ak.SafeAccountV0_3_0 {
	constructor(accountAddress, overrides = {}) {
		super(accountAddress, {
			...overrides,
			safeAccountSingleton: overrides.safeAccountSingleton ?? ak.Safe_L2_V1_5_0,
		});
	}

	static initializeNewAccount(owners, overrides = {}) {
		return super.initializeNewAccount(owners, {
			...overrides,
			safeAccountSingleton: overrides.safeAccountSingleton ?? ak.Safe_L2_V1_5_0,
		});
	}

	static createAccountAddress(owners, overrides = {}) {
		return ak.SafeAccountV0_3_0.createAccountAddress(owners, {
			...overrides,
			safeAccountSingleton: overrides.safeAccountSingleton ?? ak.Safe_L2_V1_5_0,
		});
	}
}

describe("initializeNewAccount runtime type (#116)", () => {
	test("a subclass factory returns the subclass", () => {
		const account = SubclassAccount.initializeNewAccount([OWNER]);
		expect(account).toBeInstanceOf(SubclassAccount);
		expect(account).toBeInstanceOf(ak.SafeAccountV0_3_0);
	});

	test("the subclass factory applies its own defaults", () => {
		const account = SubclassAccount.initializeNewAccount([OWNER]);
		expect(account.safeAccountSingleton).toEqual(ak.Safe_L2_V1_5_0);
		expect(account.accountAddress).toBe(SubclassAccount.createAccountAddress([OWNER]));
		expect(account.accountAddress).not.toBe(ak.SafeAccountV0_3_0.createAccountAddress([OWNER]));
	});

	test("SafeAccountV0_3_0.initializeNewAccount still returns a plain SafeAccountV0_3_0", () => {
		const account = ak.SafeAccountV0_3_0.initializeNewAccount([OWNER]);
		expect(account).toBeInstanceOf(ak.SafeAccountV0_3_0);
		expect(account).not.toBeInstanceOf(SubclassAccount);
		expect(account.accountAddress).toBe(ak.SafeAccountV0_3_0.createAccountAddress([OWNER]));
	});

	test("detached base factory call still works", () => {
		const init = ak.SafeAccountV0_3_0.initializeNewAccount;
		const account = init([OWNER]);
		expect(account).toBeInstanceOf(ak.SafeAccountV0_3_0);
		expect(account.accountAddress).toBe(ak.SafeAccountV0_3_0.createAccountAddress([OWNER]));
	});

	test("detached subclass factory call degrades to the base with the subclass defaults applied", () => {
		const init = SubclassAccount.initializeNewAccount;
		const account = init([OWNER]);
		expect(account).toBeInstanceOf(ak.SafeAccountV0_3_0);
		expect(account.accountAddress).toBe(SubclassAccount.createAccountAddress([OWNER]));
	});
});
