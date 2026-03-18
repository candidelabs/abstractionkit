const { spawn, execFileSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

require("dotenv").config();

const ANVIL_PORT = 8546;
const ANVIL_RPC = `http://127.0.0.1:${ANVIL_PORT}`;
const SEPOLIA_RPC = process.env.SEPOLIA_RPC || "https://ethereum-sepolia-rpc.publicnode.com";
const SEPOLIA_CHAIN_ID = "11155111";
const BUNDLER_PORT = 3000;
const BUNDLER_RPC = `http://127.0.0.1:${BUNDLER_PORT}/rpc`;
const VOLTAIRE_IMAGE =
	"ghcr.io/candidelabs/voltaire/voltaire-bundler:0.1.0a67";
const CONTAINER_ID_FILE = path.join(__dirname, ".voltaire-container-id");

async function pollReady(url, maxAttempts, intervalMs, initialDelayMs) {
	let attempts = 0;
	return new Promise((resolve) => {
		const check = async () => {
			attempts++;
			try {
				const res = await fetch(url, {
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
				if (data.result) {
					resolve(true);
					return;
				}
			} catch {
				// Not ready yet
			}
			if (attempts >= maxAttempts) {
				resolve(false);
				return;
			}
			setTimeout(check, intervalMs);
		};
		setTimeout(check, initialDelayMs);
	});
}

module.exports = async function globalSetup() {
	// --- Start Anvil forking Sepolia ---
	const anvilProcess = spawn("anvil", [
		"--port",
		String(ANVIL_PORT),
		"--fork-url",
		SEPOLIA_RPC,
		"--chain-id",
		SEPOLIA_CHAIN_ID,
		"--silent",
	]);

	anvilProcess.on("error", (err) => {
		console.error("Failed to start anvil:", err.message);
		process.exit(1);
	});

	global.__ANVIL_PROCESS__ = anvilProcess;

	const anvilReady = await pollReady(ANVIL_RPC, 150, 200, 1000);
	if (!anvilReady) {
		throw new Error("Anvil failed to start within timeout");
	}

	// Generate a fresh bundler signer to avoid EIP-7702 delegation issues on forked accounts
	const { secp256k1 } = await import("@noble/curves/secp256k1");
	const { keccak_256 } = await import("@noble/hashes/sha3");

	const bundlerPrivateKeyBytes = crypto.randomBytes(32);
	const bundlerSecret =
		"0x" + bundlerPrivateKeyBytes.toString("hex");
	const publicKey = secp256k1.getPublicKey(bundlerPrivateKeyBytes, false).slice(1);
	const bundlerSignerAddress =
		"0x" + Buffer.from(keccak_256(publicKey).slice(-20)).toString("hex");

	// Fund the fresh bundler signer with 10 000 ETH
	await fetch(ANVIL_RPC, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			jsonrpc: "2.0",
			method: "anvil_setBalance",
			params: [bundlerSignerAddress, "0x21E19E0C9BAB2400000"],
			id: 1,
		}),
	});

	// --- Start Voltaire bundler via Docker ---
	try {
		execFileSync("docker", ["info"], { stdio: "ignore", timeout: 5000 });
	} catch {
		console.warn(
			"Docker not available — bundler integration tests will be skipped",
		);
		return;
	}

	// Stop any stale Voltaire container from a previous run
	try {
		const staleId = fs.readFileSync(CONTAINER_ID_FILE, "utf-8").trim();
		if (staleId) {
			execFileSync("docker", ["stop", staleId], {
				timeout: 10000,
				stdio: "ignore",
			});
		}
	} catch {}
	try {
		fs.unlinkSync(CONTAINER_ID_FILE);
	} catch {}

	try {
		const ethereumNodeUrl =
			process.platform === "linux"
				? `http://127.0.0.1:${ANVIL_PORT}`
				: `http://host.docker.internal:${ANVIL_PORT}`;

		const networkArgs =
			process.platform === "linux"
				? ["--net=host"]
				: ["-p", `${BUNDLER_PORT}:${BUNDLER_PORT}`];

		const containerId = execFileSync(
			"docker",
			[
				"run",
				"-d",
				"--rm",
				"--platform",
				"linux/amd64",
				...networkArgs,
				VOLTAIRE_IMAGE,
				"--bundler_secret",
				bundlerSecret,
				"--chain_id",
				SEPOLIA_CHAIN_ID,
				"--verbose",
				"--eip7702",
				"--ethereum_node_url",
				ethereumNodeUrl,
				"--disable_p2p",
				"--unsafe",
				"--rpc_url",
				"0.0.0.0",
				"--rpc_port",
				String(BUNDLER_PORT),
			],
			{ timeout: 120000, encoding: "utf-8" },
		).trim();

		fs.writeFileSync(CONTAINER_ID_FILE, containerId);

		const bundlerReady = await pollReady(BUNDLER_RPC, 120, 500, 3000);
		if (!bundlerReady) {
			console.warn(
				"Voltaire bundler did not become ready — bundler tests will be skipped",
			);
		}
	} catch (err) {
		console.warn(`Failed to start Voltaire bundler: ${err.message}`);
		console.warn("Bundler integration tests will be skipped");
		try {
			const id = fs.readFileSync(CONTAINER_ID_FILE, "utf-8").trim();
			if (id)
				execFileSync("docker", ["stop", id], {
					timeout: 10000,
					stdio: "ignore",
				});
		} catch {}
		try {
			fs.unlinkSync(CONTAINER_ID_FILE);
		} catch {}
	}
};
