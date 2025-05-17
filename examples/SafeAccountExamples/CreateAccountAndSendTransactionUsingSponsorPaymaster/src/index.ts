import * as dotenv from 'dotenv'
import {
    SafeAccountV0_3_0 as SafeAccount,
    MetaTransaction,
    CandidePaymaster,
    createCallData,
} from "abstractionkit";
import { parseSignature, toFunctionSelector } from "viem";
import BigNumber from "bignumber.js";

async function main(): Promise<void> {
    // Load environment variables
    dotenv.config()
    
    // Configuration - Replace these values with your own
    const chainId = BigInt(8453) // Base network
    const bundlerUrl = process.env.BUNDLER_URL as string 
    const jsonRpcNodeProvider = process.env.JSON_RPC_NODE_PROVIDER as string
    const paymasterRPC = process.env.PAYMASTER_RPC as string
    const ownerPublicAddress = process.env.PUBLIC_ADDRESS as string
    const ownerPrivateKey = process.env.PRIVATE_KEY as string
    const sponsorshipPolicyId = process.env.SPONSORSHIP_POLICY_ID as string

    // Hardcoded addresses for example
    const usdcTokenAddress = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" // USDC on Base
    const merchantAddress = "0xYourMerchantAddress" // Replace with actual merchant address
    const spcFeeAddress = "0xAf1DD0F5dBebEc8c9c1c2a48aa79fB1D8E2DdA32" // Fee collector address

    // Initialize smart account
    let smartAccount = SafeAccount.initializeNewAccount([ownerPublicAddress])
    console.log("Smart Account address: " + smartAccount.accountAddress)

    // Set up permit parameters
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600) // 1 hour from now
    const amount = BigInt(1000000) // 1 USDC (6 decimals)
    const nonce = BigInt(0) // Should be fetched from the token contract

    // TODO: This value should be calculated using fetchGasPrice function and proper conversions
    // For now using a hardcoded value that represents typical gas cost in USDC
    const gasCostInSelectedToken = new BigNumber('15000') // 0.015 USDC in base units (6 decimals)

    // Calculate amounts with BigNumber for precise arithmetic
    const orderAmount = new BigNumber('1000000') // 1 USDC in base units (6 decimals)
    const percentage = new BigNumber('50') // 0.5% fee
    const spcFee = orderAmount.multipliedBy(percentage).dividedBy(10000) // Calculate 0.5% fee
    const merchantAmount = orderAmount.minus(spcFee) // Amount minus fee

    // Create permit metatransaction
    const permitMetaTx: MetaTransaction = {
        to: usdcTokenAddress,
        value: BigInt(0),
        data: createCallData(
            toFunctionSelector("permit(address,address,uint256,uint256,uint8,bytes32,bytes32)"),
            [
                "address",
                "address",
                "uint256",
                "uint256",
                "uint8",
                "bytes32",
                "bytes32",
            ],
            [
                ownerPublicAddress,
                smartAccount.accountAddress,
                amount,
                deadline,
                0, // v
                "0x0000000000000000000000000000000000000000000000000000000000000000", // r
                "0x0000000000000000000000000000000000000000000000000000000000000000"  // s
            ]
        ),
    }

    // Create transfer to merchant metatransaction (amount minus fee minus gas cost)
    const transferToMerchantMetaTx: MetaTransaction = {
        to: usdcTokenAddress,
        value: BigInt(0),
        data: createCallData(
            toFunctionSelector("transferFrom(address,address,uint256)"),
            ["address", "address", "uint256"],
            [ownerPublicAddress, merchantAddress, merchantAmount.minus(gasCostInSelectedToken).toNumber()]
        ),
    }

    // Create transfer fee metatransaction (fee plus gas cost)
    const transferToSpcFeeMetaTx: MetaTransaction = {
        to: usdcTokenAddress,
        value: BigInt(0),
        data: createCallData(
            toFunctionSelector("transferFrom(address,address,uint256)"),
            ["address", "address", "uint256"],
            [ownerPublicAddress, spcFeeAddress, spcFee.plus(gasCostInSelectedToken).toNumber()]
        ),
    }

    // Create user operation with all metatransactions
    let userOperation = await smartAccount.createUserOperation(
        [
            permitMetaTx,
            transferToMerchantMetaTx,
            transferToSpcFeeMetaTx
        ],
        jsonRpcNodeProvider,
        bundlerUrl
    )

    // Set up paymaster
    let paymaster = new CandidePaymaster(paymasterRPC)

    // Get sponsored user operation
    let [paymasterUserOperation, _sponsorMetadata] = await paymaster.createSponsorPaymasterUserOperation(
        userOperation,
        bundlerUrl,
        sponsorshipPolicyId
    )
    userOperation = paymasterUserOperation

    // Sign the user operation
    userOperation.signature = smartAccount.signUserOperation(
        userOperation,
        [ownerPrivateKey],
        chainId
    )

    // Send the user operation
    console.log("Sending user operation...")
    const sendUserOperationResponse = await smartAccount.sendUserOperation(
        userOperation,
        bundlerUrl
    )

    console.log("Waiting for user operation to be included...")
    const userOperationReceiptResult = await sendUserOperationResponse.included()

    if (userOperationReceiptResult.success) {
        console.log("Success! Transaction hash: " + userOperationReceiptResult.receipt.transactionHash)
    } else {
        console.log("User operation execution failed")
    }
}

main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})
