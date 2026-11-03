// The removed SafeAccountV1_5_0_M_0_3_0 ran passkey accounts on EntryPoint
// v0.7 with the RIP-7951 precompile and the Daimo P-256 verifier, on top of
// SafeAccountV0_3_0's Passkey module v0.2.0 shared signer and factory. Owners
// of those accounts keep using SafeAccountV0_3_0 and pass that verifier pair.
// These checks pin that the pair reproduces the
// removed class's WebAuthn signer address, dummy signature and verifier
// deployment exactly, and that the SafeAccountV0_3_0 defaults do not.
const ak = require("../../dist/index.cjs");

const X = 0x1111111111111111111111111111111111111111111111111111111111111111n;
const Y = 0x2222222222222222222222222222222222222222222222222222222222222222n;
// Produced by SafeAccountV1_5_0_M_0_3_0.createWebAuthnSignerVerifierAddress(X, Y)
// on the last commit that shipped the class (a8c78c0).
const LEGACY_SIGNER = "0x0aF03f63edb290dEe5549D9DeFC0A670F03f3B4B";

const legacyV150Verifiers = {
	eip7212WebAuthnPrecompileVerifier: ak.SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_PRECOMPILE,
	eip7212WebAuthnContractVerifier: ak.SafeMultiChainSigAccountV1.DEFAULT_WEB_AUTHN_CONTRACT_VERIFIER,
};

describe("legacy Safe v1.5.0 / EntryPoint v0.7 passkey accounts on SafeAccountV0_3_0", () => {
	test("the documented verifier pair is RIP-7951 + Daimo", () => {
		expect(legacyV150Verifiers.eip7212WebAuthnPrecompileVerifier).toBe(
			"0x0000000000000000000000000000000000000100",
		);
		expect(legacyV150Verifiers.eip7212WebAuthnContractVerifier).toBe(
			"0xc2b78104907F722DABAc4C69f826a522B2754De4",
		);
	});

	test("the pair reproduces the removed class's signer address; the defaults do not", () => {
		expect(ak.SafeAccountV0_3_0.createWebAuthnSignerVerifierAddress(X, Y, legacyV150Verifiers)).toBe(
			LEGACY_SIGNER,
		);
		expect(ak.SafeAccountV0_3_0.createWebAuthnSignerVerifierAddress(X, Y)).not.toBe(LEGACY_SIGNER);
		// Not interchangeable with the v0.2.1 factory either.
		expect(ak.SafeMultiChainSigAccountV1.createWebAuthnSignerVerifierAddress(X, Y)).not.toBe(
			LEGACY_SIGNER,
		);
	});

	test("dummy signatures and the verifier deployment target the legacy signer", () => {
		const [dummy] = ak.SafeAccountV0_3_0.createDummySignerSignaturePairForExpectedSigners(
			[{ x: X, y: Y }],
			{ isInit: false, ...legacyV150Verifiers },
		);
		expect(dummy.signer).toBe(LEGACY_SIGNER);

		const [dummyDefault] = ak.SafeAccountV0_3_0.createDummySignerSignaturePairForExpectedSigners(
			[{ x: X, y: Y }],
			{ isInit: false },
		);
		expect(dummyDefault.signer).not.toBe(LEGACY_SIGNER);

		const deploy = ak.SafeAccountV0_3_0.createDeployWebAuthnVerifierMetaTransaction(
			X,
			Y,
			legacyV150Verifiers,
		);
		expect(deploy.to).toBe(ak.SafeAccountV0_3_0.DEFAULT_WEB_AUTHN_SIGNER_FACTORY);
		expect(deploy.data.toLowerCase()).toContain(
			legacyV150Verifiers.eip7212WebAuthnContractVerifier.slice(2).toLowerCase(),
		);
	});
});
