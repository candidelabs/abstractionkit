import safeLogo from "/safe-logo-white.svg";
import candideLogo from "/candide-atelier-logo.svg";
import {
	PasskeyLocalStorageFormat,
	createPasskey,
	toLocalStorageFormat,
} from "./logic/passkeys.ts";
import "./App.css";
import { useLocalStorageState } from "./hooks/useLocalStorageState.ts";
import { useState } from "react";
import { PasskeyCard } from "./components/PasskeyCard.tsx";
import { SafeCard } from "./components/SafeCard.tsx";
import { FaqCard } from "./components/FaqCard.tsx";

const PASSKEY_LOCALSTORAGE_KEY = "passkeyId";

function App() {
	const [passkey, setPasskey] = useLocalStorageState<
		PasskeyLocalStorageFormat | undefined
	>(PASSKEY_LOCALSTORAGE_KEY, undefined);
	const [error, setError] = useState<string>();

	const handleCreatePasskeyClick = async () => {
		setError(undefined);
		try {
			const passkey = await createPasskey();

			setPasskey(toLocalStorageFormat(passkey));
		} catch (error) {
			if (error instanceof Error) {
				setError(error.message);
			} else {
				setError("Unknown error");
			}
		}
	};

	let content = (
		<>
			<PasskeyCard
				passkey={passkey}
				handleCreatePasskeyClick={handleCreatePasskeyClick}
			/>

			{passkey && <SafeCard passkey={passkey} />}

			{error && (
				<div className="card">
					<p>Error: {error}</p>
				</div>
			)}
			<FaqCard />
		</>
	);

	return (
		<>
			<header className="header">
				<a href="https://candide.dev" target="_blank">
					<img src={candideLogo} className="logo" alt="Safe logo" />
				</a>
				<a href="https://safe.global" target="_blank">
					<img src={safeLogo} className="logo" alt="Safe logo" />
				</a>
			</header>
			<h1>Safe Passkeys Demo</h1>
			{content}
			<br/>
			<br/>
		</>
	);
}

export default App;
