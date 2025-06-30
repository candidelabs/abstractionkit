import { Paymaster } from "./Paymaster";
import { StateOverrideSet, UserOperationV6, UserOperationV7, UserOperationV8 } from "../types";
import { AbiCoder, keccak256, solidityPacked } from "ethers";
import { ENTRYPOINT_V7, ENTRYPOINT_V8 } from "src/constants";
import { Bundler } from "src/Bundler";

export class WorldIdPermissionlessPaymaster extends Paymaster {
	readonly address: string;

	constructor(address: string) {
		super();
		this.address = address;
	}

	/**
	 * createPaymasterUserOperation will estimate gas and set the paymaster fields.
	 * @param userOperation - User operation to be sponsored
	 * @param bundlerRpc - Bundler endpoint rpc url
     * @param nullifierHash - nullifier hash
	 * @param root - Worldid Merkle tree root
	 * @param proof - Worldid zk proof
	 * @param overrides - Overrides for the default values
	 * @returns a promise of UserOperationV8 | UserOperationV7
	 */
	async createPaymasterUserOperation(
		userOperation: UserOperationV8,
        bundlerRpc: string,
        nullifierHash: bigint,
        root:bigint,
        proof: string,
		overrides?:{
            /** set the entrypoint address intead of determining it from the useroperation structure.*/
            entrypoint?: string;

            /** pass some state overrides for gas estimation"*/
            state_override_set?: StateOverrideSet;
        }
	):Promise<UserOperationV8>;
	async createPaymasterUserOperation(
		userOperation: UserOperationV7,
        bundlerRpc: string,
        nullifierHash: bigint,
        root:bigint,
        proof: string,
		overrides?:{
            /** set the entrypoint address intead of determining it from the useroperation structure.*/
            entrypoint?: string;

            /** pass some state overrides for gas estimation"*/
            state_override_set?: StateOverrideSet;
        }
	):Promise<UserOperationV7>;
	async createPaymasterUserOperation(
		userOperation: UserOperationV8 | UserOperationV7,
        bundlerRpc: string,
        nullifierHash: bigint,
        root:bigint,
        proof: string,
		overrides?:{
            /** set the entrypoint address intead of determining it from the useroperation structure.*/
            entrypoint?: string;
            /** pass some state overrides for gas estimation"*/
            state_override_set?: StateOverrideSet;
        }
	):Promise<UserOperationV8 | UserOperationV7> {
        //256 bytes for proof
        if(proof.slice(0,2) != "0x" || proof.length != 514){
            throw RangeError("Invalid proof.");
        }

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

        const abiCoder = AbiCoder.defaultAbiCoder();
        const paymasterData =
            abiCoder.encode(['uint256'],[root]) + 
            abiCoder.encode(['uint256'],[nullifierHash]).slice(2) + 
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


/**
 * createWorldIdSignal is a helper function to work with "@worldcoin/idkit
 * @param accountAddress - account address
 * @param accountNonce - account nonce
 * @param chainId - chain id
 * @returns idkit IDKitWidget signal
 */
export function createWorldIdSignal(
    accountAddress: string,
    accountNonce: bigint,
    chainId: bigint,
):string {
    return keccak256(
        solidityPacked(
            ["address", "uint256", "uint256"],
            [accountAddress, accountNonce, chainId]
        )
    )
}
