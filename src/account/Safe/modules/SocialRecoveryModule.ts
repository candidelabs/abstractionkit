import { SafeModule } from "./SafeModule";
import { AbstractionKitError,ensureError } from "src/errors";
import {
	createCallData,
	getFunctionSelector,
    sendJsonRpcRequest,
} from "../../../utils";

import { MetaTransaction } from "../../../types";

import { AbiCoder } from "ethers";

export class SocialRecoveryModule extends SafeModule{
    static readonly DEFAULT_SOCIAL_RECOVERY_ADDRESS =
        "0xFc98B4a5120959511873a51daBd6c1889897412d";

    constructor(
		moduleAddress: string = SocialRecoveryModule.DEFAULT_SOCIAL_RECOVERY_ADDRESS,
	) {
		super(moduleAddress);
	}

    /**
	 * create MetaTransaction that lets single guardian confirm the execution of the recovery request.
     * Can also trigger the start of the execution by passing true to 'execute' parameter.
     * Once triggered the recovery is pending for the recovery period before it can be finalised.
     * @param accountAddress The target account.
     * @param newOwners The new owners' addressess.
     * @param newThreshold The new threshold for the safe.
     * @param execute Whether to auto-start execution of recovery.
	 * @returns a MetaTransaction
	 */
    public createConfirmRecoveryMetaTransaction(
        accountAddress: string,
        newOwners: string[],
        newThreshold: number,
        execute: boolean
    ):MetaTransaction{
        const functionSignature = "confirmRecovery(address,address[],uint256,bool)";
        const functionSelector = getFunctionSelector(
            functionSignature,
        );
        const callData = createCallData(
            functionSelector,
            ["address", "address[]", "uint256", "bool"],
            [accountAddress, newOwners, newThreshold, execute],
        );
        return {
            to:this.moduleAddress,
            data: callData,
            value: 0n
        }
    }
    
    /**
     * create MetaTransaction that lets multiple guardians confirm the execution of the recovery request.
     * Can also trigger the start of the execution by passing true to 'execute' parameter.
     * Once triggered the recovery is pending for the recovery period before it can be finalised.
     * @param accountAddress The target account.
     * @param newOwners The new owners' addressess.
     * @param newThreshold The new threshold for the safe.
     * @param signatures The guardians signatures.
     * @param execute Whether to auto-start execution of recovery.
	 * @returns a MetaTransaction
     */
    public createMultiConfirmRecoveryMetaTransaction(
        accountAddress: string,
        newOwners: string[],
        newThreshold: number,
        signatures: string[],
        execute: boolean
    ):MetaTransaction{
        const functionSignature = "multiConfirmRecovery(address,address[],uint256,address[],bool)";
        const functionSelector = getFunctionSelector(
            functionSignature,
        );
        const callData = createCallData(
            functionSelector,
            ["address", "address[]", "uint256", "address[]", "bool"],
            [accountAddress, newOwners, newThreshold, signatures, execute],
        );
        return {
            to:this.moduleAddress,
            data: callData,
            value: 0n
        }
    }

    /**
     * @notice create MetaTransaction that lets the guardians start the execution of the recovery request.
     * Once triggered the recovery is pending for the recovery period before it can be finalised.
     * @param accountAddress The target account.
     * @param newOwners The new owners' addressess.
     * @param newThreshold The new threshold for the safe.
	 * @returns a MetaTransaction
     */
    public createExecuteRecoveryMetaTransaction(
        accountAddress: string,
        newOwners: string[],
        newThreshold: number,
    ):MetaTransaction{
        const functionSignature = "executeRecovery(address,address[],uint256)";
        const functionSelector = getFunctionSelector(
            functionSignature,
        );
        const callData = createCallData(
            functionSelector,
            ["address", "address[]", "uint256"],
            [accountAddress, newOwners, newThreshold],
        );
        return {
            to:this.moduleAddress,
            data: callData,
            value: 0n
        }
    }

    /**
     * create a MetaTransaction that finalizes an ongoing recovery request if the recovery period is over.
     * The method is public and callable by anyone to enable orchestration.
     * @param accountAddress The target account.
	 * @returns a MetaTransaction
     */
    public createFinalizeRecoveryMetaTransaction(
        accountAddress: string,
    ):MetaTransaction{
        const functionSignature = "finalizeRecovery(address)";
        const functionSelector = getFunctionSelector(
            functionSignature,
        );
        const callData = createCallData(
            functionSelector,
            ["address"],
            [accountAddress],
        );
        return {
            to:this.moduleAddress,
            data: callData,
            value: 0n
        }
    }

