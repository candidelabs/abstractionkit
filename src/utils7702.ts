//https://github.com/ethereum/EIPs/blob/master/EIPS/eip-7702.md
//rlp([chain_id, nonce, max_priority_fee_per_gas, max_fee_per_gas, gas_limit, destination, value, data, access_list, authorization_list, yParity, r, s])
//authorization_list = [[chain_id, address, nonce, yParity, r, s], ...]
import {
    encodeRlp, Wallet, getBytes, toBeArray, keccak256,
} from "ethers";

const SET_CODE_TX_TYPE = "0x04";

export type Authorization7702 = {
    chainId: bigint,
    address: string,
    nonce: bigint,
    yParity: 0 | 1,
    r: bigint,
    s: bigint
};

export type Authorization7702Hex = {
    chainId: string,
    address: string,
    nonce: string,
    yParity: string,
    r: string,
    s: string
};

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
		throw RangeError("Invalide chainId.");
    }

    if (nonce >= 2**64){
		throw RangeError("Invalide nonce.");
    }

    if (destination.length != 42){
		throw RangeError("Invalide destination.");
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

export function createAndSignEip7702DelegationAuthorization(
    chainId: bigint,
    address: string,
    nonce: bigint,
    eoaPrivateKey: string
):Authorization7702Hex {
    const authHash = createEip7702DelegationAuthorizationHash(
        chainId, address, nonce);
    const signature = signHash(authHash, eoaPrivateKey);
    return {
        chainId:bigintToHex(chainId),
        address,
        nonce:bigintToHex(nonce),
        yParity:bigintToHex(BigInt(signature.yParity)),
        r: bigintToHex(signature.r),
        s: bigintToHex(signature.s)
    };
}

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
		throw RangeError("Invalide chainId.");
    }

    if (nonce >= 2**64){
		throw RangeError("Invalide nonce.");
    }

    if (destination.length != 42){
		throw RangeError("Invalide destination.");
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

function encodeAuthList(authorization_list: Authorization7702[]){
    let encoded_auth_list = [];
    for (const auth of authorization_list){
        if (auth.address.length != 42){
			throw RangeError("Invalide authorization list address: " + auth);
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

function encodeAccessList(access_list: [string, string[]][]){
    let encoded_access_list = [];
    for (const [access_add, storage_arr] of access_list){
        if (access_add.length != 42){
			throw RangeError("Invalide access list address: " + access_add);
        }
        let encoded_storage_list = [];
        for (const storage of storage_arr){
            if (storage.length != 66){
			    throw RangeError("Invalide access list storage: " + storage);
            }
            encoded_storage_list.push(getBytes(storage));
        }
        encoded_access_list.push(
            [getBytes(access_add), encoded_storage_list]
        );
    }
    return encoded_access_list;
}

function bigintToBytes(bi: bigint){
    return getBytes(toBeArray(bi))
}


function bigintToHex(value: bigint): string {
    let hex = value.toString(16);
    return hex.length % 2 ? "0x0" + hex : "0x" + hex;
}
