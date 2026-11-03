// Compile-time checks for SafeMultiChainSigAccountV2 and the renamed migration
// helper. V1 and V2 instances are structurally identical, so this cannot
// assert type identity; it pins the surface callers rely on.
import {
	type MetaTransaction,
	SafeAccountV0_3_0,
	SafeMultiChainSigAccountV1,
	SafeMultiChainSigAccountV2,
	Safe_L2_V1_4_1,
	Safe_L2_V1_5_0,
	type UserOperationV9,
} from "../../src/index";

const address = "0x0000000000000000000000000000000000000001" as const;

// Static factories accept the singleton override and return a V2-typed instance.
const v2: SafeMultiChainSigAccountV2 = SafeMultiChainSigAccountV2.initializeNewAccount([address], {
	safeAccountSingleton: Safe_L2_V1_4_1,
});
const v2Address: string = SafeMultiChainSigAccountV2.createAccountAddress([address], {
	safeAccountSingleton: Safe_L2_V1_5_0,
});
const [factory, factoryData]: [string, string] =
	SafeMultiChainSigAccountV2.createFactoryAddressAndData([address]);
const proxy: string = SafeMultiChainSigAccountV2.createProxyAddress("0x", {
	singletonInitHash: Safe_L2_V1_5_0.singletonInitHash,
});
void v2Address;
void factory;
void factoryData;
void proxy;

// A V2 instance is usable wherever a V1 is expected (same module and EntryPoint).
const asV1: SafeMultiChainSigAccountV1 = v2;
void asV1;

// createUserOperation returns a UserOperationV9.
const op: Promise<UserOperationV9> = v2.createUserOperation([], "http://localhost:8545", "http://localhost:4337");
void op;

// The renamed migration helper and its deprecated alias share one signature.
const account = new SafeAccountV0_3_0(address);
const renamed: Promise<MetaTransaction[]> = account.createMigrateToSafeMultiChainSigAccountMetaTransactions(
	"http://localhost:8545",
	{ skipPreflight: true },
);
const aliased: Promise<MetaTransaction[]> = account.createMigrateToSafeMultiChainSigAccountV1MetaTransactions(
	"http://localhost:8545",
	{ skipPreflight: true },
);
void renamed;
void aliased;

// @ts-expect-error unknown override keys are rejected on the alias as on the new name
void account.createMigrateToSafeMultiChainSigAccountV1MetaTransactions("http://localhost:8545", { bogus: true });
