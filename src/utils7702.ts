//https://github.com/ethereum/EIPs/blob/master/EIPS/eip-7702.md
//rlp([chain_id, nonce, max_priority_fee_per_gas, max_fee_per_gas, gas_limit, destination, value, data, access_list, authorization_list, yParity, r, s])
//authorization_list = [[chain_id, address, nonce, yParity, r, s], ...]
import {
    encodeRlp, Wallet, getBytes, toBeArray, keccak256,
} from "ethers";

const SET_CODE_TX_TYPE = "0x04";

/**
 * An EIP-7702 delegation authorization with bigint values.
 * Represents a signed authorization that delegates an EOA's code to a contract.
 */
export type Authorization7702 = {
    /** The chain ID the authorization is valid for. */
    chainId: bigint,
    /** The contract address to delegate code from. */
    address: string,
    /** The EOA's nonce at the time of signing. */
    nonce: bigint,
    /** The parity of the signature's y-coordinate (0 or 1). */
    yParity: 0 | 1,
    /** The r component of the ECDSA signature. */
    r: bigint,
    /** The s component of the ECDSA signature. */
    s: bigint
};

/**
 * An EIP-7702 delegation authorization with hex-encoded string values.
 * Same as {@link Authorization7702} but with all numeric fields as hex strings.
 */
export type Authorization7702Hex = {
    /** The chain ID as a hex string. */
    chainId: string,
    /** The contract address to delegate code from. */
    address: string,
    /** The EOA's nonce as a hex string. */
    nonce: string,
    /** The parity of the signature's y-coordinate as a hex string. */
    yParity: string,
    /** The r component of the ECDSA signature as a hex string. */
    r: string,
    /** The s component of the ECDSA signature as a hex string. */
    s: string
};

/**
 * Creates and signs a legacy (pre-EIP-1559) raw transaction using RLP encoding.
 * @param chainId - The chain ID for replay protection.
 * @param nonce - The sender's transaction nonce.
 * @param gas_price - The gas price in wei.
 * @param gas_limit - The maximum gas units for the transaction.
 * @param destination - The recipient address (42-character hex string).
 * @param value - The amount of ETH to send in wei.
 * @param data - The transaction input data.
 * @param eoaPrivateKey - The sender's private key for signing.
 * @returns The RLP-encoded signed transaction as a hex string.
 */
export function createAndSignLegacyRawTransaction(
    chainId: bigint,
    nonce: bigint,
    gas_price: bigint,
    gas_limit: bigint,
    destination: string,
    value: bigint,
    data: string,
    eoaPrivateKey: string
): string {
    if (chainId >= 2**64){
		throw new RangeError("Invalid chainId.");
    }

    if (nonce >= 2**64){
		throw new RangeError("Invalid nonce.");
    }

    if (destination.length != 42){
		throw new RangeError("Invalid destination.");
    }

    let payload = [
        bigintToBytes(nonce),
        bigintToBytes(gas_price),
        bigintToBytes(gas_limit),
        destination,
        bigintToBytes(value),
        data,
        bigintToBytes(chainId),
        bigintToBytes(0n),
        bigintToBytes(0n)
    ]
    
    const txHash = keccak256(encodeRlp(payload));
    
    const eoa = new Wallet(eoaPrivateKey);
    const signature = eoa.signingKey.sign(
        txHash,
    );

    payload = [
        bigintToBytes(nonce),
        bigintToBytes(gas_price),
        bigintToBytes(gas_limit),
        destination,
        bigintToBytes(value),
        data,
        bigintToBytes(
            BigInt(signature.yParity + (Number(chainId) * 2) + 35)),
        getBytes(signature.r),
        getBytes(signature.s)
    ]
    const transactionPayload = encodeRlp(payload);
    return transactionPayload;
}

/**
 * Creates and signs an EIP-7702 delegation authorization.
 * The authorization allows an EOA to delegate its code to a specified contract address.
 *
 * Accepts either a hex-encoded private key string or a signer callback
 * `(hash: string) => Promise<string>` for use with viem, ethers Signers,
 * hardware wallets, or MPC signers.
 *
 * @param chainId - The chain ID the authorization is valid for.
 * @param address - The contract address to delegate code from.
 * @param nonce - The EOA's nonce at the time of signing.
 * @param signer - The EOA's private key or a signing function that returns a 65-byte signature.
 * @returns The signed authorization with all numeric values as hex strings.
 */
