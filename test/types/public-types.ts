// Compile-time check that the types appearing in public signatures can be
// imported from the package entry point. Several were declared and used by
// exported classes and functions but not exported themselves, so a consumer
// could not name the type of `AbstractionKitError.code`, of a Tenderly
// simulation result, or of `Safe_L2_V1_5_0`.
import {
	AbstractionKitError,
	AllowanceModule,
	ALLOWANCE_MODULE_V0_1_1_ADDRESS,
	SafeAccountV0_3_0,
	SafeModule,
	Safe_L2_V1_5_0,
	decodeUserOperationRevertReason,
	type AddressToState,
	type BasicErrorCode,
	type BundlerErrorCode,
	type ERC20Token,
	type ERC20TokenWithExchangeRate,
	type JsonRpcErrorCode,
	type OnChainIdentifierParamsType,
	type PaymasterMetadata,
	type SafeAccountSingleton,
	type SafeSignatureOptions,
	type SingleTransactionTenderlySimulationResult,
	type StateOverrideSet,
	type SupportedERC20TokensAndMetadata,
	type SupportedERC20TokensAndMetadataWithExchangeRate,
	type TenderlySimulationResult,
	type UserOperationReceiptResult,
	type UserOperationRevert,
	type WebAuthnSignatureOverrides,
} from "../../src/index";

declare const error: AbstractionKitError;
const code: BundlerErrorCode | BasicErrorCode | JsonRpcErrorCode = error.code;

const singleton: SafeAccountSingleton = Safe_L2_V1_5_0;
const identifier: OnChainIdentifierParamsType = { project: "p" };
const account = new SafeAccountV0_3_0("0x0000000000000000000000000000000000000001", {
	safeAccountSingleton: singleton,
	onChainIdentifierParams: identifier,
});

const module: SafeModule = new AllowanceModule(ALLOWANCE_MODULE_V0_1_1_ADDRESS);

declare const overrideSet: StateOverrideSet;
const state: AddressToState | undefined = overrideSet;

declare const simulation: TenderlySimulationResult;
const first: SingleTransactionTenderlySimulationResult | undefined = simulation[0];

declare const supported: SupportedERC20TokensAndMetadata;
const metadata: PaymasterMetadata = supported.paymasterMetadata;
const token: ERC20Token | undefined = supported.tokens[0];
declare const withRates: SupportedERC20TokensAndMetadataWithExchangeRate;
const tokenWithRate: ERC20TokenWithExchangeRate | undefined = withRates.tokens[0];

const signatureOptions: SafeSignatureOptions = { validAfter: 0n, validUntil: 0n };
const webAuthnOverrides: WebAuthnSignatureOverrides = { isInit: false };

// the fields added for failures outside the account call
declare const receipt: NonNullable<UserOperationReceiptResult>;
const revert: UserOperationRevert = decodeUserOperationRevertReason(receipt);
const postOpReverted: boolean | undefined = revert.postOpReverted;
const prefundTooLow: boolean | undefined = revert.prefundTooLow;

void code;
void account;
void module;
void state;
void first;
void metadata;
void token;
void tokenWithRate;
void signatureOptions;
void webAuthnOverrides;
void postOpReverted;
void prefundTooLow;
