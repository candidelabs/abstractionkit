export { Calibur7702Account } from "./account/Calibur/Calibur7702Account";
export type {
	CaliburCreateUserOperationOverrides,
	CaliburKey,
	CaliburKeySettings,
	CaliburKeySettingsResult,
	CaliburSignatureOverrides,
	WebAuthnSignatureData,
} from "./account/Calibur/types";
export { CaliburKeyType } from "./account/Calibur/types";
export type { Allowance } from "./account/Safe/modules/AllowanceModule";
export {
	ALLOWANCE_MODULE_V0_1_0_ADDRESS,
	AllowanceModule,
} from "./account/Safe/modules/AllowanceModule";
export type {
	RecoveryRequest,
	RecoveryRequestTypedDataDomain,
	RecoveryRequestTypedMessageValue,
	RecoverySignaturePair,
} from "./account/Safe/modules/SocialRecoveryModule";
// ViemLocalAccountLike / ViemWalletClientLike / EthersWalletLike are NOT
// exported. They're internal structural shapes the adapters match against;
// callers pass concrete viem / ethers instances directly. If you need the
// input type for a wrapper, use `Parameters<typeof fromViem>[0]` etc.
export {
	EIP712_RECOVERY_MODULE_TYPE,
	EXECUTE_RECOVERY_PRIMARY_TYPE,
	SocialRecoveryModule,
	SocialRecoveryModuleGracePeriodSelector,
} from "./account/Safe/modules/SocialRecoveryModule";
export { SafeAccountV0_2_0 } from "./account/Safe/SafeAccountV0_2_0";
export { SafeAccountV0_3_0 } from "./account/Safe/SafeAccountV0_3_0";
export { SafeAccountV1_5_0_M_0_3_0 } from "./account/Safe/SafeAccountV1_5_0_M_0_3_0";
export { SafeMultiChainSigAccountV1 } from "./account/Safe/SafeMultiChainSigAccount";
export type {
	SafeMessageTypedDataDomain,
	SafeMessageTypedMessageValue,
} from "./account/Safe/safeMessage";
export {
	getSafeMessageEip712Data,
	SAFE_MESSAGE_MODULE_TYPE,
	SAFE_MESSAGE_PRIMARY_TYPE,
} from "./account/Safe/safeMessage";
export type {
	CreateUserOperationV6Overrides,
	CreateUserOperationV7Overrides,
	CreateUserOperationV9Overrides,
	ECDSAPublicAddress,
	InitCodeOverrides,
	SafeUserOperationTypedDataDomain,
	Signer,
	SignerSignaturePair,
	WebauthnPublicKey,
	WebauthnSignatureData,
} from "./account/Safe/types";
export {
	EOADummySignerSignaturePair,
	SafeModuleExecutorFunctionSelector,
	WebauthnDummySignerSignaturePair,
} from "./account/Safe/types";
export { SendUseroperationResponse } from "./account/SendUseroperationResponse";
export { SmartAccount } from "./account/SmartAccount";
export { Simple7702Account } from "./account/simple/Simple7702Account";
export { Simple7702AccountV09 } from "./account/simple/Simple7702AccountV09";

