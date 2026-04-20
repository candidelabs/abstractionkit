import { AbiCoder } from "ethers";
import { AbstractionKitError } from "./errors";
import type {
	SingleTransactionTenderlySimulationResult,
	TenderlySimulationResult,
	UserOperationV6,
	UserOperationV7,
	UserOperationV8,
	UserOperationV9,
} from "./types";
import { createUserOperationHash, sendJsonRpcRequest } from "./utils";
import type { Authorization7702Hex } from "./utils7702";

/**
 * State override mapping for Tenderly simulations.
 * Maps contract addresses to their overridden state (balance, storage, or stateDiff).
 */
export type OverrideType = Record<string, Record<string, string | Record<string, string>>>;

/**
 * Shares an existing Tenderly simulation so it can be viewed via a public link.
 * @param tenderlyAccountSlug - The Tenderly account slug.
 * @param tenderlyProjectSlug - The Tenderly project slug.
 * @param tenderlyAccessKey - The Tenderly API access key.
 * @param tenderlySimulationId - The ID of the simulation to share.
 */
export async function shareTenderlySimulationAndCreateLink(
	tenderlyAccountSlug: string,
	tenderlyProjectSlug: string,
	tenderlyAccessKey: string,
	tenderlySimulationId: string,
) {
	const tenderlyUrl =
		"https://api.tenderly.co/api/v1/account/" +
		tenderlyAccountSlug +
		"/project/" +
		tenderlyProjectSlug +
		"/simulations/" +
		tenderlySimulationId +
		"/share";

	const headers = {
		Accept: "application/json",
		"Content-Type": "application/json",
		"X-Access-Key": tenderlyAccessKey,
	};

	const requestOptions: RequestInit = {
		method: "POST",
		headers,
		redirect: "follow",
	};
	const fetchResult = await fetch(tenderlyUrl, requestOptions);
	const status = fetchResult.status;

	if (status !== 204) {
		throw new AbstractionKitError("BAD_DATA", "tenderly share simulation failed.", {
			context: {
				tenderlyAccountSlug,
				tenderlyProjectSlug,
				tenderlyAccessKey,
				tenderlySimulationId,
				status,
			},
		});
	}
}

/**
 * Simulates a full UserOperation via Tenderly's handleOps/handleUserOps entry
 * and creates a shareable link.
 * @param tenderlyAccountSlug - The Tenderly account slug.
 * @param tenderlyProjectSlug - The Tenderly project slug.
 * @param tenderlyAccessKey - The Tenderly API access key.
 * @param chainId - The chain ID to simulate on.
 * @param entrypointAddress - The EntryPoint contract address.
 * @param userOperation - The UserOperation to simulate (v0.6, v0.7, or v0.8).
 * @param blockNumber - Optional block number for the simulation.
 * @param stateOverrides - Optional state overrides for the simulation.
 * @returns The simulation result and a shareable dashboard link.
 */
export async function simulateUserOperationWithTenderlyAndCreateShareLink(
	tenderlyAccountSlug: string,
	tenderlyProjectSlug: string,
	tenderlyAccessKey: string,
	chainId: bigint,
	entrypointAddress: string,
	userOperation: UserOperationV6 | UserOperationV7 | UserOperationV8 | UserOperationV9,
	blockNumber: number | null = null,
	stateOverrides?: OverrideType | null,
): Promise<{
	simulation: SingleTransactionTenderlySimulationResult;
	simulationShareLink: string;
}> {
	const simulation = await simulateUserOperationWithTenderly(
		tenderlyAccountSlug,
		tenderlyProjectSlug,
		tenderlyAccessKey,
		chainId,
		entrypointAddress,
		userOperation,
		blockNumber,
		stateOverrides,
	);

	await shareTenderlySimulationAndCreateLink(
		tenderlyAccountSlug,
		tenderlyProjectSlug,
		tenderlyAccessKey,
		simulation.simulation.id,
	);
	const simulationShareLink = `https://dashboard.tenderly.co/shared/simulation/${simulation.simulation.id}`;
	return {
		simulation,
		simulationShareLink,
	};
}

