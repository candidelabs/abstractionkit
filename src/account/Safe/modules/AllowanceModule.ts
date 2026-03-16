import { SafeModule } from "./SafeModule";
import { createCallData, sendEthCallRequest } from "../../../utils";
import { MetaTransaction } from "../../../types";

/**
 * Address of the legacy Allowance Module v0.1.0 contract.
 * Replaced by v1.0.0 due to a bug in the v0.1.0 contract.
 * Use this to interact with existing allowances set on the old module.
 * @deprecated Prefer `AllowanceModule.DEFAULT_ALLOWANCE_MODULE_ADDRESS` (v1.0.0) for new allowances.
 */
export const ALLOWANCE_MODULE_V0_1_0_ADDRESS =
    "0xAA46724893dedD72658219405185Fb0Fc91e091C";

/**
 * Safe module for managing token spending allowances (v1.0.0). Enables Safe owners
 * to grant delegates recurring or one-time permission to transfer ERC-20
 * tokens from the Safe, subject to configurable limits and reset periods.
 *
 * Requires Safe v1.1.1 or later.
 *
 * Each delegate is limited to 65534 transfers per token allowance (uint16 nonce).
 * Once exhausted, a new delegate must be used.
 *
 * **Breaking change (v1.0.0):** The default module address changed from
 * {@link ALLOWANCE_MODULE_V0_1_0_ADDRESS} (`0xAA46…091C`) due to a bug in the
 * v0.1.0 contract. If you have active allowances on the old module, use
 * `new AllowanceModule(ALLOWANCE_MODULE_V0_1_0_ADDRESS)` to interact with them.
 */
export class AllowanceModule extends SafeModule{
    static readonly DEFAULT_ALLOWANCE_MODULE_ADDRESS =
        "0x691f59471Bfd2B7d639DCF74671a2d648ED1E331";

    /**
     * @param moduleAddress - Deployed address of the Allowance Module contract.
     *   Defaults to {@link DEFAULT_ALLOWANCE_MODULE_ADDRESS}.
     */
    constructor(
		moduleAddress: string = AllowanceModule.DEFAULT_ALLOWANCE_MODULE_ADDRESS,
	) {
		super(moduleAddress);
	}
        
    /**
     * Creates a MetaTransaction that sets a one-time (non-recurring) token allowance
     * for a delegate. The allowance is consumed once and never resets.
     * @param delegate - Address of the delegate to grant the allowance to.
     * @param token - ERC-20 token contract address (use zero address for native token).
     * @param allowanceAmount - Maximum amount the delegate can spend, in the token's smallest unit.
     * @param startAfterInMinutes - Delay in minutes before the allowance becomes active.
     * @returns A MetaTransaction to be executed by the Safe.
     */
    public createOneTimeAllowanceMetaTransaction(
        delegate: string,
        token: string,
        allowanceAmount: bigint,
        startAfterInMinutes:bigint
    ):MetaTransaction{
        return this.createBaseSetAllowanceMetaTransaction(
            delegate,
            token,
            allowanceAmount,
            0n,
            startAfterInMinutes
        )
    }
    
    /**
     * Creates a MetaTransaction that sets a recurring token allowance for a delegate.
     * The allowance resets to the full amount after each validity period elapses.
     * @param delegate - Address of the delegate to grant the allowance to.
     * @param token - ERC-20 token contract address (use zero address for native token).
     * @param allowanceAmount - Maximum amount per period, in the token's smallest unit.
     * @param recurringAllowanceValidityPeriodInMinutes - Duration of each allowance period in minutes.
     * @param startAfterInMinutes - Delay in minutes before the first allowance period begins.
     * @returns A MetaTransaction to be executed by the Safe.
     */
    public createRecurringAllowanceMetaTransaction(
        delegate: string,
        token: string,
        allowanceAmount: bigint,
        recurringAllowanceValidityPeriodInMinutes: bigint,
        startAfterInMinutes:bigint
    ):MetaTransaction{
        return this.createBaseSetAllowanceMetaTransaction(
            delegate,
            token,
            allowanceAmount,
            recurringAllowanceValidityPeriodInMinutes,
            startAfterInMinutes
        )
    }

