/* eslint-disable @typescript-eslint/no-explicit-any */
import type { IProvider } from "@web3auth/base";
import { ethers, getBytes, JsonRpcProvider } from "ethers";

import {
	Bundler,
	CandideAccount,
	UserOperation,
	CandideValidationPaymaster,
	getUserOperationHash,
	UserOperationDummyValues,
	JsonRpcError,
	Operation,
	getFunctionSelector,
	getCallData,
} from "abstractionkit";
import {
	SponsorshipEligibility,
	SupportedERC20Tokens,
} from "abstractionkit/types";

export default class AA {
	private web3AuthSigner: IProvider;
	private smartAccount: CandideAccount;
	private bundler: Bundler;
	private publicRpcProvider;
	private paymaster: CandideValidationPaymaster;

	constructor(web3AuthSigner: IProvider) {
		this.web3AuthSigner = web3AuthSigner;
		this.smartAccount = new CandideAccount();
		this.bundler = new Bundler(
			process.env.NEXT_PUBLIC_BUNDLER_URL as string,
			process.env.NEXT_PUBLIC_ENTRYPOINT_ADDRESS as string,
		);
		this.publicRpcProvider = new JsonRpcProvider(
			process.env.NEXT_PUBLIC_JSON_RPC_NODE_PROVIDER,
		);
		this.paymaster = new CandideValidationPaymaster(
			process.env.NEXT_PUBLIC_ENTRYPOINT_ADDRESS as string,
			process.env.NEXT_PUBLIC_PAYMASTER_RPC as string,
		);
	}

	async getOwners(): Promise<string> {
		try {
			// For ethers v5
			// const provider = new ethers.providers.Web3Provider(this.web3AuthProvider as any);
			const provider = new ethers.BrowserProvider(this.web3AuthSigner as any);
			// For ethers v5
			// const signer = provider.getSigner();
			const signer = await provider.getSigner();
			const address = signer.getAddress();
			return await address;
		} catch (error: unknown) {
			return error as string;
		}
	}

	private async estimateUserOperationGas(userOperation: UserOperation) {
		
		//fetch gas price - use your prefered source
		const feeData = await this.publicRpcProvider.getFeeData();
    	// Adding a factor for gas fluctations, converting to hex format
		userOperation.maxFeePerGas = "0x" + Math.ceil(Number(feeData.maxFeePerGas) * 1.5).toString(16);
		userOperation.maxPriorityFeePerGas = "0x" + Math.ceil(Number(feeData.maxPriorityFeePerGas) * 1.5).toString(16); //convert to hex format
    	let estimation = await this.bundler.estimateUserOperationGas(userOperation);
		
		if ("code" in estimation) {
			console.log(estimation);
		return;
		}

		userOperation.preVerificationGas = "0x" + Math.ceil(Number(estimation.preVerificationGas) * 2).toString(16);
		userOperation.verificationGasLimit = "0x" + Math.ceil(Number(estimation.verificationGasLimit) * 2).toString(16);
		/* 
		if the account is not deployed, it happens sometimes to get a wrong callGasLimit if
		the userop is sponsored by a paymaster. We will hardcode below for now with NUmber(90000) 
		instead of Number(estimation.callGasLimit)
		*/
		userOperation.callGasLimit = "0x" + Number(90000).toString(16);

		return userOperation;
	}

	private async sponsorUserOperationGas(userOperation: UserOperation) {
		const paymasterResult = await this.paymaster.getPaymasterCallDataForGaslessTx(userOperation);

		if ("code" in paymasterResult) {
			const errorresult = paymasterResult as JsonRpcError;
			const errorMessage = errorresult.message;
			console.log(errorMessage);
			return;
		}

		if (userOperation.paymasterAndData) {
			userOperation.paymasterAndData = paymasterResult.paymasterAndData;

			// replace with new gas fields if provided by paymaster results
			userOperation.callGasLimit = paymasterResult.callGasLimit ?? userOperation.callGasLimit;
			userOperation.preVerificationGas = paymasterResult.preVerificationGas ?? userOperation.preVerificationGas;
			userOperation.verificationGasLimit = paymasterResult.verificationGasLimit ?? userOperation.verificationGasLimit;
			userOperation.maxFeePerGas = paymasterResult.maxFeePerGas ?? userOperation.maxFeePerGas;
			userOperation.maxPriorityFeePerGas = paymasterResult.maxPriorityFeePerGas ?? userOperation.maxPriorityFeePerGas;

			return userOperation;
		} else {
      console.log("Please add a gas policy to sponsor this user operation");
      return;
		}
	}