/**
 * Simulates a full UserOperation via the EntryPoint's handleOps/handleUserOps
 * function on Tenderly. Encodes the UserOperation into the appropriate calldata
 * based on the EntryPoint version.
 * @param tenderlyAccountSlug - The Tenderly account slug.
 * @param tenderlyProjectSlug - The Tenderly project slug.
 * @param tenderlyAccessKey - The Tenderly API access key.
 * @param chainId - The chain ID to simulate on.
 * @param entrypointAddress - The EntryPoint contract address.
 * @param userOperation - The UserOperation to simulate (v0.6, v0.7, or v0.8).
 * @param blockNumber - Optional block number for the simulation.
 * @param stateOverrides - Optional state overrides for the simulation.
 * @returns The simulation result from Tenderly.
 */
export async function simulateUserOperationWithTenderly(
	tenderlyAccountSlug: string,
	tenderlyProjectSlug: string,
	tenderlyAccessKey: string,
	chainId: bigint,
	entrypointAddress: string,
	userOperation: UserOperationV6 | UserOperationV7 | UserOperationV8 | UserOperationV9,
	blockNumber: number | null = null,
	stateOverrides?: OverrideType | null,
): Promise<SingleTransactionTenderlySimulationResult> {
	const entrypointAddressLowerCase = entrypointAddress.toLowerCase();
	let callData: string | null = null;
	const abiCoder = AbiCoder.defaultAbiCoder();
	const isV6UserOperation = "initCode" in userOperation;
	const isV6Entrypoint =
		entrypointAddressLowerCase === "0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789";

	if (isV6UserOperation !== isV6Entrypoint) {
		throw new RangeError("UserOperation version does not match entrypoint.");
	}

	if (isV6UserOperation) {
		userOperation = userOperation as UserOperationV6;
		const useroperationValuesArray = [
			userOperation.sender,
			userOperation.nonce,
			userOperation.initCode,
			userOperation.callData,
			userOperation.callGasLimit,
			userOperation.verificationGasLimit,
			userOperation.preVerificationGas,
			userOperation.maxFeePerGas,
			userOperation.maxPriorityFeePerGas,
			userOperation.paymasterAndData,
			userOperation.signature,
		];

		const encodedUserOperation = abiCoder.encode(
			[
				"(address,uint256,bytes,bytes,uint256,uint256,uint256,uint256,uint256,bytes,bytes)[]",
				"address",
			],
			[[useroperationValuesArray], "0x1000000000000000000000000000000000000000"],
		);
		callData = `0x1fad948c${encodedUserOperation.slice(2)}`;
	} else {
		userOperation = userOperation as UserOperationV7 | UserOperationV8 | UserOperationV9;
		let initCode = "0x";
		if (userOperation.factory != null) {
			initCode = userOperation.factory;
			if (userOperation.factoryData != null) {
				initCode += userOperation.factoryData.slice(2);
			}
		}

		const accountGasLimits =
			"0x" +
			abiCoder.encode(["uint128"], [userOperation.verificationGasLimit]).slice(34) +
			abiCoder.encode(["uint128"], [userOperation.callGasLimit]).slice(34);

		const gasFees =
			"0x" +
			abiCoder.encode(["uint128"], [userOperation.maxPriorityFeePerGas]).slice(34) +
			abiCoder.encode(["uint128"], [userOperation.maxFeePerGas]).slice(34);

		let paymasterAndData = "0x";
		if (userOperation.paymaster != null) {
			paymasterAndData = userOperation.paymaster;
			if (userOperation.paymasterVerificationGasLimit != null) {
				paymasterAndData += abiCoder
					.encode(["uint128"], [userOperation.paymasterVerificationGasLimit])
					.slice(34);
			}
			if (userOperation.paymasterPostOpGasLimit != null) {
				paymasterAndData += abiCoder
					.encode(["uint128"], [userOperation.paymasterPostOpGasLimit])
					.slice(34);
			}
			if (userOperation.paymasterData != null) {
				paymasterAndData += userOperation.paymasterData.slice(2);
			}
		}

		const useroperationValuesArray = [
			userOperation.sender,
			userOperation.nonce,
			initCode,
			userOperation.callData,
			accountGasLimits,
			userOperation.preVerificationGas,
			gasFees,
			paymasterAndData,
			userOperation.signature,
		];

		const encodedUserOperation = abiCoder.encode(
			["(address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes)[]", "address"],
			[[useroperationValuesArray], "0x1000000000000000000000000000000000000000"],
		);

		if (
			entrypointAddressLowerCase === "0x0000000071727de22e5e9d8baf0edac6f37da032" ||
			entrypointAddressLowerCase === "0x4337084d9e255ff0702461cf8895ce9e3b5ff108" ||
			entrypointAddressLowerCase === "0x433709009b8330fda32311df1c2afa402ed8d009"
		) {
			callData = `0x765e827f${encodedUserOperation.slice(2)}`;
		} else {
			throw new RangeError("Invalid entrypoint.");
		}
	}

	// For EIP-7702 userOps (factory == "0x7702"), the EntryPoint checks
	// that the sender's code starts with the EIP-7702 delegation prefix
	// (0xef0100). Inject a code state override so the check passes in
	// simulation.
	if (
		!isV6UserOperation &&
		(userOperation as UserOperationV7 | UserOperationV8 | UserOperationV9).factory === "0x7702"
	) {
		const eip7702Auth = (userOperation as UserOperationV8 | UserOperationV9).eip7702Auth;
		if (eip7702Auth != null && eip7702Auth.address != null) {
			const delegationCode = `0xef0100${eip7702Auth.address.toLowerCase().replace("0x", "")}`;
			const senderLower = userOperation.sender.toLowerCase();
			stateOverrides = stateOverrides ? { ...stateOverrides } : {};
			stateOverrides[senderLower] = {
				...(stateOverrides[senderLower] || {}),
				code: delegationCode,
			};
		}
	}

	const simulation = await callTenderlySimulateBundle(
		tenderlyAccountSlug,
		tenderlyProjectSlug,
		tenderlyAccessKey,
		[
			{
				chainId,
				blockNumber,
				from: "0x1000000000000000000000000000000000000000",
				to: entrypointAddress,
				data: callData,
				stateOverrides,
			},
		],
	);
	return simulation[0];
}

