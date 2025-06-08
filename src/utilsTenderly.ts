import * as fetchImport from "isomorphic-unfetch";

import { AbiCoder } from "ethers";

import {
	UserOperationV6,
	UserOperationV7,
	UserOperationV8,
    TenderlySimulationResult,
    SingleTransactionTenderlySimulationResult,
} from "./types";
import {
	AbstractionKitError
} from "./errors";
import { sendJsonRpcRequest } from "./utils";


export async function shareTenderlySimulationAndCreateLink(
    tenderlyAccountSlug:string,
    tenderlyProjectSlug:string,
    tenderlyAccessKey: string,
    tenderlySimulationId: string,
){
    const tenderlyUrl = 
        'https://api.tenderly.co/api/v1/account/' + tenderlyAccountSlug +
        '/project/' + tenderlyProjectSlug +
        '/simulations/' + tenderlySimulationId +
        '/share';
    
    const headers = {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-Access-Key': tenderlyAccessKey
    };
    
    const fetch = fetchImport.default || fetchImport;
	const requestOptions: RequestInit = {
		method: "POST",
		headers, 
		redirect: "follow",
	};
	const fetchResult = await fetch(tenderlyUrl, requestOptions);
	const status = fetchResult.status;

	if (status != 204) {
	    throw new AbstractionKitError(
            "BAD_DATA", "tenderly share simulation failed.", {
            context: {
                tenderlyAccountSlug,
                tenderlyProjectSlug,
                tenderlyAccessKey,
                tenderlySimulationId,
                status
            },
        });
	}
}

export async function simulateUserOperationWithTenderlyAndCreateShareLink(
    tenderlyAccountSlug:string,
    tenderlyProjectSlug:string,
    tenderlyAccessKey: string,
    chainId: bigint,
	entrypointAddress: string,
	userOperation: UserOperationV6 | UserOperationV7 | UserOperationV8,
    blockNumber: bigint | null = null,
): Promise<{
    simulation:SingleTransactionTenderlySimulationResult,
    simulationShareLink: string,
}> {
    const simulation = await simulateUserOperationWithTenderly(
        tenderlyAccountSlug,
        tenderlyProjectSlug,
        tenderlyAccessKey,
        chainId,
        entrypointAddress,
        userOperation,
        blockNumber
    );

    await shareTenderlySimulationAndCreateLink(
        tenderlyAccountSlug,
        tenderlyProjectSlug,
        tenderlyAccessKey,
        simulation.simulation.id,
    )
    const simulationShareLink =
        'https://dashboard.tenderly.co/shared/simulation/' + simulation.simulation.id;
    return {
        simulation,
        simulationShareLink
    }
}