    /**
     * create a MetaTransction that lets the account cancel an ongoing recovery request.
     * @param accountAddress The target account.
	 * @returns a MetaTransaction
     */
    public createCancelRecoveryMetaTransaction(
        accountAddress: string,
    ):MetaTransaction{
        const functionSignature = "cancelRecovery(address)";
        const functionSelector = getFunctionSelector(
            functionSignature,
        );
        const callData = createCallData(
            functionSelector,
            ["address"],
            [accountAddress],
        );
        return {
            to:this.moduleAddress,
            data: callData,
            value: 0n
        }
    }

    /**
     * create a MetaTransaction that lets the owner add a guardian for its account.
     * @param accountAddress The target account.
     * @param guardian The guardian to add.
     * @param threshold The new threshold that will be set after addition.
	 * @returns a MetaTransaction
     */
    public createAddGuardianWithThresholdMetaTransaction(
        accountAddress: string,
        guardianAddress: string,
        threshold: bigint,
    ):MetaTransaction{
        const functionSignature = "addGuardianWithThreshold(address,address,uint256)";
        const functionSelector = getFunctionSelector(
            functionSignature,
        );
        const callData = createCallData(
            functionSelector,
            ["address", "address", "uint256"],
            [accountAddress, guardianAddress, threshold],
        );
        return {
            to:this.moduleAddress,
            data: callData,
            value: 0n
        }
    }

    /**
     * create MetaTransaction that lets the owner revoke a guardian from its account.
     * @param accountAddress The target account.
     * @param prevGuardian The previous guardian linking to the guardian in the linked list.
     * @param guardian The guardian to revoke.
     * @param threshold The new threshold that will be set after execution of revokation.
	 * @returns a MetaTransaction
     */
    public createRevokeGuardianWithThresholdMetaTransaction(
        accountAddress: string,
        prevGuardianAddress: string,
        guardianAddress: string,
        threshold: bigint,
    ):MetaTransaction{
        const functionSignature = "revokeGuardianWithThreshold(address,address,address,uint256)";
        const functionSelector = getFunctionSelector(
            functionSignature,
        );
        const callData = createCallData(
            functionSelector,
            ["address", "address", "address","uint256"],
            [accountAddress, prevGuardianAddress, guardianAddress, threshold],
        );
        return {
            to:this.moduleAddress,
            data: callData,
            value: 0n
        }
    }

    /**
     * create MetaTransaction that lets the owner change the guardian threshold required to initiate a recovery.
     * @param accountAddress The target account.
     * @param threshold The new threshold that will be set after execution of revokation.
	 * @returns a MetaTransaction
     */
    public createChangeThresholdMetaTransaction(
        accountAddress: string,
        threshold: bigint,
    ):MetaTransaction{
        const functionSignature = "changeThreshold(address,uint256)";
        const functionSelector = getFunctionSelector(
            functionSignature,
        );
        const callData = createCallData(
            functionSelector,
            ["address","uint256"],
            [accountAddress, threshold],
        );
        return {
            to:this.moduleAddress,
            data: callData,
            value: 0n
        }
    }
    /**
     * Generates the recovery hash that should be signed by the guardian to authorize a recovery
     * @param accountAddress The target account.
     * @param newOwners The new owners' addressess.
     * @param newThreshold The new threshold for the safe.
     * @param nonce
	 * @returns a recovery hash
     */
    public async getRecoveryHash(
        rpcUrl: string,
        accountAddress: string,
        newOwners: string[],
        newThreshold: number,
        nonce: bigint,
    ):Promise<string>{
        const functionSignature = "getRecoveryHash(address,address[],uint256,uint256)";
        const functionSelector = getFunctionSelector(
            functionSignature,
        );
        const callData = createCallData(
            functionSelector,
            ["address", "address[]", "uint256", "uint256"],
            [accountAddress, newOwners, newThreshold, nonce],
        );

        const ethCallParams ={
            to: this.moduleAddress,
            data: callData,
        };

        return sendEthCallRequest(rpcUrl, ethCallParams, "latest");
    }

