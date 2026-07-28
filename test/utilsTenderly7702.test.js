// Regression tests for EIP-7702 handling in the Tenderly simulation helpers:
// short/padded factory markers, fresh-delegation code overrides, and
// non-empty factoryData (sender initialization). Mocks global fetch and
// inspects the simulate-bundle request bodies.

const ak = require("../dist/index.cjs");

const ENTRYPOINT_V8 = "0x4337084d9e255ff0702461cf8895ce9e3b5ff108";
const SENDER_CREATOR_V8 = "0x449ed7c3e6fee6a97311d4b55475df59c44add33";
const PADDED_MARKER = "0x7702000000000000000000000000000000000000";
const SENDER = "0x1f9090aae28b8a3dceadf281b0f12828e676c326";
const DELEGATEE = "0xe6cae83bde06e4c305530e199d7217f42808555b";
const DELEGATION_CODE = `0xef0100${DELEGATEE.slice(2)}`;
const SENDER_MIXED_CASE = `0x${SENDER.slice(2).toUpperCase()}`;

function makeV8UserOperation(overrides = {}) {
	return {
		sender: SENDER,
		nonce: 1n,
		factory: "0x7702",
		factoryData: null,
		callData: "0xb61d27f6",
		callGasLimit: 100000n,
		verificationGasLimit: 100000n,
		preVerificationGas: 50000n,
		maxFeePerGas: 1000000n,
		maxPriorityFeePerGas: 1000000n,
		paymaster: null,
		paymasterVerificationGasLimit: null,
		paymasterPostOpGasLimit: null,
		paymasterData: null,
		signature: "0x",
		eip7702Auth: { address: DELEGATEE },
		...overrides,
	};
}

