import {
	Wallet,
} from "ethers";
import { SafeAccount } from "./SafeAccount";
import {
	MetaTransaction,
	StateOverrideSet,
	UserOperation,
} from "../../types";
import {
	createCallData,
	fetchAccountNonce,
	fetchGasPrice,
} from "../../utils";
import { UserOperationDummyValues, ZeroAddress } from "../../constants";
import {
	CreateUserOperationOverrides,
	InitCodeOverrides,
} from "./types";
import { Bundler } from "src/Bundler";
import { AbstractionKitError } from "src/errors";
import { SafeAccountFactory } from "src/factory/SafeAccountFactory";

export class SafeAccountV0_2_0 extends SafeAccount {

	constructor(
		accountAddress: string,
		safe4337ModuleAddress: string = SafeAccountV0_2_0.DEFAULT_SAFE_4337_MODULE_ADDRESS,
		entrypointAddress: string = SafeAccountV0_2_0.DEFAULT_ENTRYPOINT_ADDRESS,
	) {
		super(accountAddress, safe4337ModuleAddress, entrypointAddress);
	}
	/**
	 * To create and initialize a SafeAccount object from its
	 * initial owners
	 * @remarks
	 * initializeNewAccount only needed when the smart account
	 * have not been deployed yet and the account address is unknown.
	 * @param owners - list of account owners addresses
	 * @param overrides - override values to change the initialization default values
	 * @returns a SafeAccount object
	 */
	public static initializeNewAccount(
		owners: string[],
		overrides: InitCodeOverrides = {},
	): SafeAccountV0_2_0 {
		const [accountAddress, initCode] =
		SafeAccountV0_2_0.createAccountAddressAndInitCode(owners, overrides);
		const safe = new SafeAccountV0_2_0(accountAddress);
		safe.initCode = initCode;
		return safe;
	}
	
	/**
	 * calculate account addressfrom initial owners
	 * @param owners - list of account owners addresses
	 * @param overrides - override values to change the initialization default values
	 * @returns account address
	 */
	public static createAccountAddress(
		owners: string[],
		overrides: InitCodeOverrides = {},
	): string {
		const [address, ] = SafeAccountV0_2_0.createAccountAddressAndInitCode(
			owners,
			overrides,
		);
		return address;
	}

	/**
	 * calculate account address and initcode from owners
	 * @param owners - list of account owners addresses
	 * @param overrides - override values to change the initialization default values
	 * @returns account address and initcode
	 */
	public static createAccountAddressAndInitCode(
		owners: string[],
		overrides: InitCodeOverrides = {},
	): [string, string] {
		if (owners.length < 1) {
			throw RangeError("There should be at least one owner");
		}

		const threshold = overrides.threshold ?? 1;
		const c2Nonce = (overrides.c2Nonce as bigint) ?? 0n;
		const singletonAddress =
			overrides.singletonAddress ?? SafeAccount.DEFAULT_SINGLETON_ADDRESS;
		const safe4337ModuleAddress =
			overrides.safe4337ModuleAddress ??
			SafeAccount.DEFAULT_SAFE_4337_MODULE_ADDRESS;
		const addModuleLibAddress =
			overrides.addModuleLibAddress ??
			SafeAccount.DEFAULT_ADD_MODULE_LIB_ADDRESS;

		let safeAccountFactory: SafeAccountFactory = new SafeAccountFactory();
		if (overrides.safeAccountFactoryAddress != null) {
			safeAccountFactory = new SafeAccountFactory(
				overrides.safeAccountFactoryAddress,
			);
		}

		const initializerCallData = SafeAccountV0_2_0.createInitializerCallData(
			owners,
			threshold,
			safe4337ModuleAddress,
			addModuleLibAddress,
		);

		const sender = this.createProxyAddress(
			initializerCallData,
			c2Nonce,
			safeAccountFactory.address,
			singletonAddress,
		);

		const generatorFunctionInputParameters = [
			singletonAddress,
			initializerCallData,
			c2Nonce,
		];

		const initCode = safeAccountFactory.getFactoryGeneratorFunctionCallData(
			generatorFunctionInputParameters,
		);

		return [sender, initCode];
	}