/**
 * Base fields shared by all UserOperation versions for Tenderly simulation.
 * Contains the common fields present in every EntryPoint version.
 */
export interface BaseUserOperationToSimulate {
	/** The smart account address that sends the UserOperation. */
	sender: string;
	/** The encoded call data to execute on the account. */
	callData: string;
	/** The account nonce. */
	nonce: bigint;
	/** The gas limit for the main execution call. */
	callGasLimit: bigint;
	/** The gas limit for the verification step. */
	verificationGasLimit: bigint;
	/** The gas overhead to compensate the bundler. */
	preVerificationGas: bigint;
	/** The maximum fee per gas (EIP-1559). */
	maxFeePerGas: bigint;
	/** The maximum priority fee per gas (EIP-1559). */
	maxPriorityFeePerGas: bigint;
	/** The UserOperation signature. */
	signature: string;
}

/**
 * UserOperation fields for Tenderly simulation targeting EntryPoint v0.6.
 * Uses the combined `initCode` and `paymasterAndData` fields.
 */
export interface UserOperationV6ToSimulate extends BaseUserOperationToSimulate {
	/** The concatenated factory address and factory data, or null if already deployed. */
	initCode: string | null;
	/** The concatenated paymaster address and paymaster-specific data. */
	paymasterAndData: string;
}

/**
 * UserOperation fields for Tenderly simulation targeting EntryPoint v0.7.
 * Uses separate factory/paymaster fields instead of combined byte arrays.
 */