    /**
	 * create MetaTransaction that allows to update the allowance for 
     * a specified token. This can only be done via a Safe transaction.
     * @param delegate - Delegate whose allowance should be updated.
     * @param token - Token contract address.
     * @param allowanceAmount - allowance in smallest token unit.
     * @param resetTimeMin - Time after which the allowance should reset
     * @param resetBaseMin - Time based on which the reset time should be increased
     * @returns a MetaTransaction
	 */
    public createBaseSetAllowanceMetaTransaction(
        delegate: string,
        token: string,
        allowanceAmount: bigint,
        resetTimeMin: bigint,
        resetBaseMin:bigint
    ):MetaTransaction{
        //setAllowance(address delegate, address token, uint96 allowanceAmount, uint16 resetTimeMin, uint32 resetBaseMin)
        const functionSelector = "0xbeaeb388";
        const callData = createCallData(
            functionSelector,
            ["address", "address", "uint96", "uint16", "uint32"],
            [delegate, token, allowanceAmount, resetTimeMin, resetBaseMin],
        );
        return {
            to:this.moduleAddress,
            data: callData,
            value: 0n
        }
    }
    
    /**
     * create MetaTransaction that allows to renew(reset) the allowance for a specific
     * delegate and token.
     * @param delegate - Delegate whose allowance should be updated.
     * @param token - Token contract address.
	 * @returns a MetaTransaction
     */
    public createRenewAllowanceMetaTransaction(
        delegate: string, token: string
    ):MetaTransaction{
        //resetAllowance(address delegate, address token)
        const functionSelector = "0xc19bf50e";
        const callData = createCallData(
            functionSelector,
            ["address", "address"],
            [delegate, token],
        );
        return {
            to:this.moduleAddress,
            data: callData,
            value: 0n
        }
    }
    
    /**
     * create MetaTransaction that allows to remove the allowance for a specific
     * delegate and token. This will set all values except the `nonce` to 0.
     * @param delegate - Delegate whose allowance should be updated.
     * @param token - Token contract address.
	 * @returns a MetaTransaction
     */
    public createDeleteAllowanceMetaTransaction(
        delegate: string, token: string
    ):MetaTransaction{
        //deleteAllowance(address delegate, address token)
        const functionSelector = "0x885133e3";
        const callData = createCallData(
            functionSelector,
            ["address", "address"],
            [delegate, token],
        );
        return {
            to:this.moduleAddress,
            data: callData,
            value: 0n
        }
    }
    
    /**
     * Creates a MetaTransaction that executes a token transfer using an existing allowance.
     * Can be called by the delegate or by anyone with a valid delegate signature.
     * @param allowanceSourceSafeAddress - Safe address whose allowance is being spent.
     * @param token - ERC-20 token contract address to transfer.
     * @param to - Recipient address for the token transfer.
     * @param amount - Amount to transfer, in the token's smallest unit.
     * @param delegate - Delegate address whose allowance is being used.
     * @param overrides.delegateSignature - Optional signature from the delegate. Defaults to a
     *   sentinel value indicating the caller is the delegate themselves.
     * @param overrides.paymentToken - Optional token address used to pay for execution.
     * @param overrides.paymentAmount - Amount to pay for execution (required if paymentToken is set).
     * @returns A MetaTransaction to be executed by the Safe.
     * @throws Will revert on-chain if the delegate's nonce has reached 65534 for this token.
     */
    public createAllowanceTransferMetaTransaction(
        allowanceSourceSafeAddress: string,
        token: string,
        to: string,
        amount: bigint,
        delegate:string,
        overrides:{
            delegateSignature?:string,
            paymentToken?: string,
            paymentAmount?: bigint,
        } = {}
    ):MetaTransaction{
        let paymentToken = "0x0000000000000000000000000000000000000000"
        let paymentAmount = 0n;
        if(overrides.paymentToken != null){
            paymentToken = overrides.paymentToken;
            if(overrides.paymentAmount == null){
                throw new RangeError("must specify paymentAmount if paymentToken is set")
            }
            paymentAmount = overrides.paymentAmount;
        }
        
        let delegateSignature = 
            overrides.delegateSignature??
		    "0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001"

        return this.createBaseExecuteAllowanceTransferMetaTransaction(
            allowanceSourceSafeAddress,
            token,
            to,
            amount,
            paymentToken,
            paymentAmount,
            delegate,
            delegateSignature
        )
    }

