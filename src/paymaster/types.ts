export interface CandidePaymasterContext {
	token?: string;
}

export interface PrependTokenPaymasterApproveAccount {
	prependTokenPaymasterApproveToCallData(
		callData: string,
		tokenAddress: string,
		paymasterAddress: string,
		approveAmount: bigint,
	): string;
}
