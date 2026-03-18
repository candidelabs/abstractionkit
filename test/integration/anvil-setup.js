const ANVIL_PORT = 8546;
const ANVIL_RPC = `http://127.0.0.1:${ANVIL_PORT}`;
const ANVIL_CHAIN_ID = 11155111; // Sepolia fork

const BUNDLER_PORT = 3000;
const BUNDLER_RPC = `http://127.0.0.1:${BUNDLER_PORT}/rpc`;
const VOLTAIRE_IMAGE =
	"ghcr.io/candidelabs/voltaire/voltaire-bundler:0.1.0a67";

// Anvil's default funded accounts (10000 ETH each)
const ANVIL_ACCOUNTS = [
	{
		address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
		privateKey:
			"0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
	},
	{
		address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
		privateKey:
			"0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
	},
	{
		address: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
		privateKey:
			"0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
	},
	{
		// Account[3] - used as bundler signer
		address: "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
		privateKey:
			"0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
	},
	{
		address: "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
		privateKey:
			"0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
	},
	{
		address: "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc",
		privateKey:
			"0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
	},
	{
		address: "0x976EA74026E726554dB657fA54763abd0C3a0aa9",
		privateKey:
			"0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e",
	},
	{
		address: "0x14Dc79964dA2C08DA15fB5315796897B78252D4A",
		privateKey:
			"0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356",
	},
	{
		address: "0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f",
		privateKey:
			"0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97",
	},
];

// Bundler uses account[3] as its signer
const BUNDLER_SECRET = ANVIL_ACCOUNTS[3].privateKey;

module.exports = {
	ANVIL_RPC,
	ANVIL_PORT,
	ANVIL_CHAIN_ID,
	ANVIL_ACCOUNTS,
	BUNDLER_PORT,
	BUNDLER_RPC,
	BUNDLER_SECRET,
	VOLTAIRE_IMAGE,
};