    /**
     * Retrieves the account's current ongoing recovery request.
     * @param accountAddress The target account.
     * @return request The account's current recovery request
     */
    public async getRecoveryRequest(
        rpcUrl: string,
        accountAddress: string,
    ):Promise<RecoveryRequest>{
        const functionSignature = "getRecoveryRequest(address)";
        const functionSelector = getFunctionSelector(
            functionSignature,
        );
        const callData = createCallData(
            functionSelector,
            ["address"],
            [accountAddress],
        );

        const ethCallParams ={
            to: this.moduleAddress,
            data: callData,
        };

        const recoveryRequestResult = await sendEthCallRequest(rpcUrl, ethCallParams, "latest");

        const abiCoder = AbiCoder.defaultAbiCoder();
	    const decodedCalldata = abiCoder.decode(
            ["uint256", "uint256", "uint64", "address[]"], recoveryRequestResult);

        return {
            guardiansApprovalCount: decodedCalldata[0],
            newThreshold: decodedCalldata[1],
            executeAfter: decodedCalldata[2],
            newOwners: decodedCalldata[3],
        }
    }

    /**
     * Retrieves the guardian approval count for this particular recovery request at current nonce.
     * @param accountAddress The target account.
     * @param newOwners The new owners' addressess.
     * @param newThreshold The new threshold for the safe.
     * @return The account's current recovery request
     */
    public async getRecoveryApprovals(
        rpcUrl: string,
        accountAddress: string,
        newOwners: string[],
        newThreshold: number,
    ):Promise<bigint>{
        const functionSignature = "getRecoveryApprovals(address,address[],uint256)";
        const functionSelector = getFunctionSelector(
            functionSignature,
        );
        const callData = createCallData(
            functionSelector,
            ["address", "address[]", "uint256"],
            [accountAddress, newOwners, newThreshold],
        );

        const ethCallParams ={
            to: this.moduleAddress,
            data: callData,
        };
        const recoveryRequestResult = await sendEthCallRequest(rpcUrl, ethCallParams, "latest");

        const abiCoder = AbiCoder.defaultAbiCoder();
	    const decodedCalldata = abiCoder.decode(
            ["uint256"], recoveryRequestResult);

        return BigInt(decodedCalldata[0]);
    }

    /**
     * Retrieves specific guardian approval status a particular recovery request at current nonce.
     * @param accountAddress The target account.
     * @param guardian The guardian.
     * @param newOwners The new owners' addressess.
     * @param newThreshold The new threshold for the safe.
     * @return guardian approval status
     */
    public async hasGuardianApproved(
        rpcUrl: string,
        accountAddress: string,
        guardian: string,
        newOwners: string[],
        newThreshold: number,
    ):Promise<boolean>{
        const functionSignature = "hasGuardianApproved(address,address,address[],uint256)";
        const functionSelector = getFunctionSelector(
            functionSignature,
        );
        const callData = createCallData(
            functionSelector,
            ["address", "address", "address[]", "uint256"],
            [accountAddress, guardian, newOwners, newThreshold],
        );

        const ethCallParams ={
            to: this.moduleAddress,
            data: callData,
        };
        const recoveryRequestResult = await sendEthCallRequest(rpcUrl, ethCallParams, "latest");

        const abiCoder = AbiCoder.defaultAbiCoder();
	    const decodedCalldata = abiCoder.decode(
            ["bool"], recoveryRequestResult);

        return Boolean(decodedCalldata[0]);
    }

    /**
     * Checks if an address is a guardian for an account.
     * @param accountAddress The target account.
     * @param guardian The address to check.
     * @return `true` if the address is a guardian for the account otherwise `false`.
     */
    public async isGuardian(
        rpcUrl: string,
        accountAddress: string,
        guardian: string,
    ):Promise<boolean>{
        const functionSignature = "isGuardian(address,address)";
        const functionSelector = getFunctionSelector(
            functionSignature,
        );
        const callData = createCallData(
            functionSelector,
            ["address", "address"],
            [accountAddress, guardian],
        );

        const ethCallParams ={
            to: this.moduleAddress,
            data: callData,
        };
        const recoveryRequestResult = await sendEthCallRequest(rpcUrl, ethCallParams, "latest");
        const abiCoder = AbiCoder.defaultAbiCoder();
	    const decodedCalldata = abiCoder.decode(
            ["bool"], recoveryRequestResult);

        return Boolean(decodedCalldata[0]);
    }