    /**
     * 
     * create MetaTransaction that allows to use the allowance to perform a transfer.
     * @param safeAddress - The Safe whose funds should be used.
     * @param token - Token contract address.
     * @param to - Address that should receive the tokens.
     * @param amount - Amount that should be transferred.
     * @param paymentToken - Token that should be used to pay for the execution of the transfer.
     * @param payment - Amount to should be paid for executing the transfer.
     * @param delegate - Delegate whose allowance should be updated.
     * @param signature - Signature generated by the delegate to authorize the transfer.
	 * @returns a MetaTransaction
     */
    public createBaseExecuteAllowanceTransferMetaTransaction(
        safeAddress: string,
        token: string,
        to: string,
        amount: bigint,
        paymentToken: string,
        payment: bigint,
        delegate:string,
        delegateSignature:string
    ):MetaTransaction{
        //executeAllowanceTransfer(address,address,address,uint96,address,uint96,address,bytes)
        const functionSelector = "0x4515641a";
        const callData = createCallData(
            functionSelector,
            [
                "address",
                "address",
                "address",
                "uint96",
                "address",
                "uint96",
                "address",
                "bytes",
            ],
            [
                safeAddress,
                token,
                to,
                amount,
                paymentToken,
                payment,
                delegate,
                delegateSignature
            ]
        );
        return {
            to:this.moduleAddress,
            data: callData,
            value: 0n
        }
    }

    /**
     * create a MetaTransaction that allows to add a delegate.
     * @param delegate - Delegate that should be added.
	 * @returns a MetaTransaction
     */
    public createAddDelegateMetaTransaction(
        delegate: string,
    ):MetaTransaction{
        //"addDelegate(address)"
        const functionSelector = "0xe71bdf41";
        const callData = createCallData(
            functionSelector,
            ["address"],
            [delegate],
        );
        return {
            to:this.moduleAddress,
            data: callData,
            value: 0n
        }
    }
    
    /**
     * create a MetaTransaction that allows to remove a delegate.
     * @param delegate - Delegate that should be removed.
     * @param removeAllowances - Indicator if allowances should also be removed.
     * This should be set to `true` unless this causes an out of gas,
     * in this case the allowances should be "manually" deleted via `deleteAllowance`.
	 * @returns a MetaTransaction
     */
    public createRemoveDelegateMetaTransaction(
        delegate: string,
        removeAllowances: boolean
    ):MetaTransaction{
        //"removeDelegate(address,bool)"
        const functionSelector = "0xdd43a79f";
        const callData = createCallData(
            functionSelector,
            ["address", "bool"],
            [delegate, removeAllowances],
        );
        return {
            to:this.moduleAddress,
            data: callData,
            value: 0n
        }
    }

    
    /**
     * Get delegated tokens
     * @param nodeRpcUrl - The JSON-RPC API url for the target chain.
     * @param safeAddress - The target account.
     * @param delegate - The target delegate.
	 * @returns promise of a list of tokens
     */
    public async getTokens(
        nodeRpcUrl: string,
        safeAddress: string,
        delegate: string,
    ):Promise<string[]>{
        //"getTokens(address,address)"
        const functionSelector = "0x8d0e8e1d";
        const callData = createCallData(
            functionSelector,
            ["address", "address"],
            [safeAddress, delegate],
        );

        const ethCallParams ={
            to: this.moduleAddress,
            data: callData,
        };

        const tokens = await sendEthCallRequest(nodeRpcUrl, ethCallParams, "latest");
        this.checkForEmptyResultAndRevert(tokens, "getTokens");
	    const decodedCalldata = this.abiCoder.decode(
            ["address[]"], tokens);
        return decodedCalldata[0];
    }

