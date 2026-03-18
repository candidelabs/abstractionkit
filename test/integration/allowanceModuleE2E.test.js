const ak = require("../../dist/index.umd");
const { Wallet, JsonRpcProvider, ContractFactory, Contract } = require("ethers");
const {
	ANVIL_RPC,
	ANVIL_CHAIN_ID,
	ANVIL_ACCOUNTS,
	BUNDLER_RPC,
} = require("./anvil-setup");

jest.setTimeout(600000);

let bundlerAvailable = false;

beforeAll(async () => {
	try {
		const res = await fetch(BUNDLER_RPC, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				jsonrpc: "2.0",
				method: "eth_chainId",
				params: [],
				id: 1,
			}),
		});
		const data = await res.json();
		bundlerAvailable = !!data.result;
	} catch {
		bundlerAvailable = false;
	}
	if (!bundlerAvailable) {
		console.warn(
			"Voltaire bundler not reachable — skipping allowance module e2e tests",
		);
	}
});

// Minimal ERC20 with mint(address,uint256)
const TEST_TOKEN_ABI = [
	"function mint(address to, uint256 amount) external",
	"function balanceOf(address) view returns (uint256)",
	"function transfer(address to, uint256 amount) returns (bool)",
	"function approve(address spender, uint256 amount) returns (bool)",
	"function transferFrom(address from, address to, uint256 amount) returns (bool)",
	"function allowance(address, address) view returns (uint256)",
];
const TEST_TOKEN_BYTECODE =
	"0x6080604052601260035f6101000a81548160ff021916908360ff1602179055506040518060400160405280600481526020017f54657374000000000000000000000000000000000000000000000000000000008152506004908161006391906102f7565b506040518060400160405280600381526020017f5453540000000000000000000000000000000000000000000000000000000000815250600590816100a891906102f7565b503480156100b4575f5ffd5b506103c6565b5f81519050919050565b7f4e487b71000000000000000000000000000000000000000000000000000000005f52604160045260245ffd5b7f4e487b71000000000000000000000000000000000000000000000000000000005f52602260045260245ffd5b5f600282049050600182168061013557607f821691505b602082108103610148576101476100f1565b5b50919050565b5f819050815f5260205f209050919050565b5f6020601f8301049050919050565b5f82821b905092915050565b5f600883026101aa7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff8261016f565b6101b4868361016f565b95508019841693508086168417925050509392505050565b5f819050919050565b5f819050919050565b5f6101f86101f36101ee846101cc565b6101d5565b6101cc565b9050919050565b5f819050919050565b610211836101de565b61022561021d826101ff565b84845461017b565b825550505050565b5f5f905090565b61023c61022d565b610247818484610208565b505050565b5b8181101561026a5761025f5f82610234565b60018101905061024d565b5050565b601f8211156102af576102808161014e565b61028984610160565b81016020851015610298578190505b6102ac6102a485610160565b83018261024c565b50505b505050565b5f82821c905092915050565b5f6102cf5f19846008026102b4565b1980831691505092915050565b5f6102e783836102c0565b9150826002028217905092915050565b610300826100ba565b67ffffffffffffffff811115610319576103186100c4565b5b610323825461011e565b61032e82828561026e565b5f60209050601f83116001811461035f575f841561034d578287015190505b61035785826102dc565b8655506103be565b601f19841661036d8661014e565b5f5b828110156103945784890151825560018201915060208501945060208101905061036f565b868310156103b157848901516103ad601f8916826102c0565b8355505b6001600288020188555050505b505050505050565b610cc1806103d35f395ff3fe608060405234801561000f575f5ffd5b506004361061009c575f3560e01c806340c10f191161006457806340c10f191461015a57806370a082311461017657806395d89b41146101a6578063a9059cbb146101c4578063dd62ed3e146101f45761009c565b806306fdde03146100a0578063095ea7b3146100be57806318160ddd146100ee57806323b872dd1461010c578063313ce5671461013c575b5f5ffd5b6100a8610224565b6040516100b59190610894565b60405180910390f35b6100d860048036038101906100d39190610945565b6102b0565b6040516100e5919061099d565b60405180910390f35b6100f6610338565b60405161010391906109c5565b60405180910390f35b610126600480360381019061012191906109de565b61033e565b604051610133919061099d565b60405180910390f35b6101446105b6565b6040516101519190610a49565b60405180910390f35b610174600480360381019061016f9190610945565b6105c8565b005b610190600480360381019061018b9190610a62565b610636565b60405161019d91906109c5565b60405180910390f35b6101ae61064a565b6040516101bb9190610894565b60405180910390f35b6101de60048036038101906101d99190610945565b6106d6565b6040516101eb919061099d565b60405180910390f35b61020e60048036038101906102099190610a8d565b610804565b60405161021b91906109c5565b60405180910390f35b6004805461023190610af8565b80601f016020809104026020016040519081016040528092919081815260200182805461025d90610af8565b80156102a85780601f1061027f576101008083540402835291602001916102a8565b820191905f5260205f20905b81548152906001019060200180831161028b57829003601f168201915b505050505081565b5f8160015f3373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020015f205f8573ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020015f20819055506001905092915050565b60025481565b5f8160015f8673ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020015f205f3373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020015f205410156103fa576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016103f190610b72565b60405180910390fd5b815f5f8673ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020015f20541015610479576040517f08c379a000000000000000000000000000000000000000000000000000000000815260040161047090610bda565b60405180910390fd5b8160015f8673ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020015f205f3373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020015f205f8282546105009190610c25565b92505081905550815f5f8673ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020015f205f8282546105529190610c25565b92505081905550815f5f8573ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020015f205f8282546105a49190610c58565b92505081905550600190509392505050565b60035f9054906101000a900460ff1681565b805f5f8473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020015f205f8282546106139190610c58565b925050819055508060025f82825461062b9190610c58565b925050819055505050565b5f602052805f5260405f205f915090505481565b6005805461065790610af8565b80601f016020809104026020016040519081016040528092919081815260200182805461068390610af8565b80156106ce5780601f106106a5576101008083540402835291602001916106ce565b820191905f5260205f20905b8154815290600101906020018083116106b157829003601f168201915b505050505081565b5f815f5f3373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020015f20541015610756576040517f08c379a000000000000000000000000000000000000000000000000000000000815260040161074d90610bda565b60405180910390fd5b815f5f3373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020015f205f8282546107a19190610c25565b92505081905550815f5f8573ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020015f205f8282546107f39190610c58565b925050819055506001905092915050565b6001602052815f5260405f20602052805f5260405f205f91509150505481565b5f81519050919050565b5f82825260208201905092915050565b8281835e5f83830152505050565b5f601f19601f8301169050919050565b5f61086682610824565b610870818561082e565b935061088081856020860161083e565b6108898161084c565b840191505092915050565b5f6020820190508181035f8301526108ac818461085c565b905092915050565b5f5ffd5b5f73ffffffffffffffffffffffffffffffffffffffff82169050919050565b5f6108e1826108b8565b9050919050565b6108f1816108d7565b81146108fb575f5ffd5b50565b5f8135905061090c816108e8565b92915050565b5f819050919050565b61092481610912565b811461092e575f5ffd5b50565b5f8135905061093f8161091b565b92915050565b5f5f6040838503121561095b5761095a6108b4565b5b5f610968858286016108fe565b925050602061097985828601610931565b9150509250929050565b5f8115159050919050565b61099781610983565b82525050565b5f6020820190506109b05f83018461098e565b92915050565b6109bf81610912565b82525050565b5f6020820190506109d85f8301846109b6565b92915050565b5f5f5f606084860312156109f5576109f46108b4565b5b5f610a02868287016108fe565b9350506020610a13868287016108fe565b9250506040610a2486828701610931565b9150509250925092565b5f60ff82169050919050565b610a4381610a2e565b82525050565b5f602082019050610a5c5f830184610a3a565b92915050565b5f60208284031215610a7757610a766108b4565b5b5f610a84848285016108fe565b91505092915050565b5f5f60408385031215610aa357610aa26108b4565b5b5f610ab0858286016108fe565b9250506020610ac1858286016108fe565b9150509250929050565b7f4e487b71000000000000000000000000000000000000000000000000000000005f52602260045260245ffd5b5f6002820490506001821680610b0f57607f821691505b602082108103610b2257610b21610acb565b5b50919050565b7f616c6c6f77616e636500000000000000000000000000000000000000000000005f82015250565b5f610b5c60098361082e565b9150610b6782610b28565b602082019050919050565b5f6020820190508181035f830152610b8981610b50565b9050919050565b7f696e73756666696369656e7400000000000000000000000000000000000000005f82015250565b5f610bc4600c8361082e565b9150610bcf82610b90565b602082019050919050565b5f6020820190508181035f830152610bf181610bb8565b9050919050565b7f4e487b71000000000000000000000000000000000000000000000000000000005f52601160045260245ffd5b5f610c2f82610912565b9150610c3a83610912565b9250828203905081811115610c5257610c51610bf8565b5b92915050565b5f610c6282610912565b9150610c6d83610912565b9250828201905080821115610c8557610c84610bf8565b5b9291505056fea264697066735822122052093fcb38aa162804d4b3f0e85365fbb7c740abc8619d1525abb9b6ee4ab0c164736f6c634300081e0033";

