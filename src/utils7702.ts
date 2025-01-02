//https://github.com/ethereum/EIPs/blob/master/EIPS/eip-7702.md
//rlp([chain_id, nonce, max_priority_fee_per_gas, max_fee_per_gas, gas_limit, destination, value, data, access_list, authorization_list, signature_y_parity, signature_r, signature_s])
//authorization_list = [[chain_id, address, nonce, y_parity, r, s], ...]
import {
    encodeRlp, Wallet, getBytes, toBeArray, keccak256,
} from "ethers";

const SET_CODE_TX_TYPE = "0x04";

export type Authorization7702 = {
    chain_id: bigint,
    address: string,
    nonce: bigint,
    signature_y_parity: 0 | 1,
    signature_r: bigint,
    signature_s: bigint
};

export function createAndSignLegacyRawTransaction(
    chain_id: bigint,
    nonce: bigint,
    gas_price: bigint,
    gas_limit: bigint,
    destination: string,
    value: bigint,
    data: string,
    eoaPrivateKey: string
): string {
    if (chain_id >= 2**64){
		throw RangeError("Invalide chain_id.");
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
        bigintToBytes(chain_id),
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
            BigInt(signature.yParity + (Number(chain_id) * 2) + 35)),
        getBytes(signature.r),
        getBytes(signature.s)
    ]
    const transactionPayload = encodeRlp(payload);
    return transactionPayload;
}

export function createAndSignEip7702DelegationAuthorization(
    chain_id: bigint,
    address: string,
    nonce: bigint,
    eoaPrivateKey: string
):Authorization7702 {
    const authHash = createEip7702DelegationAuthorizationHash(
        chain_id, address, nonce);
    const signature = signHash(authHash, eoaPrivateKey);
    return {
        chain_id,
        address,
        nonce,
        signature_y_parity:signature.signature_y_parity,
        signature_r: BigInt(signature.signature_r),
        signature_s: BigInt(signature.signature_s)
    };
}

export function createEip7702DelegationAuthorizationHash(
    chain_id: bigint,
    address: string,
    nonce: bigint
):string {
    const auth_arr = [
        bigintToBytes(chain_id),
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
): {signature_y_parity: 0 | 1, signature_r:bigint, signature_s: bigint}{
    const eoa = new Wallet(eoaPrivateKey);
    const signature = eoa.signingKey.sign(
        authHash,
    );
    return {
        signature_y_parity: signature.yParity,
        signature_r: BigInt(signature.r),
        signature_s: BigInt(signature.s)
    };
}

export function createAndSignEip7702RawTransaction(
    chain_id: bigint,
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
        chain_id,
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
        chain_id,
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
        bigintToBytes(BigInt(signature.signature_y_parity)),
        bigintToBytes(signature.signature_r),
        bigintToBytes(signature.signature_s)
    ]);
    const transactionPayload = encodeRlp(payload);

    return SET_CODE_TX_TYPE + transactionPayload.slice(2);
}


export function createEip7702TransactionHash(
    chain_id: bigint,
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
        chain_id,
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
    chain_id: bigint,
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
    if (chain_id >= 2**64){
		throw RangeError("Invalide chain_id.");
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
        bigintToBytes(chain_id),
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
            bigintToBytes(auth.chain_id),
            auth.address,
            bigintToBytes(auth.nonce),
            bigintToBytes(BigInt(auth.signature_y_parity)),
            bigintToBytes(auth.signature_r),
            bigintToBytes(auth.signature_s)
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
