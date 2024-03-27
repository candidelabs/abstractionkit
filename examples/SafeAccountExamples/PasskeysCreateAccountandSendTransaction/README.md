# Passkeys Safe Owner

This minimalistic example application demonstrates a Safe Account deployment leveraging 4337 and Passkeys. It uses "WebAuthnSigner" as owners to validate webauth transactions. During account initialization, it uses the singleton contract that stores the signer publickey to the account storage directly to avoid 4337 storage restrictions, then it replaces it with a "WebAuthnSigner".

"WebAuthnSigner" addresses are deterministic, we created a proxy and a proxy factory for this purpose (Almost the same proxy and factory as Safe's ).

## Install dependencies

**Change Directory**: Go to path containing the main abstractionkit library in the webauthn branch.
Install, build, and establish a symbolic link for the for the package.

```bash
npm install 
npm run build
npm link
```

Now that the library is linked, you can return to the main example path here and connect locally installed abstractionkit. The command below will install the rest of the dependencies as well

```bash
npm link abstractionkit
```

## Fill in the environment variables

```bash
cp .env.example .env
```

and fill in the variables in `.env` file.

### Run the app in development mode

```bash
npm run dev
```