	protected static createInitializerCallData(
		owners: string[],
		threshold: number,
		safe4337ModuleAddress: string = SafeAccount.DEFAULT_SAFE_4337_MODULE_ADDRESS,
		addModuleLibAddress: string = SafeAccount.DEFAULT_ADD_MODULE_LIB_ADDRESS,
	): string {
		if (owners.length < 1) {
			throw RangeError("There should be at least one owner");
		}

		if (threshold < 1) {
			throw RangeError("threshold should be at least one");
		}

		if (threshold > owners.length) {
			throw RangeError("threshold can't be larger than number of owners");
		}

		const enable4337ModuleCallData = createCallData(
			"0x8d0dc49f", //enableModules
			["address[]"],
			[[safe4337ModuleAddress]],
		);

		const initializerFunctionInputParameters = [
			owners, //_owners
			threshold, //_threshold
			addModuleLibAddress, //to Contract address for optional delegate call during initialization
			enable4337ModuleCallData, //Data payload for optional delegate call during initialization
			safe4337ModuleAddress, //fallbackHandler Handler for fallback calls to this contract
			ZeroAddress, //paymentToken (Safe specific, can be ignored)
			0, //payment (Safe specific, can be ignored)
			ZeroAddress, //paymentReceiver (Safe specific, can be ignored)
		];

		return createCallData(
			SafeAccount.initializerFunctionSelector,
			SafeAccount.initializerFunctionInputAbi,
			initializerFunctionInputParameters,
		);
	}

	/**
	 * create account initcode
	 * @param owners - list of account owners addresses
	 * @param threshold - for owners signatures
	 * @param c2Nonce - create2 nonce
	 * @param singletonAddress - Safe singleton address
	 * @param safeAccountFactory - SafeAccountFactory object
	 * @param safe4337ModuleAddress - Safe 4337 module address
	 * @param addModuleLibAddress - addModuleLib Address
	 * @returns initcode
	 */
	public static createInitCode(
		owners: string[],
		threshold: number = 1,
		c2Nonce: bigint = 0n,
		singletonAddress: string = SafeAccount.DEFAULT_SINGLETON_ADDRESS,
		safeAccountFactory: SafeAccountFactory = new SafeAccountFactory(),
		safe4337ModuleAddress: string = SafeAccount.DEFAULT_SAFE_4337_MODULE_ADDRESS,
		addModuleLibAddress: string = SafeAccount.DEFAULT_ADD_MODULE_LIB_ADDRESS,
	): string {
		if (owners.length < 1) {
			throw RangeError("There should be at least one owner");
		}

		if (threshold < 1) {
			throw RangeError("threshold should be at least one");
		}

		if (threshold > owners.length) {
			throw RangeError("threshold can't be larger than number of owners");
		}

		if (c2Nonce < 0n) {
			throw RangeError("c2Nonce can't be negative");
		}

		const initializerCallData = SafeAccountV0_2_0.createInitializerCallData(
			owners,
			threshold,
			safe4337ModuleAddress,
			addModuleLibAddress,
		);

		const generatorFunctionInputParameters = [
			singletonAddress,
			initializerCallData,
			c2Nonce,
		];

		const factoryGeneratorFunctionCallData =
			safeAccountFactory.getFactoryGeneratorFunctionCallData(
				generatorFunctionInputParameters,
			);

		return factoryGeneratorFunctionCallData;
	}

	/**
	 * a non static wrapper function for  prependTokenPaymasterApproveToCallDataStatic
	 * which adds a token approve call to the call data for a token paymaster
	 * @returns callData
	 */
	public prependTokenPaymasterApproveToCallData(
		callData: string,
		tokenAddress: string,
		paymasterAddress: string,
		approveAmount: bigint,
		multisendContractAddress: string = SafeAccountV0_2_0.DEFAULT_MULTISEND_CONTRACT_ADDRESS,
	): string {
		return SafeAccountV0_2_0.prependTokenPaymasterApproveToCallDataStatic(
			callData,
			tokenAddress,
			paymasterAddress,
			approveAmount,
			multisendContractAddress,
		);
	}

