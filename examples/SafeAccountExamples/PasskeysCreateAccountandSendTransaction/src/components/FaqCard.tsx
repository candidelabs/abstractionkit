import Faq from "react-faq-component";

const data = {
	title: "Frequently Asked Questions",
	rows: [
		{
			title: "What is a Passkey?",
			content: (
				<p>
					A Passkey is an authentication method that eliminates the need for
					passwords entirely. Leveraging the security of your devices such as
					Touch ID and Face ID, Passkeys provide a more secure and convenient
					alternative to traditional passwords. Developed collaboratively by an
					alliance of tech companies, Passkeys adhere to the security standards
					of FIDO and WebAuthn, making them a robust authentication solution for
					various applications, not limited to web3.
				</p>
			),
		},
		{
			title: "Do Passkeys involve recovery phrases?",
			content: (
				<p>
					No, Passkeys operate without the need for recovery phrases. Ethereum
					EOA (Externally Owned Accounts) rely on a specific elliptical curve
					(secp256k1), requiring users to manage passwords or recovery phrases.
					Smart Accounts, such as Safe, can utilize programmable logic that can
					validates a difference curve, such as the one used in Passkeys
					(secp256r1) to secure account ownership and use it for signing
					transactions.
				</p>
			),
		},
		{
			title: "Who paid for gas fees?",
			content: (
				<p>
					Gas fees in Smart Accounts can be covered by a third party through a
					Paymaster. Candide Paymaster facilitate applications in sponsoring gas
					fees based on conditional gas policies. In our demo, we specified a
					gas policy to cover the gas for the account deployment and the NFT
					minting action.
				</p>
			),
		},
		{
			title: "How can I recover an account with Passkeys",
			content: (
				<p>
					Passkey backup options vary depending on your device and password
					manager preferences. Apple device users npm utilize iCloud Keychain by
					default, while Android users rely on Google Password Manager. For
					those who prefer alternative platforms, password managers such as
					Bitwarden, 1Password, and ProtonPass offer support for Passkeys.
					Additionally, YubiKey devices are also compatible.
				</p>
			),
		},
		{
			title: "How can I integrate Safe Passkeys into my app?",
			content: (
				<p>
					To integrate Safe Passkeys into your app, you can begin by using{" "}
					<i>abstractionkit@0.1.12</i>. Refer to the complete{" "}
					<a
						target="_blank"
						href="https://docs.candide.dev/wallet/plugins/passkeys/"
					>
						documentation
					</a>{" "}
					and find the source code to this demo on{" "}
					<a
						href="https://github.com/candidelabs/abstractionkit/tree/experimental/examples/SafeAccountExamples/PasskeysCreateAccountandSendTransaction"
						target="_blank"
					>
						github
					</a>
					.
				</p>
			),
		},
		{
			title: "Are Passkeys supported on all devices?",
			content: (
				<p>
					Passkeys are widely supported across various devices. They are
					compatible with Apple devices running iOS 16+ and macOS 13+, Android
					devices running Android 9+, Windows 10/11/+ on browsers like Chrome,
					Brave, Edge, and Firefox, as well as Linux on supported browsers such
					as Chrome, Firefox, Edge, and Brave. For a comprehensive list of
					supported devices, visit{" "}
					<a href="https://passkeys.dev/device-support" target="_blank">
						passkeys.dev/device-support
					</a>
				</p>
			),
		},
	],
};

const styles = {
	bgColor: "#242424",
	titleTextColor: "white",
	rowTitleColor: "white",
	rowContentColor: "white",
	arrowColor: "white",
};

const config = {
	animate: true,
	arrowIcon: "v",
	// tabFocus: true
};

function FaqCard() {
	return (
		<div
			style={{
				maxWidth: "750px",
				margin: "70px auto 0 auto",
				bottom: "0",
				width: "100%",
			}}
		>
			<Faq data={data} styles={styles} config={config} />
		</div>
	);
}

export { FaqCard };
