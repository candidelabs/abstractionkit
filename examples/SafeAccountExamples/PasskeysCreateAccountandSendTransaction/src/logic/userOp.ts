import { ethers } from 'ethers'
import {
  SafeAccountV0_3_0 as SafeAccount,
  SignerSignaturePair,
  WebauthnSignatureData,
  SendUseroperationResponse,
  UserOperationV7,
} from 'abstractionkit'

import { 
  PasskeyLocalStorageFormat, 
  extractSignature, 
  extractClientDataFields 
} from './passkeys'
import { hexStringToUint8Array } from '../utils'

type Assertion = {
  response: AuthenticatorAssertionResponse
}

/**
 * Signs and sends a user operation to the specified entry point on the blockchain.
 * @param userOp The unsigned user operation to sign and send.
 * @param passkey The passkey used for signing the user operation.
 * @param chainId The chain ID of the blockchain. Defaults to APP_CHAIN_ID if not provided.
 * @returns User Operation hash promise.
 * @throws An error if signing the user operation fails.
 */
async function signAndSendUserOp(
  smartAccount: SafeAccount,
  userOp: UserOperationV7,
  passkey: PasskeyLocalStorageFormat,
  chainId: ethers.BigNumberish = import.meta.env.VITE_CHAIN_ID,
  bundlerUrl: string = import.meta.env.VITE_BUNDLER_URL,
): Promise<SendUseroperationResponse> {
  const safeInitOpHash = SafeAccount.getUserOperationEip712Hash(userOp, BigInt(chainId))

  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: ethers.getBytes(safeInitOpHash),
      allowCredentials: [{ type: 'public-key', id: hexStringToUint8Array(passkey.rawId)}],
    },
  })) as Assertion | null

  if (!assertion) {
    throw new Error('Failed to sign user operation')
  }

  const webauthnSignatureData: WebauthnSignatureData = {
    authenticatorData: assertion.response.authenticatorData,
    clientDataFields: extractClientDataFields(assertion.response),
    rs: extractSignature(assertion.response.signature),
  }

  const webauthSignature: string = SafeAccount.createWebAuthnSignature(webauthnSignatureData)

  const SignerSignaturePair: SignerSignaturePair = {
    signer: passkey.pubkeyCoordinates,
    signature: webauthSignature,
  }

  userOp.signature = SafeAccount.formatSignaturesToUseroperationSignature(
    [SignerSignaturePair],
    { isInit: userOp.nonce == 0n },
  );
  console.log(userOp, "userOp");
  return await smartAccount.sendUserOperation(userOp, bundlerUrl)
}

export { signAndSendUserOp }