    /**
     * Get allowance
     * @param nodeRpcUrl - The JSON-RPC API url for the target chain.
     * @param safeAddress - The target account.
     * @param delegate - The target delegate.
     * @param token - The target delegate.
	 * @returns promise of Allowance
    */
    public async getTokensAllowance(
        nodeRpcUrl: string,
        safeAddress: string,
        delegate: string,
        token: string,
    ):Promise<Allowance>{
        //"getTokenAllowance(address,address,address)"
        const functionSelector = "0x94b31fbd";
        const callData = createCallData(
            functionSelector,
            ["address", "address", "address"],
            [safeAddress, delegate, token],
        );

        const ethCallParams ={
            to: this.moduleAddress,
            data: callData,
        };

        const tokenAllowance = await sendEthCallRequest(
            nodeRpcUrl, ethCallParams, "latest");
        this.checkForEmptyResultAndRevert(tokenAllowance, "getTokenAllowance");
	    const decodedCalldata = this.abiCoder.decode(["uint256[5]"], tokenAllowance);
        const allowance = decodedCalldata[0]
        return {
            amount: BigInt(allowance[0]),
            spent: BigInt(allowance[1]),
            resetTimeMin: BigInt(allowance[2]),
            lastResetMin: BigInt(allowance[3]),
            nonce: BigInt(allowance[4]),
        };
    }

    /**
     * Fetches all delegate addresses for a Safe. Automatically paginates through
     * all results unless `maxNumberOfResults` is specified.
     * @param nodeRpcUrl - JSON-RPC endpoint URL for the target chain.
     * @param safeAddress - The Safe account address to query delegates for.
     * @param overrides.start - Starting index for pagination (default 0).
     * @param overrides.maxNumberOfResults - Maximum number of delegates to return.
     *   If omitted, all delegates are fetched via automatic pagination.
     * @returns Array of delegate addresses.
     */
    public async getDelegates(
        nodeRpcUrl: string,
        safeAddress: string,
        overrides:{
            start?: bigint,
            maxNumberOfResults?: bigint,
        } = {}
    ):Promise<string[]>{
       let start = overrides.start??0n
       if(overrides.maxNumberOfResults != null){
           return (await this.baseGetDelegates(
               nodeRpcUrl,
               safeAddress,
               start,
               overrides.maxNumberOfResults
           )).results
       }
       const pageSize = 20n;
       const delegates:string[] = [];
       while(true){
           const getDelegatesResult = await this.baseGetDelegates(
               nodeRpcUrl,
               safeAddress,
               start,
               pageSize
           )
           delegates.push.apply(delegates, getDelegatesResult.results)
           if(getDelegatesResult.next == 0n){
               break;
           }else{
               start = getDelegatesResult.next;
           }
       }
        return delegates;
    }

    /**
     * Get delegates 
     * @param nodeRpcUrl - The JSON-RPC API url for the target chain.
     * @param safeAddress - The target account.
     * @return promise of the account's current recovery request
     */
    public async baseGetDelegates(
        nodeRpcUrl: string,
        safeAddress: string,
        start: bigint,
        pageSize: bigint,
    ):Promise<{results:string[], next:bigint}>{
        //"getDelegates(address,uint48,uint8)"
        const functionSelector = "0xeb37abe0";
        const callData = createCallData(
            functionSelector,
            ["address", "uint48", "uint8"],
            [safeAddress, start, pageSize],
        );

        const ethCallParams ={
            to: this.moduleAddress,
            data: callData,
        };

        const delegates = await sendEthCallRequest(
            nodeRpcUrl, ethCallParams, "latest");
        this.checkForEmptyResultAndRevert(delegates, "getDelegates");
	    const decodedCalldata = this.abiCoder.decode(
            ["address[]", "uint48"], delegates);

        return {
            results: decodedCalldata[0],
            next: BigInt(decodedCalldata[1]),
        }
    }
}

/**
 * On-chain allowance state for a delegate/token pair on a Safe account.
 */
export type Allowance  = {
    /** Total allowance amount per period, in the token's smallest unit. */
    amount: bigint,
    /** Amount already spent in the current period. */
    spent: bigint,
    /** Reset period duration in minutes. 0 means one-time (non-recurring). */
    resetTimeMin: bigint,
    /** Timestamp (in minutes since epoch) of the last allowance reset. */
    lastResetMin: bigint,
    /**
     * Monotonically increasing nonce, incremented on each allowance transfer.
     * Capped at 65534 (uint16 max - 1); once exhausted, a new delegate is required.
     */
    nonce: bigint,
}
