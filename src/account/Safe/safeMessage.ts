import { hashMessage } from "ethers";

export const SAFE_MESSAGE_PRIMARY_TYPE = "SafeMessage";

export const SAFE_MESSAGE_MODULE_TYPE = {
    SafeMessage: [
      { type: "bytes", name: "message" },
    ],
};

export type SafeMessageTypedDataDomain = {
	chainId: number;
	verifyingContract: string;
}

export type SafeMessageTypedMessageValue = {
	message: string;
}

/**
 * create eip712 signing data for a safe message
 * @param useroperation - useroperation to hash
 * @param accountAddress - safe account address
 * @param chainId - target chain id
 * @param message - message to hash
 * @returns an object containing the typed data domain, type and typed data vales
 * object needed for hashing and signing a safe message
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
