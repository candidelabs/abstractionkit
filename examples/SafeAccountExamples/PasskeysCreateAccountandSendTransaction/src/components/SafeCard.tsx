import { useEffect, useState } from "react";
import {
	SafeAccountV0_3_0 as SafeAccount,
	getFunctionSelector,
	createCallData,
	MetaTransaction,
	CandidePaymaster,
} from "abstractionkit";

import { PasskeyLocalStorageFormat } from "../logic/passkeys";
import { signAndSendUserOp } from "../logic/userOp";
import { getItem } from "../logic/storage";
import { JsonRpcProvider } from "ethers";

const jsonRPCProvider = import.meta.env.VITE_JSON_RPC_PROVIDER;
const bundlerUrl = import.meta.env.VITE_BUNDLER_URL;
const paymasterUrl = import.meta.env.VITE_PAYMASTER_URL;
const chainId = import.meta.env.VITE_CHAIN_ID;
const chainName = import.meta.env.VITE_CHAIN_NAME as string;

function SafeCard({ passkey }: { passkey: PasskeyLocalStorageFormat }) {
	const [userOpHash, setUserOpHash] = useState<string>();
	const [deployed, setDeployed] = useState<boolean>(false);
	const [loadingTx, setLoadingTx] = useState<boolean>(false);
	const [error, setError] = useState<string>();
	const [txHash, setTxHash] = useState<string>();
	const [gasSponsor, setGasSponsor] = useState<
		| {
				name: string;
				description: string;
				url: string;
				icons: string[];
		  }
		| undefined
	>(undefined);

	const accountAddress = getItem("accountAddress") as string;
	const provider = new JsonRpcProvider(import.meta.env.VITE_JSON_RPC_PROVIDER);

	const isDeployed = async () => {
		const safeCode = await provider.getCode(accountAddress);
		setDeployed(safeCode !== "0x");
	};

	const handleMintNFT = async () => {
		setLoadingTx(true);
		setTxHash("");
		setError("");
		// mint an NFT
		const nftContractAddress = "0x9a7af758aE5d7B6aAE84fe4C5Ba67c041dFE5336";
		const mintFunctionSignature = "mint(address)";
		const mintFunctionSelector = getFunctionSelector(mintFunctionSignature);
		const mintTransactionCallData = createCallData(
			mintFunctionSelector,
			["address"],
			[accountAddress],
		);
		const mintTransaction: MetaTransaction = {
			to: nftContractAddress,
			value: 0n,
			data: mintTransactionCallData,
		};

		const safeAccount = SafeAccount.initializeNewAccount([
			passkey.pubkeyCoordinates,
		]);

		try {
			let userOperation = await safeAccount.createUserOperation(
				[mintTransaction],
				jsonRPCProvider,
				bundlerUrl,
				{
					expectedSigners: [passkey.pubkeyCoordinates],
					preVerificationGasPercentageMultiplier: 120,
					verificationGasLimitPercentageMultiplier: 120,
				},
			);

			let paymaster: CandidePaymaster = new CandidePaymaster(paymasterUrl);
			let [userOperationSponsored, sponsorMetadata] =
				await paymaster.createSponsorPaymasterUserOperation(
					userOperation,
					bundlerUrl,
				);
			setGasSponsor(sponsorMetadata);
			userOperation = userOperationSponsored;
			const bundlerResponse = await signAndSendUserOp(
				safeAccount,
				userOperation,
				passkey,
				chainId,
			);
			setUserOpHash(bundlerResponse.userOperationHash);
			let userOperationReceiptResult = await bundlerResponse.included();
			if (userOperationReceiptResult.success) {
				setTxHash(userOperationReceiptResult.receipt.transactionHash);
				console.log(
					"One NTF was minted. The transaction hash is : " +
						userOperationReceiptResult.receipt.transactionHash,
				);
				setUserOpHash("");
			} else {
				setError("Useroperation execution failed");
			}
		} catch (error) {
			if (error instanceof Error) {
				console.log(error);
				setError(error.message);
			} else {
				setError("Unknown error");
			}
		}
		setLoadingTx(false);
	};

	useEffect(() => {
		if (accountAddress) {
			async function isAccountDeployed() {
				await isDeployed();
			}
			isAccountDeployed();
		}
	}, [deployed, accountAddress]);

	return (
		<div className="card">
			{userOpHash && (
				<p>
					Your account setup is in progress. This operation gas is sponsored by{" "}
					{gasSponsor?.name}
					<a
						href={gasSponsor?.url}
						target="_blank"
						rel="noopener noreferrer"
						style={{ marginLeft: "5px" }}
					>
						<img
							src={gasSponsor?.icons[0]}
							alt="logo"
							style={{ width: "25px", height: "25px", verticalAlign: "middle" }}
						/>
					</a>
					<br />
					<br />
					Track your operation on{" "}
					<a
						target="_blank"
						href={`https://${chainName.toLowerCase()}.blockscout.com/op/${userOpHash}`}
					>
						the block explorer
					</a>
				</p>
			)}
			{txHash && (
				<>
					You collected an NFT, secured with your Safe Account & authenticated
					by your Device Passkeys.
					<br />
					<br />
					View more on{" "}
					<a
						target="_blank"
						href={`https://${chainName}.blockscout.com/tx/${txHash}`}
					>
						the block explorer
					</a>
					<br />
				</>
			)}
			{loadingTx && !userOpHash ? (
				<p>"Preparing transaction.."</p>
			) : (
				accountAddress && (
					<div className="card">
						<br />
						<button onClick={handleMintNFT} disabled={!!userOpHash}>
							Mint NFT
						</button>
					</div>
				)
			)}{" "}
			{error && (
				<div className="card">
					<p>Error: {error}</p>
				</div>
			)}
		</div>
	);
}

export { SafeCard };