export { Bundler } from "./Bundler";
export {
	BaseUserOperationDummyValues,
	CALIBUR_CANDIDE_V0_1_0_SINGLETON_ADDRESS,
	CALIBUR_UNISWAP_V1_0_0_SINGLETON_ADDRESS,
	DEFAULT_SECP256R1_PRECOMPILE_ADDRESS,
	EIP712_MULTI_CHAIN_OPERATIONS_PRIMARY_TYPE,
	EIP712_MULTI_CHAIN_OPERATIONS_TYPE,
	EIP712_SAFE_OPERATION_PRIMARY_TYPE,
	EIP712_SAFE_OPERATION_V6_TYPE,
	EIP712_SAFE_OPERATION_V7_TYPE,
	ENTRYPOINT_V6,
	ENTRYPOINT_V7,
	ENTRYPOINT_V8,
	ENTRYPOINT_V9,
	ZeroAddress,
} from "./constants";
export { AbstractionKitError } from "./errors";
export { SafeAccountFactory } from "./factory/SafeAccountFactory";
export { SmartAccountFactory } from "./factory/SmartAccountFactory";
export { ExperimentalAllowAllParallelPaymaster } from "./paymaster/AllowAllPaymaster";
export { CandidePaymaster } from "./paymaster/CandidePaymaster";
export type {
	Erc7677Context,
	Erc7677PaymasterFields,
	Erc7677StubDataResult,
} from "./paymaster/Erc7677Paymaster";
export { Erc7677Paymaster } from "./paymaster/Erc7677Paymaster";
export type {
	AnyUserOperation,
	CandidePaymasterContext,
	Erc7677PaymasterConstructorOptions,
	Erc7677Provider,
	GasPaymasterUserOperationOverrides,
	PrependTokenPaymasterApproveAccount,
	SameUserOp,
} from "./paymaster/types";
export {
	createWorldIdSignal,
	WorldIdPermissionlessPaymaster,
} from "./paymaster/WorldIdPermissionlessPaymaster";
export type {
	FromSafeWebauthnParams,
	WebauthnAssertionFetcher,
} from "./account/Safe/adapters";
export { fromSafeWebauthn } from "./account/Safe/adapters";
export {
	fromEthersWallet,
	fromPrivateKey,
	fromViem,
	fromViemWalletClient,
} from "./signer/adapters";
// ─── Signer interface design (capability-oriented) ──────────────────────
// Exported as `ExternalSigner` because the old package-level `Signer` is
// already taken by an owner-identifier union in Safe/types. An eventual
// rename there would promote this to the unqualified `Signer`.
export type {
	MultiOpSignContext,
	SignContext,
	Signer as ExternalSigner,
	SignHashFn,
	SigningScheme,
	SignTypedDataFn,
	TypedData,
} from "./signer/types";
export type {
	AbiInputValue,
	GasEstimationResult,
	JsonRpcError,
	JsonRpcParam,
	JsonRpcResponse,
	JsonRpcResult,
	MetaTransaction,
	ParallelPaymasterInitValues,
	SponsorInfo,
	SponsorMetadata,
	StateOverrideSet,
	TokenQuote,
	UserOperationByHashResult,
	UserOperationReceipt,
	UserOperationReceiptResult,
	UserOperationV6,
	UserOperationV7,
	UserOperationV8,
	UserOperationV9,
} from "./types";

export { GasOption, Operation, PolygonChain } from "./types";
export type { DepositInfo } from "./utils";
export {
	calculateUserOperationMaxGasCost,
	createCallData,
	createUserOperationHash,
	fetchAccountNonce,
	fetchGasPrice,
	getBalanceOf,
	getDelegatedAddress,
	getDepositInfo,
	getFunctionSelector,
	sendJsonRpcRequest,
} from "./utils";
export type { Authorization7702, Authorization7702Hex } from "./utils7702";
export {
	createAndSignEip7702DelegationAuthorization,
	createAndSignEip7702RawTransaction,
	createAndSignLegacyRawTransaction,
	createEip7702DelegationAuthorizationHash,
	createEip7702TransactionHash,
	signHash,
} from "./utils7702";
export {
	callTenderlySimulateBundle,
	shareTenderlySimulationAndCreateLink,
	simulateSenderCallDataWithTenderly,
	simulateSenderCallDataWithTenderlyAndCreateShareLink,
	simulateUserOperationCallDataWithTenderly,
	simulateUserOperationCallDataWithTenderlyAndCreateShareLink,
	simulateUserOperationWithTenderly,
	simulateUserOperationWithTenderlyAndCreateShareLink,
} from "./utilsTenderly";
