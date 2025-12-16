import { StateOverrideSet, UserOperationV9 } from "src/types";
import { BaseSimple7702Account, CreateUserOperationOverrides, SimpleMetaTransaction } from "./Simple7702Account";
import { ENTRYPOINT_V9 } from "src/constants";
import { SendUseroperationResponse } from "../SendUseroperationResponse";

/**
 * Simple7702Account with entrypoint v0.09
 */
export class Simple7702AccountV09 extends BaseSimple7702Account {
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
            overrides.delegateeAddress ?? "0xa46cc63eBF4Bd77888AA327837d20b23A63a56B5"
        );
	}

    /**
	 * baseCreateUserOperation will determine the nonce, fetch the gas prices,
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
		overrides: CreateUserOperationOverrides = {},
	): Promise<UserOperationV9> {
        return this.baseCreateUserOperation(
            transactions,
            providerRpc,
            bundlerRpc,
            overrides,
        );
    }

    /**
	 * estimate gas limits for a useroperation
	 * @param userOperation - useroperation to estimate gas for
	 * @param bundlerRpc - bundler rpc for gas estimation
	 * @param overrides - overrides for the default values
	 * @param overrides.stateOverrideSet - state override values to set during gs estimation
	 * @param overrides.dummySignature - a single eoa dummy signature
	 * @returns promise with [preVerificationGas, verificationGasLimit, callGasLimit]
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
	 * create a useroperation signature
	 * @param useroperation - useroperation to sign
	 * @param privateKeys - for the signers
	 * @param chainId - target chain id
	 * @returns signature
	 */
    public signUserOperation(
		useroperation: UserOperationV9,
		privateKey: string,
		chainId: bigint,
    ): string {
        return this.baseSignUserOperation(useroperation, privateKey, chainId);
    }

    /**
	 * sends a useroperation to a bundler rpc
	 * @param userOperation - useroperation to send
	 * @param bundlerRpc - bundler rpc to send useroperation
	 * @returns promise with SendUseroperationResponse
	 */
	public async sendUserOperation(
		userOperation: UserOperationV9,
		bundlerRpc: string,
	): Promise<SendUseroperationResponse> {
        return this.baseSendUserOperation(userOperation, bundlerRpc);
    }
}