export function createAndSignEip7702DelegationAuthorization(
    chainId: bigint,
    address: string,
    nonce: bigint,
    signer: string,
): Authorization7702Hex;
export function createAndSignEip7702DelegationAuthorization(
    chainId: bigint,
    address: string,
    nonce: bigint,
    signer: (hash: string) => Promise<string>,
): Promise<Authorization7702Hex>;
export function createAndSignEip7702DelegationAuthorization(
    chainId: bigint,
    address: string,
    nonce: bigint,
    signer: string | ((hash: string) => Promise<string>),
): Authorization7702Hex | Promise<Authorization7702Hex> {
    const authHash = createEip7702DelegationAuthorizationHash(
        chainId, address, nonce);

    if (typeof signer === "string") {
        const signature = signHash(authHash, signer);
        return {
            chainId: bigintToHex(chainId),
            address,
            nonce: bigintToHex(nonce),
            yParity: bigintToHex(BigInt(signature.yParity)),
            r: bigintToHex(signature.r),
            s: bigintToHex(signature.s),
        };
    }

    return signer(authHash).then((rawSig) => {
        const sig = parseRawSignature(rawSig);
        return {
            chainId: bigintToHex(chainId),
            address,
            nonce: bigintToHex(nonce),
            yParity: bigintToHex(BigInt(sig.yParity)),
            r: bigintToHex(sig.r),
            s: bigintToHex(sig.s),
        };
    });
}

/**
 * Creates and signs an EIP-7702 delegation revocation authorization.
 * Sets the delegatee address to the zero address, which revokes the delegation
 * and restores the EOA to a normal account.
 *
 * @param chainId - The chain ID the authorization is valid for.
 * @param nonce - The EOA's authorization nonce at the time of signing.
 * @param eoaPrivateKey - The EOA's private key for signing.
 * @returns The signed delegation revocation authorization with hex-encoded values.
 */
export function createRevokeDelegationAuthorization(
    chainId: bigint,
    nonce: bigint,
    eoaPrivateKey: string,
): Authorization7702Hex {
    const ZeroAddress = "0x0000000000000000000000000000000000000000";
    return createAndSignEip7702DelegationAuthorization(
        chainId, ZeroAddress, nonce, eoaPrivateKey
    );
}

/**
 * Computes the keccak256 hash of an EIP-7702 delegation authorization.
 * Uses the MAGIC prefix (0x05) as defined in the EIP-7702 spec.
 * @param chainId - The chain ID the authorization is valid for.
 * @param address - The contract address to delegate code from.
 * @param nonce - The EOA's nonce at the time of signing.
 * @returns The authorization hash as a hex string.
 */
export function createEip7702DelegationAuthorizationHash(
    chainId: bigint,
    address: string,
    nonce: bigint
):string {
    const auth_arr = [
        bigintToBytes(chainId),
        address,
        bigintToBytes(nonce),
    ]
    const encoded_auth = encodeRlp(auth_arr);
    const MAGIC = "0x05";
    return keccak256(MAGIC + encoded_auth.slice(2));
}

/**
 * Signs a hash using an EOA's private key.
 * @param authHash - The hash to sign.
 * @param eoaPrivateKey - The EOA's private key for signing.
 * @returns An object containing the signature components: yParity, r, and s.
 */
export function signHash(
    authHash: string,
    eoaPrivateKey: string
): {yParity: 0 | 1, r:bigint, s: bigint}{
    const eoa = new Wallet(eoaPrivateKey);
    const signature = eoa.signingKey.sign(
        authHash,
    );
    return {
        yParity: signature.yParity,
        r: BigInt(signature.r),
        s: BigInt(signature.s)
    };
}