export async function simulateUserOperationWithTenderly(
    tenderlyAccountSlug:string,
    tenderlyProjectSlug:string,
    tenderlyAccessKey: string,
    chainId: bigint,
	entrypointAddress: string,
	userOperation: UserOperationV6 | UserOperationV7 | UserOperationV8,
    blockNumber: bigint | null = null,
): Promise<SingleTransactionTenderlySimulationResult> {
    const entrypointAddressLowerCase = entrypointAddress.toLowerCase();
    let callData: string | null = null;
    const abiCoder = AbiCoder.defaultAbiCoder();
	if (
        "initCode" in userOperation &&
        entrypointAddressLowerCase == '0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789'
    ) {
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
            userOperation.signature
        ];

        const encodedUserOperation = abiCoder.encode(
            [
                "(address,uint256,bytes,bytes,uint256,uint256,uint256,uint256,uint256,bytes,bytes)[]",
                "address",
            ],
            [
                [useroperationValuesArray],
                "0x1000000000000000000000000000000000000000"
            ],
        );
        callData = '0x1fad948c' + encodedUserOperation.slice(2);

    }else{
        userOperation = userOperation as UserOperationV7 | UserOperationV8;
        let initCode = "0x";
        if (userOperation.factory != null) {
            initCode = userOperation.factory;
            if (userOperation.factoryData != null) {
                initCode += userOperation.factoryData.slice(2);
            }
        }

        const accountGasLimits =
            "0x" +
            abiCoder
                .encode(["uint128"], [userOperation.verificationGasLimit])
                .slice(34) +
            abiCoder.encode(["uint128"], [userOperation.callGasLimit]).slice(34);

        const gasFees =
            "0x" +
            abiCoder
                .encode(["uint128"], [userOperation.maxPriorityFeePerGas])
                .slice(34) +
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
            userOperation.signature
        ];

        const encodedUserOperation = abiCoder.encode(
            [
                "(address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes)[]",
                "address",
            ],
            [
                [useroperationValuesArray],
                "0x1000000000000000000000000000000000000000"
            ],
        );

        if(
            entrypointAddressLowerCase == '0x0000000071727de22e5e9d8baf0edac6f37da032' ||
            entrypointAddressLowerCase == '0x4337084d9e255ff0702461cf8895ce9e3b5ff108'
        ){
            callData = '0x765e827f' + encodedUserOperation.slice(2);
        }else{
            throw RangeError("Invalid entrypoint.");
        }
    }
    const simulation = await callTenderlySimulateBundle(
        tenderlyAccountSlug,
        tenderlyProjectSlug,
        tenderlyAccessKey,
        [{
            chainId,
            blockNumber,
            from: "0x1000000000000000000000000000000000000000",
            to: entrypointAddress,
            data: callData,
        }]
    );
    return simulation[0];
}

/**
 * Base wrapper for a useroperation
 */
export interface BaseUserOperationToSimulate {
	sender: string;
	callData: string;
	nonce: any;
	callGasLimit: any;
	verificationGasLimit: any;
	preVerificationGas: any;
	maxFeePerGas: any;
	maxPriorityFeePerGas: any;
	signature: any;
}

/**
 * Wrapper for a useroperation to simulate for an entrypoint v0.6.0
 */
export interface UserOperationV6ToSimulate extends BaseUserOperationToSimulate {
	initCode: string | null;
	paymasterAndData: any;
}

/**
 * Wrapper for a useroperation to simulate for an entrypoint v0.7.0
 */
export interface UserOperationV7ToSimulate extends BaseUserOperationToSimulate {
	factory: string | null;
	factoryData: string | null;
	paymaster: any;
	paymasterVerificationGasLimit: any;
	paymasterPostOpGasLimit: any;
	paymasterData: any;
}

/**
 * Wrapper for a useroperation to simulate for an entrypoint v0.8.0
 */
export interface UserOperationV8ToSimulate extends BaseUserOperationToSimulate {
	factory: string | null;
	factoryData: string | null;
	paymaster: any;
	paymasterVerificationGasLimit: any;
	paymasterPostOpGasLimit: any;
	paymasterData: any;
    eip7702Auth: any;
}

export async function simulateUserOperationCallDataWithTenderlyAndCreateShareLink(
    tenderlyAccountSlug:string,
    tenderlyProjectSlug:string,
    tenderlyAccessKey: string,
    chainId: bigint,
	entrypointAddress: string,
	userOperation: UserOperationV6ToSimulate | UserOperationV7ToSimulate | UserOperationV8ToSimulate,
    blockNumber: bigint | null = null,
): Promise<{
        simulation:TenderlySimulationResult,
        callDataSimulationShareLink: string,
        accountDeploymentSimulationShareLink?: string,
}> {
    const simulation = await simulateUserOperationCallDataWithTenderly(
        tenderlyAccountSlug,
        tenderlyProjectSlug,
        tenderlyAccessKey,
        chainId,
        entrypointAddress,
        userOperation,
        blockNumber
    );
    const simulationIds = simulation.map(s => s.simulation.id) as string[];
    simulationIds.map(simulationId => 
        shareTenderlySimulationAndCreateLink(
            tenderlyAccountSlug,
            tenderlyProjectSlug,
            tenderlyAccessKey,
            simulationId,
        )
    );
   
    const simulationLinks = simulationIds.map(
        s => 'https://dashboard.tenderly.co/shared/simulation/' + s );
    if (simulationLinks.length == 1){
        return {
            simulation,
            callDataSimulationShareLink: simulationLinks[0]
        };
    }else if (simulationLinks.length == 2){
        return {
            simulation,
            accountDeploymentSimulationShareLink: simulationLinks[0],
            callDataSimulationShareLink: simulationLinks[1]
        };
    }else{
        throw new AbstractionKitError(
            "BAD_DATA",
            "invalid number of simulations retuned",
            {
                context: JSON.stringify(
                    simulation,
                    (_key, value) =>
                        typeof value === "bigint" ? "0x" + value.toString(16) : value,
                ),
            },
        );
    } 
}

