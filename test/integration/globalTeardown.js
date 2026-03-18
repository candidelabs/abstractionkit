const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const CONTAINER_ID_FILE = path.join(__dirname, ".voltaire-container-id");

module.exports = async function globalTeardown() {
	// Stop Anvil
	if (global.__ANVIL_PROCESS__) {
		global.__ANVIL_PROCESS__.kill("SIGTERM");
	}

	// Stop Voltaire Docker container
	try {
		const containerId = fs.readFileSync(CONTAINER_ID_FILE, "utf-8").trim();
		if (containerId) {
			execFileSync("docker", ["stop", containerId], {
				timeout: 10000,
				stdio: "ignore",
			});
		}
	} catch {
		// Container may have already stopped or file doesn't exist
	}

	try {
		fs.unlinkSync(CONTAINER_ID_FILE);
	} catch {}
};
