import { Paymaster } from "./Paymaster";
import { UserOperationV6, UserOperationV7, UserOperationV8 } from "../types";
import { AbiCoder, keccak256 } from "ethers";

export class WorldIdPermissionlessPaymaster extends Paymaster {
	readonly address: string;

	constructor(address: string) {
		super();
		this.address = address;
	}

	/**
	 * createPaymasterUserOperation will estimate gas and set the paymaster fields.
	 * @param userOperation - User operation to be sponsored
	 * @param root - Worldid Merkle tree root
	 * @param proof - Worldid zk proof
	 * @returns UserOperationV8 | UserOperationV7 | UserOperationV6
	 */
	createPaymasterUserOperation(
		userOperation: UserOperationV8,
        root:bigint,
        proof: string,
	):UserOperationV8;
	createPaymasterUserOperation(
		userOperation: UserOperationV7,
        root:bigint,
        proof: string,
	):UserOperationV7;
	createPaymasterUserOperation(
		userOperation: UserOperationV6,
        root:bigint,
        proof: string,
	):UserOperationV6;
	createPaymasterUserOperation(
		userOperation: UserOperationV8 | UserOperationV7 | UserOperationV6,
        root:bigint,
        proof: string,
	):UserOperationV8 | UserOperationV7 | UserOperationV6 {
        //256 bytes for proof
        if(proof.slice(0,2) != "0x" || proof.length != 514){
            throw RangeError("Invalid proof.");
        }

        const abiCoder = AbiCoder.defaultAbiCoder();
        
        const nullifierHash = keccak256(userOperation.sender);
        proof = proof.slice(2);
        const proofArr = [
            "0x" + proof.slice(0,64),
            "0x" + proof.slice(64,128),
            "0x" + proof.slice(128,192),
            "0x" + proof.slice(192,256),
            "0x" + proof.slice(256,320),
            "0x" + proof.slice(320,384),
            "0x" + proof.slice(384,448),
            "0x" + proof.slice(448,512),
        ];
        const paymasterData =
            abiCoder.encode(['uint256'],[root]) + 
            nullifierHash.slice(2) +
            abiCoder.encode(['uint256[8]'],[proofArr]).slice(2);

		if ("initCode" in userOperation) {
            userOperation.paymasterAndData = this.address + paymasterData.slice(2);
        }else{
            userOperation.paymaster = this.address;
            userOperation.paymasterData = paymasterData;
            userOperation.paymasterPostOpGasLimit = 45_000n;
            userOperation.paymasterVerificationGasLimit = 350_000n;
        }
        return userOperation;
	}
}