/**
 * Creates and signs an EIP-7702 (set-code) raw transaction.
 * Encodes the transaction with a type 0x04 prefix and includes the authorization list.
 * @param chainId - The chain ID for replay protection.
 * @param nonce - The sender's transaction nonce.
 * @param max_priority_fee_per_gas - The maximum priority fee per gas (tip) in wei.
 * @param max_fee_per_gas - The maximum total fee per gas in wei.
 * @param gas_limit - The maximum gas units for the transaction.
 * @param destination - The recipient address (42-character hex string).
 * @param value - The amount of ETH to send in wei.
 * @param data - The transaction input data.
 * @param access_list - The EIP-2930 access list as [address, storageKeys] tuples.
 * @param authorization_list - The list of signed EIP-7702 delegation authorizations.
 * @param eoaPrivateKey - The sender's private key for signing.
 * @returns The signed, RLP-encoded transaction with 0x04 type prefix.
 */
export function createAndSignEip7702RawTransaction(
    chainId: bigint,
    nonce: bigint,
    max_priority_fee_per_gas: bigint,
    max_fee_per_gas: bigint,
    gas_limit: bigint,
    destination: string,
    value: bigint,
    data: string,
    access_list: [string, string[]][],
    authorization_list: Authorization7702[],
    eoaPrivateKey: string
): string {
    const txHash = createEip7702TransactionHash(
        chainId,
        nonce,
        max_priority_fee_per_gas,
        max_fee_per_gas,
        gas_limit,
        destination,
        value,
        data,
        access_list,
        authorization_list,
    )

    const basePayload = encodeEip7702TransactionBaseList(
        chainId,
        nonce,
        max_priority_fee_per_gas,
        max_fee_per_gas,
        gas_limit,
        destination,
        value,
        data,
        access_list,
        authorization_list,
    );

    const signature = signHash(txHash, eoaPrivateKey);
    const payload = basePayload.concat([
        bigintToBytes(BigInt(signature.yParity)),
        bigintToBytes(signature.r),
        bigintToBytes(signature.s)
    ]);
    const transactionPayload = encodeRlp(payload);

    return SET_CODE_TX_TYPE + transactionPayload.slice(2);
}


/**
 * Computes the keccak256 hash of an EIP-7702 transaction for signing.
 * @param chainId - The chain ID for replay protection.
 * @param nonce - The sender's transaction nonce.
 * @param max_priority_fee_per_gas - The maximum priority fee per gas (tip) in wei.
 * @param max_fee_per_gas - The maximum total fee per gas in wei.
 * @param gas_limit - The maximum gas units for the transaction.
 * @param destination - The recipient address (42-character hex string).
 * @param value - The amount of ETH to send in wei.
 * @param data - The transaction input data.
 * @param access_list - The EIP-2930 access list as [address, storageKeys] tuples.
 * @param authorization_list - The list of signed EIP-7702 delegation authorizations.
 * @returns The transaction hash as a hex string.
 */
export function createEip7702TransactionHash(
    chainId: bigint,
    nonce: bigint,
    max_priority_fee_per_gas: bigint,
    max_fee_per_gas: bigint,
    gas_limit: bigint,
    destination: string,
    value: bigint,
    data: string,
    access_list: [string, string[]][],
    authorization_list: Authorization7702[],
):string {
    const payload = encodeEip7702TransactionBaseList(
        chainId,
        nonce,
        max_priority_fee_per_gas,
        max_fee_per_gas,
        gas_limit,
        destination,
        value,
        data,
        access_list,
        authorization_list,
    );

    return keccak256(SET_CODE_TX_TYPE + encodeRlp(payload).slice(2));
}

/**
 * Encodes the base RLP list for an EIP-7702 transaction (without signature fields).
 * Used internally to build the payload that gets hashed and signed.
 */