const transferRecipient = "0x084178A5fD956e624FCb61C3c2209E3dcf42c8E8";

async function fundAccount(fromPrivateKey, toAddress, amountWei) {
	const provider = new JsonRpcProvider(ANVIL_RPC);
	const wallet = new Wallet(fromPrivateKey, provider);
	const tx = await wallet.sendTransaction({
		to: toAddress,
		value: amountWei,
	});
	await tx.wait();
}

async function deployTestToken(deployerPrivateKey) {
	const provider = new JsonRpcProvider(ANVIL_RPC);
	const wallet = new Wallet(deployerPrivateKey, provider);
	const factory = new ContractFactory(TEST_TOKEN_ABI, TEST_TOKEN_BYTECODE, wallet);
	const token = await factory.deploy();
	await token.waitForDeployment();
	const address = await token.getAddress();
	return { address, contract: token };
}

async function mintTokens(tokenContract, toAddress, amount) {
	const tx = await tokenContract.mint(toAddress, amount);
	await tx.wait();
}

async function sendSignedUserOp(smartAccount, userOp, ownerPrivateKey) {
	userOp.signature = smartAccount.signUserOperation(
		userOp,
		[ownerPrivateKey],
		BigInt(ANVIL_CHAIN_ID),
	);
	const response = await smartAccount.sendUserOperation(userOp, BUNDLER_RPC);
	const receipt = await response.included();
	return receipt;
}