export interface UserOperationV7ToSimulate extends BaseUserOperationToSimulate {
	/** The factory contract address, or null if already deployed. */
	factory: string | null;
	/** The factory-specific initialization data, or null if already deployed. */
	factoryData: string | null;
	/** The paymaster contract address. */
	paymaster: string | null;
	/** The gas limit for paymaster verification. */
	paymasterVerificationGasLimit: bigint | null;
	/** The gas limit for paymaster postOp execution. */
	paymasterPostOpGasLimit: bigint | null;
	/** The paymaster-specific data. */
	paymasterData: string | null;
}

/**
 * UserOperation fields for Tenderly simulation targeting EntryPoint v0.8.
 * Extends the v0.7 structure with an additional `eip7702Auth` field for
 * EIP-7702 delegation support.
 */
export interface UserOperationV8ToSimulate extends BaseUserOperationToSimulate {
	/** The factory contract address, or null if already deployed. */
	factory: string | null;
	/** The factory-specific initialization data, or null if already deployed. */
	factoryData: string | null;
	/** The paymaster contract address. */
	paymaster: string | null;
	/** The gas limit for paymaster verification. */
	paymasterVerificationGasLimit: bigint | null;
	/** The gas limit for paymaster postOp execution. */
	paymasterPostOpGasLimit: bigint | null;
	/** The paymaster-specific data. */
	paymasterData: string | null;
	/** The EIP-7702 delegation authorization data. */
	eip7702Auth: Authorization7702Hex | null;
}

/**
 * UserOperation fields for Tenderly simulation targeting EntryPoint v0.9.
 */
export interface UserOperationV9ToSimulate extends UserOperationV8ToSimulate {}

/**
 * Simulates a UserOperation's callData (and optional account deployment) on
 * Tenderly, then creates shareable links for each simulation.
 * @param tenderlyAccountSlug - The Tenderly account slug.
 * @param tenderlyProjectSlug - The Tenderly project slug.
 * @param tenderlyAccessKey - The Tenderly API access key.
 * @param chainId - The chain ID to simulate on.
 * @param entrypointAddress - The EntryPoint contract address.
 * @param userOperation - The UserOperation to simulate (v0.6, v0.7, or v0.8 format).
 * @param blockNumber - Optional block number for the simulation.
 * @param stateOverrides - Optional state overrides for the simulation.
 * @returns The simulation results and shareable dashboard links.
 */
export async function simulateUserOperationCallDataWithTenderlyAndCreateShareLink(
	tenderlyAccountSlug: string,
	tenderlyProjectSlug: string,
	tenderlyAccessKey: string,
	chainId: bigint,
	entrypointAddress: string,
	userOperation:
		| UserOperationV6ToSimulate
		| UserOperationV7ToSimulate
		| UserOperationV8ToSimulate
		| UserOperationV9ToSimulate,
	blockNumber: number | null = null,
	stateOverrides?: OverrideType | null,
): Promise<{
	simulation: TenderlySimulationResult;
	callDataSimulationShareLink: string;
	accountDeploymentSimulationShareLink?: string;
}> {
	const simulation = await simulateUserOperationCallDataWithTenderly(
		tenderlyAccountSlug,
		tenderlyProjectSlug,
		tenderlyAccessKey,
		chainId,
		entrypointAddress,
		userOperation,
		blockNumber,
		stateOverrides,
	);
	const simulationIds = simulation.map((s) => s.simulation.id);
	await Promise.all(
		simulationIds.map((simulationId) =>
			shareTenderlySimulationAndCreateLink(
				tenderlyAccountSlug,
				tenderlyProjectSlug,
				tenderlyAccessKey,
				simulationId,
			),
		),
	);

	const simulationLinks = simulationIds.map(
		(s) => `https://dashboard.tenderly.co/shared/simulation/${s}`,
	);
	if (simulationLinks.length === 1) {
		return {
			simulation,
			callDataSimulationShareLink: simulationLinks[0],
		};
	} else if (simulationLinks.length === 2) {
		return {
			simulation,
			accountDeploymentSimulationShareLink: simulationLinks[0],
			callDataSimulationShareLink: simulationLinks[1],
		};
	} else {
		throw new AbstractionKitError("BAD_DATA", "invalid number of simulations retuned", {
			context: JSON.stringify(simulation, (_key, value) =>
				typeof value === "bigint" ? `0x${value.toString(16)}` : value,
			),
		});
	}
}