  /* 
    This method returns sponsorship eligibility and metadata of who is sponsoring this tx.
    We will skip metadata part, and just check if the tx is eligibile for sponsorship. 
  */
	private async checkSponsorshipEligibility(
		userOperation: UserOperation,
	): Promise<boolean> {
		const sponsorship = (await this.paymaster.checkSponsorshipEligibility(
			userOperation,
		)) as SponsorshipEligibility;
		return sponsorship.sponsored;
	}

	/*
    Your wallet design should show the user available erc-20 tokens 
    to pay for gas in case a sponsorship for their tx is not available.
    To simplify this example, we will skip this part and 
    only get the dummy paymasterAndData needed for our gas estimates
  */
	private async getDummyPaymasterAndData() {
		const supported = await this.paymaster.getSupportedERC20Tokens() as SupportedERC20Tokens;

    console.log(supported, "getSupportedERC20Tokens");
		return supported.paymasterMetadata.dummyPaymasterAndData;
	}

	async mintNFT(): Promise<{userOperationHash: string} | undefined> {
    // get sender (Account Address) and initCode (to deploy account if not deployed)
    const owners = await this.getOwners();
    const [sender, initCode] = this.smartAccount.createNewAccount([owners], "1", "9");

    // NFT mint callData
    const nftContractAddress = process.env.NEXT_PUBLIC_NFT_CONTRACT as string;
    const mintFunctionSelector = getFunctionSelector("mint(address)");
    const mintCallData = getCallData(
      mintFunctionSelector,
      ["address"],
      [sender],
    );
    const callData = this.smartAccount.createCallDataSingleTransaction({
      to: nftContractAddress,
      value: 0, // zero eth transfer
      data: mintCallData,
      operation: Operation.Call,
    });

    // To Do: check nonce and increment. For now, we just deploy an new account

    const dummyPaymasterAndData = await this.getDummyPaymasterAndData();

    // construct user opeation
    const userOperation: UserOperation = {
      ...UserOperationDummyValues,
      sender,
      nonce: "0x00",
      initCode,
      callData,
      paymasterAndData: dummyPaymasterAndData,
    };

    const userOperationAfterGasEstimation = await this.estimateUserOperationGas(userOperation);

    if (userOperationAfterGasEstimation) {
      // checkSponsorshipEligibility
      const sponsored = await this.checkSponsorshipEligibility(userOperationAfterGasEstimation);
      if (sponsored) {
        let userOperationSponsored = await this.sponsorUserOperationGas(
          userOperationAfterGasEstimation,
        );
        if (userOperationSponsored) {
          //sign the user operation hash
          const user_operation_hash = getUserOperationHash(
            userOperationSponsored,
            process.env.NEXT_PUBLIC_ENTRYPOINT_ADDRESS as string,
            process.env.NEXT_PUBLIC_CHAIN_ID as string,
          );
          const provider = new ethers.BrowserProvider(this.web3AuthSigner as any);
          // For ethers v5
          // const signer = provider.getSigner();
          const signer = await provider.getSigner();
          userOperationSponsored.signature = await signer.signMessage(
            getBytes(user_operation_hash),
          );

          const bundlerResponse = await this.bundler.sendUserOperation(
            userOperationSponsored,
          );

          if ("code" in bundlerResponse){
            console.log(bundlerResponse);
            return;
          }

          return bundlerResponse;
        }
      }
    }
	}

	async getAccountAddress(): Promise<string> {
		const owners = await this.getOwners();

		const [accountAddress] = this.smartAccount.createNewAccount([owners], "1", "8");
		return accountAddress;
	}
}
