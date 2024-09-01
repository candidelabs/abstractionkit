import { SafeModule } from "./SafeModule";
import { AbstractionKitError,ensureError } from "src/errors";
import { createCallData, sendEthCallRequest, sendJsonRpcRequest } from "../../../utils";
import { MetaTransaction } from "../../../types";
import { AbiCoder } from "ethers";

export enum SocialRecoveryModuleGracePeriodSelector {
	After3Minutes = "0x949d01d424bE050D09C16025dd007CB59b3A8c66",
	After3Days = "0x38275826E1933303E508433dD5f289315Da2541c",
	After7Days = "0x088f6cfD8BB1dDb1BB069CCb3fc1A98927D233f2",
	After14Days = "0x9BacD92F4687Db306D7ded5d4513a51EA05df25b",
}

export class SocialRecoveryModule extends SafeModule{
    static readonly DEFAULT_SOCIAL_RECOVERY_ADDRESS =
        SocialRecoveryModuleGracePeriodSelector.After3Days;

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
        //"confirmRecovery(address,address[],uint256,bool)"
        const functionSelector = "0x064e2d0e";
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
     * @param signatureData The guardians signers and signatures pair list.
     * @param execute Whether to auto-start execution of recovery.
	 * @returns a MetaTransaction
     */
    public createMultiConfirmRecoveryMetaTransaction(
        accountAddress: string,
        newOwners: string[],
        newThreshold: number,
        signatureData: RecoverySignatureData,
        execute: boolean
    ):MetaTransaction{
        //"multiConfirmRecovery(address,address[],uint256,SignatureData[],bool)"
        const functionSelector = "0x0728e1e7";
        const callData = createCallData(
            functionSelector,
            ["address", "address[]", "uint256", "(address,bytes)", "bool"],
            [
                accountAddress,
                newOwners,
                newThreshold,
                [signatureData.signer, signatureData.signature],
                execute
            ],
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
        //"executeRecovery(address,address[],uint256)"
        const functionSelector = "0xb1f85f69";
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
        //"finalizeRecovery(address)"
        const functionSelector = "0x315a7af3";
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
	 * @returns a MetaTransaction
     */
    public createCancelRecoveryMetaTransaction():MetaTransaction{
        //"cancelRecovery()";
        const functionSelector = "0x0ba234d6";
        const callData = functionSelector;

        return {
            to:this.moduleAddress,
            data: callData,
            value: 0n
        }
    }

    /**
     * create a MetaTransaction that lets the owner add a guardian for its account.
     * @param guardian The guardian to add.
     * @param threshold The new threshold that will be set after addition.
	 * @returns a MetaTransaction
     */
    public createAddGuardianWithThresholdMetaTransaction(
        guardianAddress: string,
        threshold: bigint,
    ):MetaTransaction{
        //"addGuardianWithThreshold(address,uint256)"
        const functionSelector = "0xbe0e54d7";
        const callData = createCallData(
            functionSelector,
            ["address", "uint256"],
            [guardianAddress, threshold],
        );
        return {
            to:this.moduleAddress,
            data: callData,
            value: 0n
        }
    }
    
    /**
     * create MetaTransaction that lets the owner revoke a guardian from its account.
     * @param nodeRpcUrl The JSON-RPC API url for the target chain
     * (to get the prevGuardian paramter).
     * @param accountAddress The target account.
     * @param guardianAddress The guardian to revoke.
     * @param threshold The new threshold that will be set after execution of revokation.
     * @param prevGuardian (if not provided, will be detected using the nodeRpcUrl)
     * The previous guardian linking to the guardian in the linked list.
	 * @returns a MetaTransaction
     */
    public async createRevokeGuardianWithThresholdMetaTransaction(
        nodeRpcUrl: string,
        accountAddress: string,
        guardianAddress: string,
        threshold: bigint,
        prevGuardianAddress?: string,
    ):Promise<MetaTransaction>{
        let prevGuardianAddressT = prevGuardianAddress;
		if (prevGuardianAddressT == null) {
			const guardians = await this.getGuardians(nodeRpcUrl, accountAddress);
			const guardianToDeleteIndex = guardians.indexOf(guardianAddress);
			if (guardianToDeleteIndex == -1) {
				throw RangeError(
                    guardianAddress + 
                    " is not a current guardian for account : " +
                    accountAddress
                );
			} else if (guardianToDeleteIndex == 0) {
                //SENTINEL_ADDRESS
				prevGuardianAddressT = "0x0000000000000000000000000000000000000001";
			} else if (guardianToDeleteIndex > 0) {
				prevGuardianAddressT = guardians[guardianToDeleteIndex - 1];
			} else {
				throw RangeError("Invalid guardian index");
			}
		}
		return this.createStandardRevokeGuardianWithThresholdMetaTransaction(
			prevGuardianAddressT,
            guardianAddress,
			threshold,
		);
    }

    /**
     * create MetaTransaction that lets the owner revoke a guardian from its account.
     * @param prevGuardian The previous guardian linking to the guardian in the linked list.
     * @param guardian The guardian to revoke.
     * @param threshold The new threshold that will be set after execution of revokation.
	 * @returns a MetaTransaction
     */
    public createStandardRevokeGuardianWithThresholdMetaTransaction(
        prevGuardianAddress: string,
        guardianAddress: string,
        threshold: bigint,
    ):MetaTransaction{
        //"revokeGuardianWithThreshold(address,address,uint256)"
        const functionSelector = "0x936f7d86";
        const callData = createCallData(
            functionSelector,
            ["address", "address", "uint256"],
            [prevGuardianAddress, guardianAddress, threshold],
        );
        return {
            to:this.moduleAddress,
            data: callData,
            value: 0n
        }
    }

    /**
     * create MetaTransaction that lets the owner change the guardian threshold required to initiate a recovery.
     * @param threshold The new threshold that will be set after execution of revokation.
	 * @returns a MetaTransaction
     */
    public createChangeThresholdMetaTransaction(
        threshold: bigint,
    ):MetaTransaction{
        //"changeThreshold(address,uint256)"
        const functionSelector = "0x694e80c3";
        const callData = createCallData(
            functionSelector,
            ["uint256"],
            [threshold],
        );
        return {
            to:this.moduleAddress,
            data: callData,
            value: 0n
        }
    }

    /**
     * Generates the recovery hash that should be signed by the guardian to authorize a recovery
     * @param nodeRpcUrl The JSON-RPC API url for the target chain.
     * @param accountAddress The target account.
     * @param newOwners The new owners' addressess.
     * @param newThreshold The new threshold for the safe.
     * @param nonce
	 * @returns a recovery hash
     */
    public async getRecoveryHash(
        nodeRpcUrl: string,
        accountAddress: string,
        newOwners: string[],
        newThreshold: number,
        nonce: bigint,
    ):Promise<string>{
        //"getRecoveryHash(address,address[],uint256,uint256)"
        const functionSelector = "0x5f19df08";
        const callData = createCallData(
            functionSelector,
            ["address", "address[]", "uint256", "uint256"],
            [accountAddress, newOwners, newThreshold, nonce],
        );

        const ethCallParams ={
            to: this.moduleAddress,
            data: callData,
        };

        return sendEthCallRequest(nodeRpcUrl, ethCallParams, "latest");
    }

    /**
     * Retrieves the account's current ongoing recovery request.
     * @param nodeRpcUrl The JSON-RPC API url for the target chain.
     * @param accountAddress The target account.
     * @return request The account's current recovery request
     */
    public async getRecoveryRequest(
        nodeRpcUrl: string,
        accountAddress: string,
    ):Promise<RecoveryRequest>{
        //"getRecoveryRequest(address)"
        const functionSelector = "0x4f9a28b9";
        const callData = createCallData(
            functionSelector,
            ["address"],
            [accountAddress],
        );

        const ethCallParams ={
            to: this.moduleAddress,
            data: callData,
        };

        const recoveryRequestResult = await sendEthCallRequest(
            nodeRpcUrl, ethCallParams, "latest");

        const abiCoder = AbiCoder.defaultAbiCoder();
	    const decodedCalldata = abiCoder.decode(
            ["uint256", "uint256", "uint64", "address[]"], recoveryRequestResult);

        return {
            guardiansApprovalCount: BigInt(decodedCalldata[0]),
            newThreshold: BigInt(decodedCalldata[1]),
            executeAfter: BigInt(decodedCalldata[2]),
            newOwners: decodedCalldata[3],
        }
    }

    /**
     * Retrieves the guardian approval count for this particular recovery request at current nonce.
     * @param nodeRpcUrl The JSON-RPC API url for the target chain.
     * @param accountAddress The target account.
     * @param newOwners The new owners' addressess.
     * @param newThreshold The new threshold for the safe.
     * @return The account's current recovery request
     */
    public async getRecoveryApprovals(
        nodeRpcUrl: string,
        accountAddress: string,
        newOwners: string[],
        newThreshold: number,
    ):Promise<bigint>{
        //"getRecoveryApprovals(address,address[],uint256)"
        const functionSelector = "0x6c6595ca";
        const callData = createCallData(
            functionSelector,
            ["address", "address[]", "uint256"],
            [accountAddress, newOwners, newThreshold],
        );

        const ethCallParams ={
            to: this.moduleAddress,
            data: callData,
        };
        const recoveryRequestResult = await sendEthCallRequest(
            nodeRpcUrl, ethCallParams, "latest");

        const abiCoder = AbiCoder.defaultAbiCoder();
	    const decodedCalldata = abiCoder.decode(["uint256"], recoveryRequestResult);

        return BigInt(decodedCalldata[0]);
    }

    /**
     * Retrieves specific guardian approval status a particular recovery request at current nonce.
     * @param nodeRpcUrl The JSON-RPC API url for the target chain.
     * @param accountAddress The target account.
     * @param guardian The guardian.
     * @param newOwners The new owners' addressess.
     * @param newThreshold The new threshold for the safe.
     * @return guardian approval status
     */
    public async hasGuardianApproved(
        nodeRpcUrl: string,
        accountAddress: string,
        guardian: string,
        newOwners: string[],
        newThreshold: number,
    ):Promise<boolean>{
        //"hasGuardianApproved(address,address,address[],uint256)"
        const functionSelector = "0x37d82c36";
        const callData = createCallData(
            functionSelector,
            ["address", "address", "address[]", "uint256"],
            [accountAddress, guardian, newOwners, newThreshold],
        );

        const ethCallParams ={
            to: this.moduleAddress,
            data: callData,
        };
        const recoveryRequestResult = await sendEthCallRequest(
            nodeRpcUrl, ethCallParams, "latest");

        const abiCoder = AbiCoder.defaultAbiCoder();
	    const decodedCalldata = abiCoder.decode(
            ["bool"], recoveryRequestResult);

        return Boolean(decodedCalldata[0]);
    }

    /**
     * Checks if an address is a guardian for an account.
     * @param nodeRpcUrl The JSON-RPC API url for the target chain.
     * @param accountAddress The target account.
     * @param guardian The address to check.
     * @return `true` if the address is a guardian for the account otherwise `false`.
     */
    public async isGuardian(
        nodeRpcUrl: string,
        accountAddress: string,
        guardian: string,
    ):Promise<boolean>{
        //"isGuardian(address,address)"
        const functionSelector = "0xd4ee9734";
        const callData = createCallData(
            functionSelector,
            ["address", "address"],
            [accountAddress, guardian],
        );

        const ethCallParams ={
            to: this.moduleAddress,
            data: callData,
        };
        const recoveryRequestResult = await sendEthCallRequest(
            nodeRpcUrl, ethCallParams, "latest");
        const abiCoder = AbiCoder.defaultAbiCoder();
	    const decodedCalldata = abiCoder.decode(
            ["bool"], recoveryRequestResult);

        return Boolean(decodedCalldata[0]);
    }

    /**
     * Counts the number of active guardians for an account.
     * @param nodeRpcUrl The JSON-RPC API url for the target chain.
     * @param accountAddress The target account.
     * @return The number of active guardians for an account.
     */
    public async guardiansCount(
        nodeRpcUrl: string,
        accountAddress: string,
    ):Promise<bigint>{
        //"guardiansCount(address)"
        const functionSelector = "0xc026e7ee";
        const callData = createCallData(
            functionSelector,
            ["address"],
            [accountAddress],
        );

        const ethCallParams ={
            to: this.moduleAddress,
            data: callData,
        };
        const recoveryRequestResult = await sendEthCallRequest(
            nodeRpcUrl, ethCallParams, "latest");

        const abiCoder = AbiCoder.defaultAbiCoder();
	    const decodedCalldata = abiCoder.decode(
            ["uint256"], recoveryRequestResult);

        return BigInt(decodedCalldata[0]);
    }

    /**
     * Retrieves the account threshold.
     * @param nodeRpcUrl The JSON-RPC API url for the target chain.
     * @param accountAddress The target account.
     * @return Threshold.
     */
    public async threshold(
        nodeRpcUrl: string,
        accountAddress: string,
    ):Promise<bigint>{
        //"threshold(address)"
        const functionSelector = "0xc86ec2bf";
        const callData = createCallData(
            functionSelector,
            ["address"],
            [accountAddress],
        );

        const ethCallParams ={
            to: this.moduleAddress,
            data: callData,
        };
        const recoveryRequestResult = await sendEthCallRequest(
            nodeRpcUrl, ethCallParams, "latest");

        const abiCoder = AbiCoder.defaultAbiCoder();
	    const decodedCalldata = abiCoder.decode(
            ["uint256"], recoveryRequestResult);

        return BigInt(decodedCalldata[0]);
    }

    /**
     * Get the active guardians for an account.
     * @param nodeRpcUrl The JSON-RPC API url for the target chain.
     * @param accountAddress The target account.
     * @return the active guardians for an account.
     */
    public async getGuardians(
        nodeRpcUrl: string,
        accountAddress: string,
    ):Promise<string[]>{
        //"getGuardians(address)"
        const functionSelector = "0xf18858ab";
        const callData = createCallData(
            functionSelector,
            ["address"],
            [accountAddress],
        );

        const ethCallParams ={
            to: this.moduleAddress,
            data: callData,
        };
        const recoveryRequestResult = await sendEthCallRequest(
            nodeRpcUrl, ethCallParams, "latest");

        const abiCoder = AbiCoder.defaultAbiCoder();
	    const decodedCalldata = abiCoder.decode(
            ["address[]"], recoveryRequestResult);

        return decodedCalldata[0];
    }

    /**
     * Get the module nonce for an account.
     * @param nodeRpcUrl The JSON-RPC API url for the target chain.
     * @param accountAddress The target account.
     * @return the nonce for this account.
     */
    public async nonce(
        nodeRpcUrl: string,
        accountAddress: string,
    ):Promise<bigint>{
        //"nonce(address)"
        const functionSelector = "0x70ae92d2";
        const callData = createCallData(
            functionSelector,
            ["address"],
            [accountAddress],
        );

        const ethCallParams ={
            to: this.moduleAddress,
            data: callData,
        };
        const recoveryRequestResult = await sendEthCallRequest(
            nodeRpcUrl, ethCallParams, "latest");

        const abiCoder = AbiCoder.defaultAbiCoder();
	    const decodedCalldata = abiCoder.decode(
            ["uint256"], recoveryRequestResult);

        return BigInt(decodedCalldata[0]);
    }
}

export type RecoveryRequest  = {
    guardiansApprovalCount:bigint;
    newThreshold:bigint;
    executeAfter:bigint;
    newOwners:string[];
}

export type RecoverySignatureData  = {
    signer:bigint;
    signature:string[];
}