/**
 * Simulates a UserOperation's callData on Tenderly by extracting the sender,
 * callData, and factory info, then delegating to {@link simulateSenderCallDataWithTenderly}.
 * @param tenderlyAccountSlug - The Tenderly account slug.
 * @param tenderlyProjectSlug - The Tenderly project slug.
 * @param tenderlyAccessKey - The Tenderly API access key.
 * @param chainId - The chain ID to simulate on.
 * @param entrypointAddress - The EntryPoint contract address.
 * @param userOperation - The UserOperation to simulate (v0.6, v0.7, or v0.8 format).
 * @param blockNumber - Optional block number for the simulation.
 * @param stateOverrides - Optional state overrides for the simulation.
 * @returns The Tenderly simulation results.
 */
export async function simulateUserOperationCallDataWithTenderly(
	tenderlyAccountSlug: string,
	tenderlyProjectSlug: string,
	tenderlyAccessKey: string,
	chainId: bigint,
	entrypointAddress: string,
	userOperation:
		| UserOperationV6ToSimulate
		| UserOperationV7ToSimulate
		| UserOperationV8ToSimulate
		| UserOperationV9ToSimulate,
	blockNumber: number | null = null,
	stateOverrides?: OverrideType | null,
): Promise<TenderlySimulationResult> {
	let factory = null;
	let factoryData = null;
	const entrypointAddressLowerCase = entrypointAddress.toLowerCase();
	const isV6UserOperation = "initCode" in userOperation;
	const isV6Entrypoint =
		entrypointAddressLowerCase === "0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789";

	if (isV6UserOperation !== isV6Entrypoint) {
		throw new RangeError("UserOperation version does not match entrypoint.");
	}

	let callData = userOperation.callData;
	if ("initCode" in userOperation) {
		if (userOperation.initCode != null && userOperation.initCode.length > 2) {
			factory = userOperation.initCode.slice(0, 22);
			factoryData = userOperation.initCode.slice(22);
		}
	} else {
		factory = userOperation.factory;
		factoryData = userOperation.factoryData;

		// EIP-7702 userOps use factory:"0x7702" as a sentinel with
		// factoryData:null. This doesn't represent an actual factory
		// deployment, so normalize to null.
		if (factory === "0x7702") {
			factory = null;
			factoryData = null;
		}

		// Handle IAccountExecute.executeUserOp callData rewriting.
		// When callData starts with the executeUserOp selector (0x8dd7712f),
		// the EntryPoint rewrites the call to
		// sender.executeUserOp(packedUserOp, userOpHash) instead of
		// sender.call(callData). Replicate that behavior here.
		const EXECUTE_USEROP_SELECTOR = "0x8dd7712f";
		if (callData.toLowerCase().startsWith(EXECUTE_USEROP_SELECTOR)) {
			const abiCoder = AbiCoder.defaultAbiCoder();

			let initCode = "0x";
			if (userOperation.factory != null) {
				initCode = userOperation.factory;
				if (userOperation.factoryData != null) {
					initCode += userOperation.factoryData.slice(2);
				}
			}

			const accountGasLimits =
				"0x" +
				abiCoder.encode(["uint128"], [userOperation.verificationGasLimit]).slice(34) +
				abiCoder.encode(["uint128"], [userOperation.callGasLimit]).slice(34);

			const gasFees =
				"0x" +
				abiCoder.encode(["uint128"], [userOperation.maxPriorityFeePerGas]).slice(34) +
				abiCoder.encode(["uint128"], [userOperation.maxFeePerGas]).slice(34);

			let paymasterAndData = "0x";
			if (userOperation.paymaster != null) {
				paymasterAndData = userOperation.paymaster;
				if (userOperation.paymasterVerificationGasLimit != null) {
					paymasterAndData += abiCoder
						.encode(["uint128"], [userOperation.paymasterVerificationGasLimit])
						.slice(34);
				}
				if (userOperation.paymasterPostOpGasLimit != null) {
					paymasterAndData += abiCoder
						.encode(["uint128"], [userOperation.paymasterPostOpGasLimit])
						.slice(34);
				}
				if (userOperation.paymasterData != null) {
					paymasterAndData += userOperation.paymasterData.slice(2);
				}
			}

			const userOpHash = createUserOperationHash(
				userOperation as UserOperationV7 | UserOperationV8 | UserOperationV9,
				entrypointAddress,
				chainId,
			);

			const packedUserOp = [
				userOperation.sender,
				userOperation.nonce,
				initCode,
				userOperation.callData,
				accountGasLimits,
				userOperation.preVerificationGas,
				gasFees,
				paymasterAndData,
				userOperation.signature,
			];

			const encodedParams = abiCoder.encode(
				["(address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes)", "bytes32"],
				[packedUserOp, userOpHash],
			);
			callData = EXECUTE_USEROP_SELECTOR + encodedParams.slice(2);
		}
	}

	return await simulateSenderCallDataWithTenderly(
		tenderlyAccountSlug,
		tenderlyProjectSlug,
		tenderlyAccessKey,
		chainId,
		entrypointAddress,
		userOperation.sender,
		callData,
		factory,
		factoryData,
		blockNumber,
		stateOverrides,
	);
}