export async function simulateUserOperationCallDataWithTenderly(
    tenderlyAccountSlug:string,
    tenderlyProjectSlug:string,
    tenderlyAccessKey: string,
    chainId: bigint,
	entrypointAddress: string,
	userOperation: UserOperationV6ToSimulate | UserOperationV7ToSimulate | UserOperationV8ToSimulate,
    blockNumber: bigint | null = null,
) : Promise<TenderlySimulationResult> {
    let factory = null;
    let factoryData = null;
	if ("initCode" in userOperation) {
        if(userOperation.initCode != null && userOperation.initCode.length > 2){
            factory = userOperation.initCode.slice(0,22);
            factoryData = userOperation.initCode.slice(22);
        }
    }else{
        factory = userOperation.factory;
        factoryData = userOperation.factoryData;
    }

    return await simulateSenderCallDataWithTenderly(
        tenderlyAccountSlug,
        tenderlyProjectSlug,
        tenderlyAccessKey,
        chainId,
        entrypointAddress,
        userOperation.sender,
        userOperation.callData,
        factory,
        factoryData,
        blockNumber
    )
}

export async function simulateSenderCallDataWithTenderlyAndCreateShareLink(
    tenderlyAccountSlug:string,
    tenderlyProjectSlug:string,
    tenderlyAccessKey: string,
    chainId: bigint,
	entrypointAddress: string,
    sender: string,
    callData: string,
    factory: string | null = null,
	factoryData: string | null = null,
    blockNumber: bigint | null = null,
): Promise<{
        simulation:TenderlySimulationResult,
        callDataSimulationShareLink: string,
        accountDeploymentSimulationShareLink?: string,
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
        blockNumber
    );
    const simulationIds = simulation.map(s => s.simulation.id) as string[];
    simulationIds.map(simulationId => 
        shareTenderlySimulationAndCreateLink(
            tenderlyAccountSlug,
            tenderlyProjectSlug,
            tenderlyAccessKey,
            simulationId,
        )
    );
   
    const simulationLinks = simulationIds.map(
        s => 'https://dashboard.tenderly.co/shared/simulation/' + s );
    if (simulationLinks.length == 1){
        return {
            simulation,
            callDataSimulationShareLink: simulationLinks[0]
        };
    }else if (simulationLinks.length == 2){
        return {
            simulation,
            accountDeploymentSimulationShareLink: simulationLinks[0],
            callDataSimulationShareLink: simulationLinks[1]
        };
    }else{
        throw new AbstractionKitError(
            "BAD_DATA",
            "invalid number of simulations retuned",
            {
                context: JSON.stringify(
                    simulation,
                    (_key, value) =>
                        typeof value === "bigint" ? "0x" + value.toString(16) : value,
                ),
            },
        );
    } 
}

