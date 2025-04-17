import { useMemo } from 'react'
import { SafeAccountV0_3_0 as SafeAccount } from 'abstractionkit'

import { PasskeyLocalStorageFormat } from '../logic/passkeys'
import { setItem } from '../logic/storage'

const chainName = import.meta.env.VITE_CHAIN_NAME as string;

function PasskeyCard({ passkey, handleCreatePasskeyClick }: { passkey?: PasskeyLocalStorageFormat; handleCreatePasskeyClick: () => void }) {
  const getAccountAddress = useMemo(() => {
    if (!passkey) return undefined

    const accountAddress = SafeAccount.createAccountAddress([passkey.pubkeyCoordinates]);
    setItem('accountAddress', accountAddress);

    return accountAddress;
  }, [passkey])

  return passkey ? (
	<div className="card">
		<p>Account Address: {" "}
      <a
        target="_blank"
        href={`https://${chainName}.blockscout.com/address/${getAccountAddress}`}
      >
        {getAccountAddress}
      </a>
    </p>
	</div>
) : (
    <div className="card">
      <p>First, you need to create a passkey which will be used to sign transactions</p>
      <button onClick={handleCreatePasskeyClick}>Create Account</button>
    </div>
  )
}

export { PasskeyCard }