/**
 * Simulates the sender's callData (and optional account deployment) on Tenderly,
 * then creates shareable links for each simulation.
 * @param tenderlyAccountSlug - The Tenderly account slug.
 * @param tenderlyProjectSlug - The Tenderly project slug.
 * @param tenderlyAccessKey - The Tenderly API access key.
 * @param chainId - The chain ID to simulate on.
 * @param entrypointAddress - The EntryPoint contract address.
 * @param sender - The smart account address.
 * @param callData - The encoded call data to simulate.
 * @param factory - The factory contract address, or null if already deployed.
 * @param factoryData - The factory initialization data, or null if already deployed.
 * @param blockNumber - Optional block number for the simulation.
 * @param stateOverrides - Optional state overrides for the simulation.
 * @returns The simulation results and shareable dashboard links.
 */
export async function simulateSenderCallDataWithTenderlyAndCreateShareLink(
	tenderlyAccountSlug: string,
	tenderlyProjectSlug: string,
	tenderlyAccessKey: string,
	chainId: bigint,
	entrypointAddress: string,
	sender: string,
	callData: string,
	factory: string | null = null,
	factoryData: string | null = null,
	blockNumber: number | null = null,
	stateOverrides?: OverrideType | null,
): Promise<{
	simulation: TenderlySimulationResult;
	callDataSimulationShareLink: string;
	accountDeploymentSimulationShareLink?: string;
}> {
	const simulation = await simulateSenderCallDataWithTenderly(
		tenderlyAccountSlug,
		tenderlyProjectSlug,
		tenderlyAccessKey,
		chainId,
		entrypointAddress,
		sender,
		callData,
		factory,
		factoryData,
		blockNumber,
		stateOverrides,
	);
	const simulationIds = simulation.map((s) => s.simulation.id);
	await Promise.all(
		simulationIds.map((simulationId) =>
			shareTenderlySimulationAndCreateLink(
				tenderlyAccountSlug,
				tenderlyProjectSlug,
				tenderlyAccessKey,
				simulationId,
			),
		),
	);

	const simulationLinks = simulationIds.map(
		(s) => `https://dashboard.tenderly.co/shared/simulation/${s}`,
	);
	if (simulationLinks.length === 1) {
		return {
			simulation,
			callDataSimulationShareLink: simulationLinks[0],
		};
	} else if (simulationLinks.length === 2) {
		return {
			simulation,
			accountDeploymentSimulationShareLink: simulationLinks[0],
			callDataSimulationShareLink: simulationLinks[1],
		};
	} else {
		throw new AbstractionKitError("BAD_DATA", "invalid number of simulations retuned", {
			context: JSON.stringify(simulation, (_key, value) =>
				typeof value === "bigint" ? `0x${value.toString(16)}` : value,
			),
		});
	}
}

