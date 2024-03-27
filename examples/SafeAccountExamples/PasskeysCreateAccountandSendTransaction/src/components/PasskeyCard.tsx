import { useMemo } from 'react'
import { SafeAccountWebAuth as SafeAccount, WebauthPublicKey } from 'abstractionkit'

import { PasskeyLocalStorageFormat } from '../logic/passkeys'
import { setItem } from '../logic/storage'

function PasskeyCard({ passkey, handleCreatePasskeyClick }: { passkey?: PasskeyLocalStorageFormat; handleCreatePasskeyClick: () => void }) {
  const getAccountAddress = useMemo(() => {
    if (!passkey) return undefined

    const webauthPublicKey: WebauthPublicKey = {
      x: BigInt(passkey.pubkeyCoordinates.x),
      y: BigInt(passkey.pubkeyCoordinates.y),
    }

    const smartAccount = SafeAccount.initializeNewAccount([webauthPublicKey])

    setItem('accountAddress', smartAccount.accountAddress)
    return smartAccount.accountAddress
  }, [passkey])

  return passkey ? (
    <div className="card">
      <p>Account Address: {getAccountAddress}</p>
    </div>
  ) : (
    <div className="card">
      <p>First, you need to create a passkey which will be used to sign transactions</p>
      <button onClick={handleCreatePasskeyClick}>Create Account</button>
    </div>
  )
}

export { PasskeyCard }
