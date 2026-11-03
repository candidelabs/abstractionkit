// The exported Safe singleton init hashes are keccak256(proxyCreationCode ++
// abi.encode(singleton)), the CREATE2 init-code hash the SafeProxyFactory
// uses. Recompute them from the factory's proxyCreationCode (fixture captured
// from mainnet) so a typo in either constant fails offline instead of
// surfacing as a wrong counterfactual address.
const { keccak256, concat, zeroPadValue, toBeHex, getCreate2Address } = require("ethers");
const ak = require("../../dist/index.cjs");
const fixture = require("./fixtures/safeProxyCreationCode.json");

const initHashFor = (singleton) =>
	keccak256(concat([fixture.proxyCreationCode, zeroPadValue(singleton.singletonAddress, 32)]));

describe("Safe singleton init hashes", () => {
	test.each([
		["Safe_L2_V1_4_1", ak.Safe_L2_V1_4_1],
		["Safe_L2_V1_5_0", ak.Safe_L2_V1_5_0],
	])("%s.singletonInitHash matches the proxy creation code", (_name, singleton) => {
		expect(initHashFor(singleton)).toBe(singleton.singletonInitHash);
	});

	test("the two singletons differ in address and hash", () => {
		expect(ak.Safe_L2_V1_5_0.singletonAddress).not.toBe(ak.Safe_L2_V1_4_1.singletonAddress);
		expect(ak.Safe_L2_V1_5_0.singletonInitHash).not.toBe(ak.Safe_L2_V1_4_1.singletonInitHash);
	});

	test("createProxyAddress is CREATE2 over the default factory with that init hash", () => {
		const initializer = "0x" + "cd".repeat(40);
		const nonce = 7n;
		const salt = keccak256(concat([keccak256(initializer), toBeHex(nonce, 32)]));
		for (const singleton of [ak.Safe_L2_V1_4_1, ak.Safe_L2_V1_5_0]) {
			const expected = getCreate2Address(fixture.factory, salt, singleton.singletonInitHash);
			expect(
				ak.SafeAccountV0_3_0.createProxyAddress(initializer, {
					c2Nonce: nonce,
					singletonInitHash: singleton.singletonInitHash,
				}),
			).toBe(expected);
		}
	});
});