function encodeEip7702TransactionBaseList(
    chainId: bigint,
    nonce: bigint,
    max_priority_fee_per_gas: bigint,
    max_fee_per_gas: bigint,
    gas_limit: bigint,
    destination: string,
    value: bigint,
    data: string,
    access_list: [string, string[]][],
    authorization_list: Authorization7702[],
){
    if (chainId >= 2**64){
		throw new RangeError("Invalid chainId.");
    }

    if (nonce >= 2**64){
		throw new RangeError("Invalid nonce.");
    }

    if (destination.length != 42){
		throw new RangeError("Invalid destination.");
    }

    const encoded_auth_list = encodeAuthList(authorization_list); 
    const encoded_access_list = encodeAccessList(access_list);

    const payload = [
        bigintToBytes(chainId),
        bigintToBytes(nonce),
        bigintToBytes(max_priority_fee_per_gas),
        bigintToBytes(max_fee_per_gas),
        bigintToBytes(gas_limit),
        destination,
        bigintToBytes(value),
        data,
        encoded_access_list,
        encoded_auth_list,
    ]
    return payload;
}

/** Encodes an array of EIP-7702 authorizations into RLP-compatible nested arrays. */
function encodeAuthList(authorization_list: Authorization7702[]){
    let encoded_auth_list = [];
    for (const auth of authorization_list){
        if (auth.address.length != 42){
			throw new RangeError("Invalid authorization list address: " + auth);
        }
        const encoded_auth = [
            bigintToBytes(auth.chainId),
            auth.address,
            bigintToBytes(auth.nonce),
            bigintToBytes(BigInt(auth.yParity)),
            bigintToBytes(auth.r),
            bigintToBytes(auth.s)
        ]
        encoded_auth_list.push(encoded_auth);
    }
    return encoded_auth_list;
}

/** Encodes an EIP-2930 access list into RLP-compatible nested arrays. */
function encodeAccessList(access_list: [string, string[]][]){
    let encoded_access_list = [];
    for (const [access_add, storage_arr] of access_list){
        if (access_add.length != 42){
			throw new RangeError("Invalid access list address: " + access_add);
        }
        let encoded_storage_list = [];
        for (const storage of storage_arr){
            if (storage.length != 66){
			    throw new RangeError("Invalid access list storage: " + storage);
            }
            encoded_storage_list.push(getBytes(storage));
        }
        encoded_access_list.push(
            [getBytes(access_add), encoded_storage_list]
        );
    }
    return encoded_access_list;
}

/** Converts a bigint to a Uint8Array of its big-endian byte representation. */
function bigintToBytes(bi: bigint){
    return getBytes(toBeArray(bi))
}


/**
 * Parse a raw ECDSA signature into its components.
 * Supports standard 65-byte (r + s + v) and EIP-2098 64-byte compact formats.
 * @param rawSig - Hex string: 128 chars (EIP-2098 compact), or 130/132 chars (standard with 0x prefix)
 * @returns An object with yParity (0 or 1), r, and s components
 */
function parseRawSignature(rawSig: string): { yParity: 0 | 1; r: bigint; s: bigint } {
    const sig = rawSig.startsWith("0x") ? rawSig.slice(2) : rawSig;
    if (sig.length !== 128 && sig.length !== 130) {
        throw new RangeError(
            `invalid signature length: expected 128 (EIP-2098 compact) or 130 (standard) hex chars, got ${sig.length}`
        );
    }
    const r = BigInt("0x" + sig.slice(0, 64));

    if (sig.length === 128) {
        // EIP-2098 compact signature (64 bytes): r (32) + yParity||s (32)
        const yParityAndS = BigInt("0x" + sig.slice(64, 128));
        const yParity = Number((yParityAndS >> 255n) & 1n) as 0 | 1;
        const s = yParityAndS & ((1n << 255n) - 1n);
        return { yParity, r, s };
    }

    // Standard 65-byte signature: r (32) + s (32) + v (1)
    const s = BigInt("0x" + sig.slice(64, 128));
    const v = parseInt(sig.slice(128, 130), 16);
    if (v !== 0 && v !== 1 && v !== 27 && v !== 28) {
        throw new RangeError(`invalid signature v value: ${v}`);
    }
    const yParity = (v >= 27 ? v - 27 : v) as 0 | 1;
    return { yParity, r, s };
}

/**
 * Converts a bigint to a 0x-prefixed hex string with even-length padding.
 * @param value - The bigint value to convert.
 * @returns The hex string representation (e.g., "0x01", "0xff").
 */
export function bigintToHex(value: bigint): string {
    let hex = value.toString(16);
    return hex.length % 2 ? "0x0" + hex : "0x" + hex;
}
