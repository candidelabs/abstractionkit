import {
	fromEthersWallet,
	fromPrivateKey,
	fromSafeWebauthn,
	type ExternalSigner,
	type MultiOpSignContext,
	type SignContext,
	type TypedData,
	type UserOperationV9,
} from "../../src/index";

const address = "0x0000000000000000000000000000000000000001" as const;
const signature = "0x1234" as `0x${string}`;

const hashOnlySigner: ExternalSigner = {
	address,
	signHash: async (_hash) => signature,
};

const typedDataOnlySigner: ExternalSigner = {
	address,
	signTypedData: async (_typedData) => signature,
};

const dualSchemeSigner: ExternalSigner<SignContext<UserOperationV9>> = {
	address,
	signHash: async (_hash, context) => {
		context.userOperation.sender;
		context.chainId;
		context.entryPoint;
		return signature;
	},
	signTypedData: async (_typedData, context) => {
		context.userOperation.sender;
		return signature;
	},
};

const multiOpSigner: ExternalSigner<MultiOpSignContext<UserOperationV9>> = {
	address,
	signHash: async (_hash, context) => {
		context.userOperations[0]?.chainId;
		context.entryPoint;
		return signature;
	},
};

const typedData: TypedData = {
	domain: {
		name: "Safe",
		version: "1",
		chainId: 1n,
		verifyingContract: address,
	},
	types: {
		SafeOp: [{ name: "sender", type: "address" }],
	},
	primaryType: "SafeOp",
	message: { sender: address },
};

void typedData;
void hashOnlySigner;
void typedDataOnlySigner;
void dualSchemeSigner;
void multiOpSigner;

const universalSigner: ExternalSigner<unknown> = fromPrivateKey(`0x${"11".repeat(32)}`);
void universalSigner;

const ethersLikeSigner = fromEthersWallet({
	address,
	signingKey: {
		sign: () => ({ serialized: signature }),
	},
	signTypedData: async () => signature,
});
void ethersLikeSigner;

const webauthnSigner: ExternalSigner<unknown> = fromSafeWebauthn({
	publicKey: { x: 1n, y: 2n },
	isInit: true,
	accountClass: {
		DEFAULT_WEB_AUTHN_SHARED_SIGNER: address,
		DEFAULT_WEB_AUTHN_SIGNER_FACTORY: address,
		DEFAULT_WEB_AUTHN_SIGNER_SINGLETON: address,
		DEFAULT_WEB_AUTHN_SIGNER_PROXY_CREATION_CODE: "0x00",
		DEFAULT_WEB_AUTHN_PRECOMPILE: address,
		DEFAULT_WEB_AUTHN_CONTRACT_VERIFIER: address,
	},
	getAssertion: async () => ({
		authenticatorData: new Uint8Array(37).buffer,
		clientDataFields: "0x",
		rs: [1n, 2n],
	}),
});
void webauthnSigner;
