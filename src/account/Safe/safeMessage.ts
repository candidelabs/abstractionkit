import { hashMessage } from "ethers";

/** The primary EIP-712 type name used for Safe message signing. */
export const SAFE_MESSAGE_PRIMARY_TYPE = "SafeMessage";

/** EIP-712 type definition for SafeMessage, containing a single bytes field. */
export const SAFE_MESSAGE_MODULE_TYPE = {
    SafeMessage: [
      { type: "bytes", name: "message" },
    ],
};

/** EIP-712 domain for Safe message signing, scoped to a chain and account. */
export type SafeMessageTypedDataDomain = {
	/** Target chain ID to prevent cross-chain replay */
	chainId: number;
	/** The Safe account address that will verify the signature */
	verifyingContract: string;
}

/** EIP-712 typed message value containing the hashed message bytes. */
export type SafeMessageTypedMessageValue = {
	/** The EIP-191 hash of the original message */
	message: string;
}

/**
 * Create EIP-712 signing data for a Safe message.
 * @param accountAddress - the Safe account address
 * @param chainId - target chain id
 * @param message - the message string to sign
 * @returns an object with domain, types, and messageValue for EIP-712 signing
 */
export function getSafeMessageEip712Data(
    accountAddress: string,
    chainId: bigint,
    message: string
): {
    domain: SafeMessageTypedDataDomain,
    types:Record<string, {name: string;type: string;}[]>,
    messageValue: SafeMessageTypedMessageValue
} {
    const messageValue: SafeMessageTypedMessageValue = {
        message: hashMessage(message)
    };
    const domain: SafeMessageTypedDataDomain = {
        chainId: Number(chainId),
        verifyingContract: accountAddress
    };

    return {
        domain,
        types: SAFE_MESSAGE_MODULE_TYPE,
        messageValue,
    };
}