async function advanceTime(seconds) {
	await ak.sendJsonRpcRequest(ANVIL_RPC, "evm_increaseTime", [seconds]);
	await ak.sendJsonRpcRequest(ANVIL_RPC, "evm_mine", []);
}

// Use accounts[4-7] to avoid conflicts with safeAccountE2E tests
const safeVersions = [
	{
		name: "V0_3_0",
		cls: null,
		sourceOwner: ANVIL_ACCOUNTS[4],
		delegateOwner: ANVIL_ACCOUNTS[5],
	},
	{
		name: "V0_2_0",
		cls: null,
		sourceOwner: ANVIL_ACCOUNTS[6],
		delegateOwner: ANVIL_ACCOUNTS[7],
	},
];

safeVersions[0].cls = ak.SafeAccountV0_3_0;
safeVersions[1].cls = ak.SafeAccountV0_2_0;

let testTokenAddress;
let testTokenContract;

describe.skip.each(safeVersions)(
	"Allowance module e2e — $name",
	({ cls: SafeAccountVersion, sourceOwner, delegateOwner }) => {
		let allowanceSourceAccount;
		let delegateAccount;
		let sourceAccountAddress;
		let delegateAccountAddress;
		const allowanceModule = new ak.AllowanceModule();

		beforeAll(async () => {
			sourceAccountAddress = SafeAccountVersion.createAccountAddress([
				sourceOwner.address,
			]);
			delegateAccountAddress = SafeAccountVersion.createAccountAddress([
				delegateOwner.address,
			]);

			

			// Deploy test ERC20 token (once, reuse across versions)
			if (!testTokenAddress) {
				const deployed = await deployTestToken(sourceOwner.privateKey);
				testTokenAddress = deployed.address;
				testTokenContract = deployed.contract;
			}

			// Fund both Safe accounts with ETH
			await fundAccount(
				sourceOwner.privateKey,
				sourceAccountAddress,
				5000000000000000000n,
			);
			await fundAccount(
				delegateOwner.privateKey,
				delegateAccountAddress,
				5000000000000000000n,
			);
		});

		test("deploy source account", async () => {
			

			allowanceSourceAccount = SafeAccountVersion.initializeNewAccount([
				sourceOwner.address,
			]);
			expect(allowanceSourceAccount.accountAddress).toBe(
				sourceAccountAddress,
			);

			const userOp = await allowanceSourceAccount.createUserOperation(
				[{ to: sourceOwner.address, value: 0n, data: "0x" }],
				ANVIL_RPC,
				BUNDLER_RPC,
			);

			const receipt = await sendSignedUserOp(
				allowanceSourceAccount,
				userOp,
				sourceOwner.privateKey,
			);
			expect(receipt.success).toBe(true);
		});

		test("deploy delegate account", async () => {
			

			delegateAccount = SafeAccountVersion.initializeNewAccount([
				delegateOwner.address,
			]);
			expect(delegateAccount.accountAddress).toBe(delegateAccountAddress);

			const userOp = await delegateAccount.createUserOperation(
				[{ to: delegateOwner.address, value: 0n, data: "0x" }],
				ANVIL_RPC,
				BUNDLER_RPC,
			);

			const receipt = await sendSignedUserOp(
				delegateAccount,
				userOp,
				delegateOwner.privateKey,
			);
			expect(receipt.success).toBe(true);
		});

		test("mint test tokens to source account", async () => {
			

			// Re-connect the token contract with the source owner's wallet
			const provider = new JsonRpcProvider(ANVIL_RPC);
			const wallet = new Wallet(sourceOwner.privateKey, provider);
			const token = new Contract(testTokenAddress, TEST_TOKEN_ABI, wallet);

			// Mint tokens to the source Safe account
			await mintTokens(token, sourceAccountAddress, 1000n);

			const balance = await token.balanceOf(sourceAccountAddress);
			expect(balance).toBe(1000n);
		});

		test("initialization and clear allowance", async () => {
			

			allowanceSourceAccount = new SafeAccountVersion(
				sourceAccountAddress,
			);
			delegateAccount = new SafeAccountVersion(delegateAccountAddress);

			const delegates = await allowanceModule.getDelegates(
				ANVIL_RPC,
				allowanceSourceAccount.accountAddress,
			);
			if (
				delegates
					.map((d) => d.toLowerCase())
					.includes(delegateAccount.accountAddress.toLowerCase())
			) {
				const deleteAllowanceMetaTransaction =
					allowanceModule.createDeleteAllowanceMetaTransaction(
						delegateAccount.accountAddress,
						testTokenAddress,
					);
				const userOp =
					await allowanceSourceAccount.createUserOperation(
						[deleteAllowanceMetaTransaction],
						ANVIL_RPC,
						BUNDLER_RPC,
					);
				const receipt = await sendSignedUserOp(
					allowanceSourceAccount,
					userOp,
					sourceOwner.privateKey,
				);
				expect(receipt.success).toBe(true);
			}
		});

		test("create one-time allowance and execute transfer", async () => {
			

			const addDelegateMetaTransaction =
				allowanceModule.createAddDelegateMetaTransaction(
					delegateAccount.accountAddress,
				);

			const setAllowanceMetaTransaction =
				allowanceModule.createOneTimeAllowanceMetaTransaction(
					delegateAccount.accountAddress,
					testTokenAddress,
					1,
					0,
				);

			let metaTransactionList = [
				addDelegateMetaTransaction,
				setAllowanceMetaTransaction,
			];

			const isAllowanceModuleEnabled =
				await allowanceSourceAccount.isModuleEnabled(
					ANVIL_RPC,
					allowanceModule.moduleAddress,
				);
			if (!isAllowanceModuleEnabled) {
				const enableModule =
					allowanceModule.createEnableModuleMetaTransaction(
						allowanceSourceAccount.accountAddress,
					);
				metaTransactionList.unshift(enableModule);
			}

			const userOp = await allowanceSourceAccount.createUserOperation(
				metaTransactionList,
				ANVIL_RPC,
				BUNDLER_RPC,
			);

			const receipt = await sendSignedUserOp(
				allowanceSourceAccount,
				userOp,
				sourceOwner.privateKey,
			);
			expect(receipt.success).toBe(true);

			const delegates = await allowanceModule.getDelegates(
				ANVIL_RPC,
				allowanceSourceAccount.accountAddress,
			);
			expect(
				delegates.map((d) => d.toLowerCase()),
			).toContain(delegateAccount.accountAddress.toLowerCase());

			const tokenAllowance = await allowanceModule.getTokensAllowance(
				ANVIL_RPC,
				allowanceSourceAccount.accountAddress,
				delegateAccount.accountAddress,
				testTokenAddress,
			);
			expect(tokenAllowance).toEqual(
				expect.objectContaining({
					amount: 1n,
					resetTimeMin: 0n,
				}),
			);

			// Execute transfer using the allowance
			const allowanceTransferMetaTransaction =
				allowanceModule.createAllowanceTransferMetaTransaction(
					allowanceSourceAccount.accountAddress,
					testTokenAddress,
					transferRecipient,
					1,
					delegateAccount.accountAddress,
				);

			const transferUserOp = await delegateAccount.createUserOperation(
				[allowanceTransferMetaTransaction],
				ANVIL_RPC,
				BUNDLER_RPC,
			);

			const transferReceipt = await sendSignedUserOp(
				delegateAccount,
				transferUserOp,
				delegateOwner.privateKey,
			);
			expect(transferReceipt.success).toBe(true);
		});

		test("fail on second transfer with one-time allowance", async () => {
			

			const allowanceTransferMetaTransaction =
				allowanceModule.createAllowanceTransferMetaTransaction(
					allowanceSourceAccount.accountAddress,
					testTokenAddress,
					transferRecipient,
					1,
					delegateAccount.accountAddress,
				);

			await expect(
				delegateAccount.createUserOperation(
					[allowanceTransferMetaTransaction],
					ANVIL_RPC,
					BUNDLER_RPC,
				),
			).rejects.toThrow();
		});

		test("pass after allowance is renewed", async () => {
			

			const renewAllowanceMetaTransaction =
				allowanceModule.createRenewAllowanceMetaTransaction(
					delegateAccount.accountAddress,
					testTokenAddress,
				);

			const renewUserOp =
				await allowanceSourceAccount.createUserOperation(
					[renewAllowanceMetaTransaction],
					ANVIL_RPC,
					BUNDLER_RPC,
				);

			const renewReceipt = await sendSignedUserOp(
				allowanceSourceAccount,
				renewUserOp,
				sourceOwner.privateKey,
			);
			expect(renewReceipt.success).toBe(true);

			// Should pass after renewal
			const allowanceTransferMetaTransaction =
				allowanceModule.createAllowanceTransferMetaTransaction(
					allowanceSourceAccount.accountAddress,
					testTokenAddress,
					transferRecipient,
					1,
					delegateAccount.accountAddress,
				);

			const transferUserOp = await delegateAccount.createUserOperation(
				[allowanceTransferMetaTransaction],
				ANVIL_RPC,
				BUNDLER_RPC,
			);

			const transferReceipt = await sendSignedUserOp(
				delegateAccount,
				transferUserOp,
				delegateOwner.privateKey,
			);
			expect(transferReceipt.success).toBe(true);
		});

		test("create recurrent allowance and execute transfer", async () => {
			

			const addDelegateMetaTransaction =
				allowanceModule.createAddDelegateMetaTransaction(
					delegateAccount.accountAddress,
				);

			const setAllowanceMetaTransaction =
				allowanceModule.createRecurringAllowanceMetaTransaction(
					delegateAccount.accountAddress,
					testTokenAddress,
					1,
					3, // 3 minutes
					0,
				);

			let metaTransactionList = [
				addDelegateMetaTransaction,
				setAllowanceMetaTransaction,
			];

			const isAllowanceModuleEnabled =
				await allowanceSourceAccount.isModuleEnabled(
					ANVIL_RPC,
					allowanceModule.moduleAddress,
				);
			if (!isAllowanceModuleEnabled) {
				const enableModule =
					allowanceModule.createEnableModuleMetaTransaction(
						allowanceSourceAccount.accountAddress,
					);
				metaTransactionList.unshift(enableModule);
			}

			const userOp = await allowanceSourceAccount.createUserOperation(
				metaTransactionList,
				ANVIL_RPC,
				BUNDLER_RPC,
			);

			const receipt = await sendSignedUserOp(
				allowanceSourceAccount,
				userOp,
				sourceOwner.privateKey,
			);
			expect(receipt.success).toBe(true);

			const delegates = await allowanceModule.getDelegates(
				ANVIL_RPC,
				allowanceSourceAccount.accountAddress,
			);
			expect(
				delegates.map((d) => d.toLowerCase()),
			).toContain(delegateAccount.accountAddress.toLowerCase());

			const tokenAllowance = await allowanceModule.getTokensAllowance(
				ANVIL_RPC,
				allowanceSourceAccount.accountAddress,
				delegateAccount.accountAddress,
				testTokenAddress,
			);
			expect(tokenAllowance).toEqual(
				expect.objectContaining({
					amount: 1n,
					resetTimeMin: 3n,
				}),
			);
		});

		test("fail if amount is more than authorized", async () => {
			

			const allowanceTransferMetaTransaction =
				allowanceModule.createAllowanceTransferMetaTransaction(
					allowanceSourceAccount.accountAddress,
					testTokenAddress,
					transferRecipient,
					2, // more than authorized
					delegateAccount.accountAddress,
				);

			await expect(
				delegateAccount.createUserOperation(
					[allowanceTransferMetaTransaction],
					ANVIL_RPC,
					BUNDLER_RPC,
				),
			).rejects.toThrow();
		});

		test("pass if amount is within authorized amount", async () => {
			

			const allowanceTransferMetaTransaction =
				allowanceModule.createAllowanceTransferMetaTransaction(
					allowanceSourceAccount.accountAddress,
					testTokenAddress,
					transferRecipient,
					1,
					delegateAccount.accountAddress,
				);

			const userOp = await delegateAccount.createUserOperation(
				[allowanceTransferMetaTransaction],
				ANVIL_RPC,
				BUNDLER_RPC,
			);

			const receipt = await sendSignedUserOp(
				delegateAccount,
				userOp,
				delegateOwner.privateKey,
			);
			expect(receipt.success).toBe(true);
		});

		test("fail before recurring allowance period, pass after", async () => {
			

			const allowanceTransferMetaTransaction =
				allowanceModule.createAllowanceTransferMetaTransaction(
					allowanceSourceAccount.accountAddress,
					testTokenAddress,
					transferRecipient,
					1,
					delegateAccount.accountAddress,
				);

			// Should fail — recurring period not elapsed
			await expect(
				delegateAccount.createUserOperation(
					[allowanceTransferMetaTransaction],
					ANVIL_RPC,
					BUNDLER_RPC,
				),
			).rejects.toThrow();

			// Advance time by 3 minutes using Anvil cheat code
			await advanceTime(3 * 60);

			// Should pass after recurring period
			const userOp = await delegateAccount.createUserOperation(
				[allowanceTransferMetaTransaction],
				ANVIL_RPC,
				BUNDLER_RPC,
			);

			const receipt = await sendSignedUserOp(
				delegateAccount,
				userOp,
				delegateOwner.privateKey,
			);
			expect(receipt.success).toBe(true);
		});

		test("fail transfer after allowance deleted", async () => {
			

			// Advance time so allowance renews first
			await advanceTime(3 * 60);

			// Delete the allowance
			const deleteAllowanceMetaTransaction =
				allowanceModule.createDeleteAllowanceMetaTransaction(
					delegateAccount.accountAddress,
					testTokenAddress,
				);

			const deleteUserOp =
				await allowanceSourceAccount.createUserOperation(
					[deleteAllowanceMetaTransaction],
					ANVIL_RPC,
					BUNDLER_RPC,
				);

			const deleteReceipt = await sendSignedUserOp(
				allowanceSourceAccount,
				deleteUserOp,
				sourceOwner.privateKey,
			);
			expect(deleteReceipt.success).toBe(true);

			// Should fail — allowance was deleted
			const allowanceTransferMetaTransaction =
				allowanceModule.createAllowanceTransferMetaTransaction(
					allowanceSourceAccount.accountAddress,
					testTokenAddress,
					transferRecipient,
					1,
					delegateAccount.accountAddress,
				);

			await expect(
				delegateAccount.createUserOperation(
					[allowanceTransferMetaTransaction],
					ANVIL_RPC,
					BUNDLER_RPC,
				),
			).rejects.toThrow();
		});
	},
);
