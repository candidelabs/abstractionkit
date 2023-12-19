/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable no-console */
import "react-toastify/dist/ReactToastify.css";

import { getPublicCompressed } from "@toruslabs/eccrypto";
import { CHAIN_NAMESPACES, IProvider, WALLET_ADAPTERS } from "@web3auth/base";
import { EthereumPrivateKeyProvider } from "@web3auth/ethereum-provider";
import { Web3AuthNoModal } from "@web3auth/no-modal";
import { OpenloginAdapter } from "@web3auth/openlogin-adapter";
import { useEffect, useState } from "react";
import { toast } from "react-toastify";

import AA from "../components/aa";
const clientId =
	"BEglQSgt4cUWcj6SKRdu5QkOXTsePmMcusG5EAoyjyOYKlVRjIF1iCNnMOTfpzCiunHRrMui8TIwQPXdkQ8Yxuk"; // get from https://dashboard.web3auth.io

function App() {
	const [web3auth, setWeb3auth] = useState<Web3AuthNoModal | null>(null);
	const [provider, setProvider] = useState<IProvider | null>(null);
	const [loggedIn, setLoggedIn] = useState<boolean | null>(false);

	useEffect(() => {
		const chainId = "0x"+ Number(process.env.NEXT_PUBLIC_CHAIN_ID).toString(16);

		const init = async () => {
			try {
				const chainConfig = {
					chainNamespace: CHAIN_NAMESPACES.EIP155,
					chainId,
					rpcTarget: process.env.NEXT_PUBLIC_JSON_RPC_NODE_PROVIDER as string,
					displayName: process.env.NEXT_PUBLIC_NETWORK as string,
					blockExplorer: "https://jiffyscan.xyz/",
					ticker: "MATIC",
					tickerName: "Mumbai",
				};
				const web3authInstance = new Web3AuthNoModal({
					clientId,
					chainConfig,
					web3AuthNetwork: "cyan",
				});

				const privateKeyProvider = new EthereumPrivateKeyProvider({
					config: { chainConfig },
				});

				const openloginAdapter = new OpenloginAdapter({
					loginSettings: {
						mfaLevel: "mandatory",
						dappShare: "true",
					},
					adapterSettings: {
						loginConfig: {
							google: {
								verifier: "web3auth-google-example",
								typeOfLogin: "google",
								clientId:
									"774338308167-q463s7kpvja16l4l0kko3nb925ikds2p.apps.googleusercontent.com", // use your app client id you got from google
							},
						},
					},
					privateKeyProvider,
				});
				web3authInstance.configureAdapter(openloginAdapter);
				setWeb3auth(web3authInstance);
				await web3authInstance.init();
				setProvider(web3authInstance.provider);
				if (web3authInstance.connectedAdapterName) {
					setLoggedIn(true);
				}
			} catch (error) {
				console.error(error);
			}
		};

		init();
	}, []);

	function uiConsole(...args: any[]): void {
		const el = document.querySelector("#console>p");
		if (el) {
			el.innerHTML = JSON.stringify(args || {}, null, 2);
		}
	}

	const logout = async () => {
		if (!web3auth) {
			uiConsole("web3auth not initialized yet");
			return;
		}
		await web3auth.logout();
		setProvider(null);
		setLoggedIn(false);
	};

	const getUserInfo = async () => {
		if (!web3auth) {
			uiConsole("web3auth not initialized yet");
			return;
		}
		const user = await web3auth.getUserInfo();
		uiConsole(user);
	};

	const validateIdToken = async () => {
		if (!web3auth) {
			uiConsole("web3auth not initialized yet");
			return;
		}
		const { idToken } = await web3auth.authenticateUser();
		console.log(idToken);

		const privKey: any = await web3auth.provider?.request({
			method: "eth_private_key",
		});
		console.log(privKey);
		const pubkey = getPublicCompressed(Buffer.from(privKey, "hex")).toString(
			"hex",
		);

		// Validate idToken with server
		const res = await fetch("/api/login", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${idToken}`,
			},
			body: JSON.stringify({ appPubKey: pubkey }),
		});
		if (res.status === 200) {
			toast.success("JWT Verification Successful");
			await getUserInfo();
		} else {
			toast.error("JWT Verification Failed");
			console.log("JWT Verification Failed");
			await logout();
		}
		return res.status;
	};

	const login = async () => {
		if (!web3auth) {
			uiConsole("web3auth not initialized yet");
			return;
		}
		const web3authProvider = await web3auth.connectTo(
			WALLET_ADAPTERS.OPENLOGIN,
			{
				mfaLevel: "default",
				loginProvider: "google",
			},
		);
		setProvider(web3authProvider);
		await validateIdToken();
		setLoggedIn(true);
	};

	const getOwners = async () => {
		if (!provider) {
			uiConsole("provider not initialized yet");
			return;
		}
		const rpc = new AA(provider);
		const userAccount = await rpc.getOwners();
		uiConsole(userAccount);
	};

	const getAccountAddress = async () => {
		if (!provider) {
			uiConsole("provider not initialized yet");
			return;
		}
		const aa = new AA(provider);
		const userAccount = await aa.getAccountAddress();
		uiConsole(userAccount);
	};

	const mintNFT = async () => {
		if (!provider) {
			uiConsole("provider not initialized yet");
			return;
		}
		const aa = new AA(provider);
		const userOperation = await aa.mintNFT();
		uiConsole(
			!userOperation ? (
				"See console for error"
			) : `https://jiffyscan.xyz/userOpHash/${userOperation.userOperationHash}`,
		);
	};

	const loginView = (
		<>
			<div className="flex-container">
				<div>
					<button onClick={getUserInfo} className="card">
						Get User Info
					</button>
				</div>
				<div>
					<button onClick={getAccountAddress} className="card">
						Get Smart Account Address
					</button>
				</div>
				<div>
					<button onClick={getOwners} className="card">
						Get Web3auth Owner
					</button>
				</div>
				<div>
					<button onClick={mintNFT} className="card">
						Mint NFT
					</button>
				</div>
				<div>
					<button onClick={logout} className="card">
						Log Out
					</button>
				</div>
			</div>

			<div id="console" style={{ whiteSpace: "pre-line" }}>
				<p style={{ whiteSpace: "pre-line" }}>Logged in Successfully!</p>
			</div>
		</>
	);

	const logoutView = (
		<button onClick={login} className="card">
			Login
		</button>
	);

	return (
		<div className="container">
			<h1 className="title">
				<a target="_blank" href="https://docs.candide.dev" rel="noreferrer">
					Candide Atelier
				</a>{" "}
				&{" "}
				<a
					target="_blank"
					href="https://web3auth.io/docs/sdk/pnp/web/no-modal"
					rel="noreferrer"
				>
					Web3Auth
				</a>
			</h1>
			<h3 className="center">Chain ID: {process.env.NEXT_PUBLIC_CHAIN_ID}</h3>
			<div className="grid">{loggedIn ? loginView : logoutView}</div>

			<footer className="footer">
				<a
					href="https://github.com/candidelabs/abstractionkit/tree/main/examples"
					target="_blank"
					rel="noopener noreferrer"
				>
					Source code
				</a>
			</footer>
		</div>
	);
}

export default App;