/**
 * Simulates the sender's callData on Tenderly. If factory and factoryData are
 * provided, simulates account deployment first, then the callData execution.
 * Uses the appropriate SenderCreator address based on the EntryPoint version.
 * @param tenderlyAccountSlug - The Tenderly account slug.
 * @param tenderlyProjectSlug - The Tenderly project slug.
 * @param tenderlyAccessKey - The Tenderly API access key.
 * @param chainId - The chain ID to simulate on.
 * @param entrypointAddress - The EntryPoint contract address.
 * @param sender - The smart account address.
 * @param callData - The encoded call data to simulate.
 * @param factory - The factory contract address, or null if already deployed.
 * @param factoryData - The factory initialization data, or null if already deployed.
 * @param blockNumber - Optional block number for the simulation.
 * @param stateOverrides - Optional state overrides for the simulation.
 * @returns The Tenderly simulation results (one or two entries depending on deployment).
 */
export async function simulateSenderCallDataWithTenderly(
	tenderlyAccountSlug: string,
	tenderlyProjectSlug: string,
	tenderlyAccessKey: string,
	chainId: bigint,
	entrypointAddress: string,
	sender: string,
	callData: string,
	factory: string | null = null,
	factoryData: string | null = null,
	blockNumber: number | null = null,
	stateOverrides?: OverrideType | null,
): Promise<TenderlySimulationResult> {
	const transactions = [];
	const entrypointAddressLowerCase = entrypointAddress.toLowerCase();
	let senderCreator: string;
	if (entrypointAddressLowerCase === "0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789") {
		senderCreator = "0x7fc98430eaedbb6070b35b39d798725049088348";
	} else if (entrypointAddressLowerCase === "0x0000000071727de22e5e9d8baf0edac6f37da032") {
		senderCreator = "0xefc2c1444ebcc4db75e7613d20c6a62ff67a167c";
	} else if (entrypointAddressLowerCase === "0x4337084d9e255ff0702461cf8895ce9e3b5ff108") {
		senderCreator = "0x449ed7c3e6fee6a97311d4b55475df59c44add33";
	} else if (entrypointAddressLowerCase === "0x433709009b8330fda32311df1c2afa402ed8d009") {
		senderCreator = "0x0A630a99Df908A81115A3022927Be82f9299987e";
	} else {
		throw new RangeError(`Invalid entrypoint: ${entrypointAddress}`);
	}

	if ((factory == null && factoryData != null) || (factory != null && factoryData == null)) {
		throw new RangeError(`Invalid factory and factoryData`);
	}
	if (factory != null && factoryData != null) {
		transactions.push({
			chainId,
			blockNumber,
			from: senderCreator,
			to: factory,
			data: factoryData,
			stateOverrides,
		});
	}
	transactions.push({
		chainId,
		blockNumber,
		from: entrypointAddress,
		to: sender,
		data: callData,
		stateOverrides,
	});
	const simulationsResult = await callTenderlySimulateBundle(
		tenderlyAccountSlug,
		tenderlyProjectSlug,
		tenderlyAccessKey,
		transactions,
	);

	for (const simulationResult of simulationsResult) {
		if (simulationResult.simulation.id === "") {
			throw new AbstractionKitError("TENDERLY_SIMULATION_ERROR", "tenderly simulation failed", {
				context: JSON.stringify(simulationsResult, (_key, value) =>
					typeof value === "bigint" ? `0x${value.toString(16)}` : value,
				),
			});
		}
	}
	return simulationsResult;
}

