import { StateOverrideSet, UserOperationV9 } from "src/types";
import { BaseSimple7702Account, SimpleMetaTransaction } from "./Simple7702Account";
import { ENTRYPOINT_V9 } from "src/constants";
import { SendUseroperationResponse } from "../SendUseroperationResponse";
import { CreateUserOperationV9Overrides } from "src/abstractionkit";

/**
 * EIP-7702 simple smart account targeting EntryPoint v0.9
 * (`0x433709009B8330FDa32311DF1C2AFA402eD8D009`).
 * Extends {@link BaseSimple7702Account} with concrete types for
 * {@link UserOperationV9} and sensible defaults for the delegatee address.
 */
export class Simple7702AccountV09 extends BaseSimple7702Account {
	static readonly DEFAULT_DELEGATEE_ADDRESS = "0xa46cc63eBF4Bd77888AA327837d20b23A63a56B5";

	/**
	 * @param accountAddress - The EOA address that will be delegated via EIP-7702
	 * @param overrides - Optional overrides for entrypoint and delegatee addresses
	 * @param overrides.entrypointAddress - Custom EntryPoint address (defaults to EntryPoint v0.9)
	 * @param overrides.delegateeAddress - Custom delegatee contract address
	 */
	constructor(
		accountAddress: string,
        overrides: {
			entrypointAddress?: string;
            delegateeAddress?:string;
		} = {},
	) {
		super(
            accountAddress,
            overrides.entrypointAddress ?? ENTRYPOINT_V9,
            overrides.delegateeAddress ?? Simple7702AccountV09.DEFAULT_DELEGATEE_ADDRESS
        );
	}
    
	/**
	 * createUserOperation will determine the nonce, fetch the gas prices,
	 * estimate gas limits and return a useroperation to be signed.
	 * you can override all these values using the overrides parameter.
	 * @param transactions - metatransaction list to be encoded
	 * @param providerRpc - node rpc to fetch account nonce and gas prices
	 * @param bundlerRpc - bundler rpc for gas estimation
	 * @param overrides - overrides for the default values
	 * @returns promise with useroperation
	 */
	public async createUserOperation(
		transactions: SimpleMetaTransaction[],
		providerRpc?: string,
		bundlerRpc?: string,
		overrides: CreateUserOperationV9Overrides = {},
	): Promise<UserOperationV9> {
        const userOperationV9: UserOperationV9 =
			await this.baseCreateUserOperation(
                transactions,
                providerRpc,
                bundlerRpc,
                overrides,
            );

		userOperationV9.paymaster = overrides.paymaster??null;
		userOperationV9.paymasterVerificationGasLimit =
            overrides.paymasterVerificationGasLimit??null;
		userOperationV9.paymasterPostOpGasLimit =
            overrides.paymasterPostOpGasLimit??null;
		userOperationV9.paymasterData = overrides.paymasterData??null;

		return userOperationV9;
	}

    /**
	 * Estimate gas limits for a {@link UserOperationV9}.
	 * @param userOperation - The UserOperation to estimate gas for
	 * @param bundlerRpc - Bundler RPC endpoint for gas estimation
	 * @param overrides - Optional overrides
	 * @param overrides.stateOverrideSet - State overrides to apply during estimation
	 * @param overrides.dummySignature - Custom dummy signature for estimation
	 * @returns A promise resolving to `[preVerificationGas, verificationGasLimit, callGasLimit]`
	 */
    public async estimateUserOperationGas(
		userOperation: UserOperationV9,
		bundlerRpc: string,
		overrides: {
			stateOverrideSet?: StateOverrideSet;
	        dummySignature?: string;
		} = {},
	): Promise<[bigint, bigint, bigint]> {
        return this.baseEstimateUserOperationGas(
            userOperation,
            bundlerRpc,
            overrides
        );
    }

    /**
	 * Sign a {@link UserOperationV9} with an EOA private key.
	 * Computes the UserOperation hash and produces an ECDSA signature.
	 * @param useroperation - The UserOperation to sign
	 * @param privateKey - Hex-encoded private key of the EOA signer
	 * @param chainId - Target chain ID
	 * @returns Hex-encoded ECDSA signature
	 */
    public signUserOperation(
		useroperation: UserOperationV9,
		privateKey: string,
		chainId: bigint,
    ): string {
        return this.baseSignUserOperation(useroperation, privateKey, chainId);
    }

    /**
	 * Send a signed {@link UserOperationV9} to a bundler for on-chain inclusion.
	 * @param userOperation - The signed UserOperation to submit
	 * @param bundlerRpc - Bundler RPC endpoint
	 * @returns A {@link SendUseroperationResponse} that can be used to wait for inclusion
	 */
	public async sendUserOperation(
		userOperation: UserOperationV9,
		bundlerRpc: string,
	): Promise<SendUseroperationResponse> {
        return this.baseSendUserOperation(userOperation, bundlerRpc);
    }
}