	/**
	 * estimate gas limits for a useroperation
	 * @param userOperation - useroperation to estimate gas for
	 * @param bundlerRpc - bundler rpc for gas estimation
	 * @param state_override_set - state override values to set during gs estimation
	 * @param numberOfSigners - number of sigers
	 * @returns promise with [preVerificationGas, verificationGasLimit, callGasLimit]
	 */
	public async estimateUserOperationGas(
		userOperation: UserOperation,
		bundlerRpc: string,
		state_override_set?: StateOverrideSet,
		numberOfSigners: number = 1,
	): Promise<[bigint, bigint, bigint]> {
		if (numberOfSigners < 1n) {
			throw RangeError("numberOfSigners can't be less than 1");
		}

		let signatures = "";
		for (let i = 0; i < numberOfSigners; i++) {
			signatures =
				signatures +
				"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
		}
		userOperation.signature = "0xffffffffffffffffffffffff" + signatures;
		const bundler = new Bundler(bundlerRpc);

        const inputMaxFeePerGas = userOperation.maxFeePerGas
        const inputMaxPriorityFeePerGas = userOperation.maxPriorityFeePerGas
        userOperation.maxFeePerGas = 0n
        userOperation.maxPriorityFeePerGas = 0n

		const estimation = await bundler.estimateUserOperationGas(
			userOperation,
			this.entrypointAddress,
			state_override_set,
		);
        userOperation.maxFeePerGas = inputMaxFeePerGas
        userOperation.maxPriorityFeePerGas = inputMaxPriorityFeePerGas

		const preVerificationGas = BigInt(estimation.preVerificationGas);
		const verificationGasLimit =
			BigInt(estimation.verificationGasLimit) + BigInt(numberOfSigners) * 5000n;
		const callGasLimit = BigInt(estimation.callGasLimit);

		return [preVerificationGas, verificationGasLimit, callGasLimit];
	}

	/**
	 * createUserOperation will determine the nonce, fetch the gas prices,
	 * estimate gas limits and return a useroperation to be signed.
	 * you can override all these values using the overrides parameter.
	 * @param transactions - metatransaction list to be encoded
	 * @param providerRpc - node rpc to fetch account nonce and gas prices
	 * @param bundlerRpc - bundler rpc for gas estimation
	 * @param overrids - overrides values to change default values
	 * @returns promise with useroperation
	 */
	public async createUserOperation(
		transactions: MetaTransaction[],
		providerRpc?: string,
		bundlerRpc?: string,
		overrids: CreateUserOperationOverrides = {},
	): Promise<UserOperation> {
		if (transactions.length < 1) {
			throw RangeError("There should be at least one transaction");
		}

		let nonce = 0n as bigint;

		if (overrids.nonce == null) {
			if (providerRpc != null) {
				nonce = await fetchAccountNonce(
					providerRpc,
					this.entrypointAddress,
					this.accountAddress,
				);
			} else {
				throw new AbstractionKitError(
					"BAD_DATA",
					"providerRpc cant't be null if nonce is not overriden",
				);
			}
		} else {
			nonce = overrids.nonce;
		}

		let initCode = overrids.initCode ?? this.initCode;

		if (initCode == null || nonce > 0n) {
			initCode = "0x";
		}

		if (nonce < 0n) {
			throw RangeError("nonce can't be negative");
		}

		let callData = "0x" as string;
		if (overrids.callData == null) {
			if (transactions.length == 1) {
				callData = SafeAccountV0_2_0.createAccountCallDataSingleTransaction(
					transactions[0],
				);
			} else {
				callData =
					SafeAccountV0_2_0.createAccountCallDataBatchTransactions(
						transactions,
					);
			}
		} else {
			callData = overrids.callData;
		}

		let maxFeePerGas = UserOperationDummyValues.maxFeePerGas;
		let maxPriorityFeePerGas = UserOperationDummyValues.maxPriorityFeePerGas;
		if (
			overrids.maxFeePerGas == null ||
			overrids.maxPriorityFeePerGas == null
		) {
			if (providerRpc != null) {
				[maxFeePerGas, maxPriorityFeePerGas] = await fetchGasPrice(providerRpc);
			} else {
				throw new AbstractionKitError(
					"BAD_DATA",
					"providerRpc cant't be null if maxFeePerGas and maxPriorityFeePerGas are not overriden",
				);
			}
		}
		if (
			typeof overrids.maxFeePerGas === "bigint" &&
			overrids.maxFeePerGas < 0n
		) {
			throw RangeError("maxFeePerGas overrid can't be negative");
		}

		if (
			typeof overrids.maxPriorityFeePerGas === "bigint" &&
			overrids.maxPriorityFeePerGas < 0n
		) {
			throw RangeError("maxPriorityFeePerGas overrid can't be negative");
		}

		maxFeePerGas =
			overrids.maxFeePerGas ??
			maxFeePerGas *
				BigInt(
					Math.floor(
						((overrids.maxFeePerGasPercentageMultiplier ?? 0) + 100) / 100,
					),
				);
		maxPriorityFeePerGas =
			overrids.maxPriorityFeePerGas ??
			maxPriorityFeePerGas *
				BigInt(
					Math.floor(
						((overrids.maxPriorityFeePerGasPercentageMultiplier ?? 0) + 100) /
							100,
					),
				);

		const userOperation: UserOperation = {
			...UserOperationDummyValues,
			sender: this.accountAddress,
			nonce: nonce,
			initCode: initCode,
			callData: callData,
			maxFeePerGas: maxFeePerGas,
			maxPriorityFeePerGas: maxPriorityFeePerGas,
		};

		let preVerificationGas = UserOperationDummyValues.preVerificationGas;
		let verificationGasLimit = UserOperationDummyValues.verificationGasLimit;
		let callGasLimit = UserOperationDummyValues.callGasLimit;
		if (
			overrids.preVerificationGas == null ||
			overrids.verificationGasLimit == null ||
			overrids.callGasLimit == null
		) {
			if (bundlerRpc != null) {
				[preVerificationGas, verificationGasLimit, callGasLimit] =
					await this.estimateUserOperationGas(
						userOperation,
						bundlerRpc,
						overrids.state_override_set,
						overrids.numberOfSigners,
					);
			} else {
				throw new AbstractionKitError(
					"BAD_DATA",
					"bundlerRpc cant't be null if preVerificationGas,verificationGasLimit and callGasLimit are not overriden",
				);
			}
		}
		if (
			typeof overrids.preVerificationGas === "bigint" &&
			overrids.preVerificationGas < 0n
		) {
			throw RangeError("preVerificationGas overrid can't be negative");
		}

		if (
			typeof overrids.verificationGasLimit === "bigint" &&
			overrids.verificationGasLimit < 0n
		) {
			throw RangeError("verificationGasLimit overrid can't be negative");
		}

		if (
			typeof overrids.callGasLimit === "bigint" &&
			overrids.callGasLimit < 0n
		) {
			throw RangeError("callGasLimit overrid can't be negative");
		}
		userOperation.preVerificationGas =
			overrids.preVerificationGas ??
			preVerificationGas *
				BigInt(
					Math.floor(
						((overrids.preVerificationGasPercentageMultiplier ?? 0) + 100) /
							100,
					),
				);

		userOperation.verificationGasLimit =
			overrids.verificationGasLimit ??
			verificationGasLimit *
				BigInt(
					Math.floor(
						((overrids.verificationGasLimitPercentageMultiplier ?? 0) + 100) /
							100,
					),
				);

		userOperation.callGasLimit =
			overrids.callGasLimit ??
			callGasLimit *
				BigInt(
					Math.floor(
						((overrids.callGasLimitPercentageMultiplier ?? 0) + 100) / 100,
					),
				);

		return userOperation;
	}