describe("Tenderly EIP-7702 simulation handling", () => {
	const originalFetch = global.fetch;
	let requests;

	beforeEach(() => {
		requests = [];
		global.fetch = async (url, init) => {
			const body = JSON.parse(init.body);
			requests.push({ url, body });
			return {
				ok: true,
				status: 200,
				statusText: "OK",
				text: async () =>
					JSON.stringify({
						simulation_results: body.simulations.map((_s, i) => ({
							transaction: {},
							simulation: { id: `sim-${i}` },
						})),
					}),
			};
		};
	});

	afterEach(() => {
		global.fetch = originalFetch;
	});

	describe("full handleOps simulation (simulateUserOperationWithTenderly)", () => {
		async function runFullSimulation(userOperation) {
			await ak.simulateUserOperationWithTenderly(
				"account",
				"project",
				"key",
				1n,
				ENTRYPOINT_V8,
				userOperation,
			);
			expect(requests).toHaveLength(1);
			return requests[0].body.simulations[0];
		}

		test("short marker with non-empty factoryData packs a padded marker head", async () => {
			const sim = await runFullSimulation(
				makeV8UserOperation({ factory: "0x7702", factoryData: "0xdeadbeef" }),
			);
			// initCode must be 0x7702 right-padded to 20 bytes ‖ factoryData …
			expect(sim.input).toContain(`${PADDED_MARKER.slice(2)}deadbeef`);
			// … not the malformed direct concatenation 0x7702‖factoryData
			expect(sim.input).not.toContain("7702deadbeef");
		});

		test("padded marker with non-empty factoryData packs identically", async () => {
			const sim = await runFullSimulation(
				makeV8UserOperation({ factory: PADDED_MARKER, factoryData: "0xdeadbeef" }),
			);
			expect(sim.input).toContain(`${PADDED_MARKER.slice(2)}deadbeef`);
		});

		test("installs the sender delegation-code override", async () => {
			const sim = await runFullSimulation(makeV8UserOperation());
			expect(sim.state_objects[SENDER].code).toBe(DELEGATION_CODE);
		});

		test("merges a caller override keyed by a checksummed sender address", async () => {
			await ak.simulateUserOperationWithTenderly(
				"account",
				"project",
				"key",
				1n,
				ENTRYPOINT_V8,
				makeV8UserOperation(),
				null,
				{ [SENDER_MIXED_CASE]: { balance: "0x1" } },
			);
			const sim = requests[0].body.simulations[0];
			expect(sim.state_objects).toEqual({
				[SENDER]: { balance: "0x1", code: DELEGATION_CODE },
			});
		});
	});

	describe("direct call-data simulation (simulateUserOperationCallDataWithTenderly)", () => {
		async function runCallDataSimulation(userOperation, stateOverrides) {
			await ak.simulateUserOperationCallDataWithTenderly(
				"account",
				"project",
				"key",
				1n,
				ENTRYPOINT_V8,
				userOperation,
				null,
				stateOverrides,
			);
			expect(requests).toHaveLength(1);
			return requests[0].body.simulations;
		}

		test("fresh delegation installs the sender code override", async () => {
			const sims = await runCallDataSimulation(makeV8UserOperation());
			expect(sims).toHaveLength(1);
			expect(sims[0].to).toBe(SENDER);
			expect(sims[0].state_objects[SENDER].code).toBe(DELEGATION_CODE);
		});

		test("non-empty factoryData enqueues a SenderCreator-to-sender initialization", async () => {
			const sims = await runCallDataSimulation(
				makeV8UserOperation({ factoryData: "0xdeadbeef" }),
			);
			expect(sims).toHaveLength(2);
			// initialization call: SenderCreator -> sender with the init data
			expect(sims[0].from).toBe(SENDER_CREATOR_V8);
			expect(sims[0].to).toBe(SENDER);
			expect(sims[0].input).toBe("0xdeadbeef");
			// call-data execution follows, both with the delegation override
			expect(sims[1].to).toBe(SENDER);
			expect(sims[1].input).toBe("0xb61d27f6");
			expect(sims[0].state_objects[SENDER].code).toBe(DELEGATION_CODE);
			expect(sims[1].state_objects[SENDER].code).toBe(DELEGATION_CODE);
		});

		test("without eip7702Auth no code override is installed", async () => {
			const sims = await runCallDataSimulation(makeV8UserOperation({ eip7702Auth: null }));
			expect(sims).toHaveLength(1);
			expect(sims[0].state_objects).toBeUndefined();
		});

		test("merges the delegation override without mutating caller state overrides", async () => {
			const callerOverrides = { [SENDER]: { balance: "0x1" } };
			const sims = await runCallDataSimulation(makeV8UserOperation(), callerOverrides);
			expect(sims[0].state_objects[SENDER]).toEqual({
				balance: "0x1",
				code: DELEGATION_CODE,
			});
			expect(callerOverrides).toEqual({ [SENDER]: { balance: "0x1" } });
		});

		test("merges a caller override keyed by a checksummed sender address", async () => {
			const callerOverrides = { [SENDER_MIXED_CASE]: { balance: "0x1" } };
			const sims = await runCallDataSimulation(makeV8UserOperation(), callerOverrides);
			expect(sims[0].state_objects).toEqual({
				[SENDER]: { balance: "0x1", code: DELEGATION_CODE },
			});
			expect(callerOverrides).toEqual({ [SENDER_MIXED_CASE]: { balance: "0x1" } });
		});
	});

	describe("state override key normalization (callTenderlySimulateBundle)", () => {
		test("lowercases override addresses in the payload", async () => {
			await ak.callTenderlySimulateBundle("account", "project", "key", [
				{
					chainId: 1n,
					from: SENDER,
					to: DELEGATEE,
					data: "0x",
					stateOverrides: { [SENDER_MIXED_CASE]: { balance: "0x1" } },
				},
			]);
			expect(requests[0].body.simulations[0].state_objects).toEqual({
				[SENDER]: { balance: "0x1" },
			});
		});

		test("rejects override addresses that differ only in case", async () => {
			await expect(
				ak.callTenderlySimulateBundle("account", "project", "key", [
					{
						chainId: 1n,
						from: SENDER,
						to: DELEGATEE,
						data: "0x",
						stateOverrides: {
							[SENDER]: { balance: "0x1" },
							[SENDER_MIXED_CASE]: { code: "0x00" },
						},
					},
				]),
			).rejects.toThrow(/Duplicate stateOverrides address/);
			expect(requests).toHaveLength(0);
		});
	});
});