export async function simulateSenderCallDataWithTenderly(
    tenderlyAccountSlug:string,
    tenderlyProjectSlug:string,
    tenderlyAccessKey: string,
    chainId: bigint,
	entrypointAddress: string,
    sender: string,
    callData: string,
    factory: string | null = null,
	factoryData: string | null = null,
    blockNumber: bigint | null = null,
): Promise<TenderlySimulationResult> {
    const transactions = [];
    const entrypointAddressLowerCase = entrypointAddress.toLowerCase();
    let senderCreator:string;
    if(
        entrypointAddressLowerCase == '0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789'
    ){
        senderCreator = "0x7fc98430eaedbb6070b35b39d798725049088348";
    }else if(
        entrypointAddressLowerCase == '0x0000000071727de22e5e9d8baf0edac6f37da032'
    ){
        senderCreator = "0xefc2c1444ebcc4db75e7613d20c6a62ff67a167c";
    }else if(
        entrypointAddressLowerCase == '0x4337084d9e255ff0702461cf8895ce9e3b5ff108'
    ){
        senderCreator = "0x449ed7c3e6fee6a97311d4b55475df59c44add33";
    }else{
        throw RangeError(`Invalid entrypoint: ${entrypointAddress}`);
    }
    
    if(
        factory == null && factoryData != null ||
        factory != null && factoryData == null
    ){ 
        throw RangeError(`Invalid factory and factoryData`);
    }
    if(factory != null && factoryData != null){ 
        transactions.push({
            chainId,
            blockNumber,
            from: senderCreator,
            to: factory,
            data: factoryData,
        })
    }
    transactions.push({
        chainId,
        blockNumber,
        from: entrypointAddress,
        to: sender,
        data: callData,
    })
    return await callTenderlySimulateBundle(
        tenderlyAccountSlug, tenderlyProjectSlug, tenderlyAccessKey, transactions);
}


export async function callTenderlySimulateBundle(
    tenderlyAccountSlug:string,
    tenderlyProjectSlug:string,
    tenderlyAccessKey: string,
    transactions:{
        chainId: bigint,
        from: string,
        to: string,
        data: string,
        gas?: bigint | null,
        gasPrice?: bigint | null,
        value?: bigint | null,
        blockNumber?: bigint | null,
        simulationType?: 'full' | 'quick' | 'abi'
        stateOverride?: any | null,
        transactionIndex?: bigint,
        save?: boolean,
        saveIfFails?: boolean,
        estimateGas?: boolean,
        generateAccessList?: boolean,
        accessList?: {address: string}[]
    }[],  
): Promise<TenderlySimulationResult> {
    const tenderlyUrl = 
        'https://api.tenderly.co/api/v1/account/' + tenderlyAccountSlug +
        '/project/' + tenderlyProjectSlug + '/simulate-bundle';
    const simulations =
      transactions.map(transaction=>{
            const transactionObject: Record<
                string, string | bigint | boolean | {address: string}[]
            > = {
                network_id: transaction.chainId.toString(),
                save: transaction.save?? true,
                save_if_fails:transaction.saveIfFails?? true,
                from: transaction.from,
                to: transaction.to,
                input: transaction.data,
                simulation_type: transaction.simulationType??'quick',
              }
            if (transaction.blockNumber != null){
                transactionObject["block_number"] = transaction.blockNumber;
            }

            if (transaction.gas != null){
                transactionObject["gas"] = transaction.gas;
            }
            if (transaction.gasPrice != null){
                transactionObject["gas_price"] = transaction.gasPrice;
            }
            if (transaction.value != null){
                transactionObject["value"] = transaction.value;
            }
            if (transaction.stateOverride != null){
                transactionObject["state_objects"] = transaction.stateOverride;
            }
            
            if (transaction.transactionIndex != null){
                transactionObject["transaction_index"] = transaction.transactionIndex;
            }
            if (transaction.estimateGas != null){
                transactionObject["estimate_gas"] = transaction.estimateGas;
            }
            if (transaction.generateAccessList != null){
                transactionObject["generate_access_list"] =
                    transaction.generateAccessList;
            }
            if (transaction.accessList != null){
                transactionObject["access_list"] = transaction.accessList;
            }

            return transactionObject;
        }
      ) 
    
    const headers = {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-Access-Key': tenderlyAccessKey
    };
    return await sendJsonRpcRequest(
        tenderlyUrl,
        "tenderly_simulateBundle",
        simulations,
        headers,
        "simulations"
    ) as TenderlySimulationResult;
}