	/**
	 * create a useroperation signature
	 * @param useroperation - useroperation to sign
	 * @param privateKeys - for the signers
	 * @param chainId - target chain id
	 * @param validAfter - timestamp the signature will be valid after
	 * @param validUntil - timestamp the signature will be valid until
	 * @returns signature
	 */
	public signUserOperation(
		useroperation: UserOperation,
		privateKeys: string[],
		chainId: bigint,
		validAfter: bigint = 0n,
		validUntil: bigint = 0n,
	): string {
		if (privateKeys.length < 1) {
			throw RangeError("There should be at least one privateKey");
		}
		if (chainId < 0n) {
			throw RangeError("chainId can't be negative");
		}
		if (validAfter < 0n) {
			throw RangeError("validAfter can't be negative");
		}
		if (validUntil < 0n) {
			throw RangeError("validUntil can't be negative");
		}

		const userOperationEip712Hash = SafeAccount.getUserOperationEip712Hash(
			useroperation,
			chainId,
			validAfter,
			validUntil,
			this.entrypointAddress
		)

		const signersAddresses = [];
		const signatures = [];
		for (const privateKey of privateKeys) {
			const wallet = new Wallet(privateKey);
			const SignerSignaturePair = wallet.signingKey.sign(
				userOperationEip712Hash,
			).serialized;
			signersAddresses.push(wallet.address);
			signatures.push(SignerSignaturePair);
		}

		return SafeAccountV0_2_0.formatEip712SignaturesToUseroperationSignature(
			signersAddresses,
			signatures,
			validAfter,
			validUntil,
		);
	}
}