    /**
     * Counts the number of active guardians for an account.
     * @param accountAddress The target account.
     * @return The number of active guardians for an account.
     */
    public async guardiansCount(
        rpcUrl: string,
        accountAddress: string,
    ):Promise<bigint>{
        const functionSignature = "guardiansCount(address)";
        const functionSelector = getFunctionSelector(
            functionSignature,
        );
        const callData = createCallData(
            functionSelector,
            ["address"],
            [accountAddress],
        );

        const ethCallParams ={
            to: this.moduleAddress,
            data: callData,
        };
        const recoveryRequestResult = await sendEthCallRequest(rpcUrl, ethCallParams, "latest");

        const abiCoder = AbiCoder.defaultAbiCoder();
	    const decodedCalldata = abiCoder.decode(
            ["uint256"], recoveryRequestResult);

        return BigInt(decodedCalldata[0]);
    }

    /**
     * Retrieves the account threshold.
     * @param accountAddress The target account.
     * @return Threshold.
     */
    public async threshold(
        rpcUrl: string,
        accountAddress: string,
    ):Promise<bigint>{
        const functionSignature = "threshold(address)";
        const functionSelector = getFunctionSelector(
            functionSignature,
        );
        const callData = createCallData(
            functionSelector,
            ["address"],
            [accountAddress],
        );

        const ethCallParams ={
            to: this.moduleAddress,
            data: callData,
        };
        const recoveryRequestResult = await sendEthCallRequest(rpcUrl, ethCallParams, "latest");

        const abiCoder = AbiCoder.defaultAbiCoder();
	    const decodedCalldata = abiCoder.decode(
            ["uint256"], recoveryRequestResult);

        return BigInt(decodedCalldata[0]);
    }

    /**
     * Get the active guardians for an account.
     * @param accountAddress The target account.
     * @return the active guardians for an account.
     */
    public async getGuardians(
        rpcUrl: string,
        accountAddress: string,
    ):Promise<string[]>{
        const functionSignature = "getGuardians(address)";
        const functionSelector = getFunctionSelector(
            functionSignature,
        );
        const callData = createCallData(
            functionSelector,
            ["address"],
            [accountAddress],
        );

        const ethCallParams ={
            to: this.moduleAddress,
            data: callData,
        };
        const recoveryRequestResult = await sendEthCallRequest(rpcUrl, ethCallParams, "latest");

        const abiCoder = AbiCoder.defaultAbiCoder();
	    const decodedCalldata = abiCoder.decode(
            ["address[]"], recoveryRequestResult);

        return decodedCalldata[0];
    }

    /**
     * Get the module nonce for an account.
     * @param accountAddress The target account.
     * @return the nonce for this account.
     */
    public async nonce(
        rpcUrl: string,
        accountAddress: string,
    ):Promise<bigint>{
        const functionSignature = "nonce(address)";
        const functionSelector = getFunctionSelector(
            functionSignature,
        );
        const callData = createCallData(
            functionSelector,
            ["address"],
            [accountAddress],
        );

        const ethCallParams ={
            to: this.moduleAddress,
            data: callData,
        };
        const recoveryRequestResult = await sendEthCallRequest(rpcUrl, ethCallParams, "latest");

        const abiCoder = AbiCoder.defaultAbiCoder();
	    const decodedCalldata = abiCoder.decode(
            ["uint256"], recoveryRequestResult);

        return BigInt(decodedCalldata[0]);
    }

}

export type RecoveryRequest  = {
    guardiansApprovalCount:bigint;
    newThreshold:bigint;
    executeAfter:number;
    newOwners:string[];
}

type EthCallTransaction = {
    from?:string;
    to:string;
    gas?:bigint;
    gasPrice?:bigint;
    value?:bigint;
    data?:string;
}

async function sendEthCallRequest(
    rpcUrl: string,
    ethCallTransaction: EthCallTransaction,
    blockNumber: string|bigint,
): Promise<string> {
    const params = [
        ethCallTransaction,
        blockNumber
    ];

    try {
        const data = await sendJsonRpcRequest(rpcUrl, "eth_call", params);

        if (typeof data === "string") {
            try {
                return data;
            } catch (err) {
                const error = ensureError(err);

                throw new AbstractionKitError(
                    "BAD_DATA",
                    "eth_call returned ill formed data",
                    {
                        cause: error,
                    },
                );
            }
        } else {
            throw new AbstractionKitError(
                "BAD_DATA",
                "eth_call returned ill formed data",
                {
                    context: JSON.stringify(data),
                },
            );
        }
    } catch (err) {
        const error = ensureError(err);

        throw new AbstractionKitError("BAD_DATA", "eth_call failed", {
            cause: error,
        });
    }
}