/**
 * Sends a bundle of transactions to Tenderly's simulate-bundle API endpoint.
 * This is the low-level function that all other Tenderly simulation functions delegate to.
 * @param tenderlyAccountSlug - The Tenderly account slug.
 * @param tenderlyProjectSlug - The Tenderly project slug.
 * @param tenderlyAccessKey - The Tenderly API access key.
 * @param transactions - Array of transaction objects to simulate as a bundle.
 * @returns The simulation results from Tenderly.
 */
export async function callTenderlySimulateBundle(
	tenderlyAccountSlug: string,
	tenderlyProjectSlug: string,
	tenderlyAccessKey: string,
	transactions: {
		chainId: bigint;
		from: string;
		to: string;
		data: string;
		gas?: number | null;
		gasPrice?: number | null;
		value?: number | null;
		blockNumber?: number | null;
		simulationType?: "full" | "quick" | "abi";
		stateOverrides?: OverrideType | null;
		transactionIndex?: number;
		save?: boolean;
		saveIfFails?: boolean;
		estimateGas?: boolean;
		generateAccessList?: boolean;
		accessList?: { address: string }[];
	}[],
): Promise<TenderlySimulationResult> {
	const tenderlyUrl =
		"https://api.tenderly.co/api/v1/account/" +
		tenderlyAccountSlug +
		"/project/" +
		tenderlyProjectSlug +
		"/simulate-bundle";
	const simulations = transactions.map((transaction) => {
		const transactionObject: Record<
			string,
			string | number | boolean | OverrideType | { address: string }[]
		> = {
			network_id: transaction.chainId.toString(),
			save: transaction.save ?? true,
			save_if_fails: transaction.saveIfFails ?? true,
			from: transaction.from,
			to: transaction.to,
			input: transaction.data,
			simulation_type: transaction.simulationType ?? "full",
		};
		if (transaction.blockNumber != null) {
			transactionObject.block_number = transaction.blockNumber;
		}

		if (transaction.gas != null) {
			transactionObject.gas = transaction.gas;
		}
		if (transaction.gasPrice != null) {
			transactionObject.gas_price = transaction.gasPrice;
		}
		if (transaction.value != null) {
			transactionObject.value = transaction.value;
		}
		if (transaction.stateOverrides != null) {
			const stateOverrides = transaction.stateOverrides;
			for (const address in stateOverrides) {
				for (const key in stateOverrides[address]) {
					if (key !== "balance" && key !== "code" && key !== "storage" && key !== "stateDiff") {
						throw new RangeError(`Invalid stateOverrides key: ${key}.`);
					} else if (
						"storage" in stateOverrides[address] &&
						"stateDiff" in stateOverrides[address]
					) {
						throw new RangeError("can't set both storage and stateDiff for stateOverrides");
					} else if ("stateDiff" in stateOverrides[address]) {
						stateOverrides[address].storage = stateOverrides[address].stateDiff;
						delete stateOverrides[address].stateDiff;
					}
				}
			}
			transactionObject.state_objects = stateOverrides;
		}

		if (transaction.transactionIndex != null) {
			transactionObject.transaction_index = transaction.transactionIndex;
		}
		if (transaction.estimateGas != null) {
			transactionObject.estimate_gas = transaction.estimateGas;
		}
		if (transaction.generateAccessList != null) {
			transactionObject.generate_access_list = transaction.generateAccessList;
		}
		if (transaction.accessList != null) {
			transactionObject.access_list = transaction.accessList;
		}
		return transactionObject;
	});

	const headers = {
		Accept: "application/json",
		"Content-Type": "application/json",
		"X-Access-Key": tenderlyAccessKey,
	};
	return (await sendJsonRpcRequest(
		tenderlyUrl,
		"tenderly_simulateBundle",
		simulations,
		headers,
		"simulations",
	)) as TenderlySimulationResult;
}
