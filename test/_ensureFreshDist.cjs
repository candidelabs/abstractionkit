// Jest globalSetup: tests import the built package from dist/, so a stale
// build silently tests old code. Rebuild automatically when any file under
// src/ (or the build inputs) is newer than dist/index.cjs. Costs nothing
// when dist is fresh; one tsdown run (~3s) when it is not.

const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

function newestMtimeMs(entry) {
	const stat = fs.statSync(entry);
	if (!stat.isDirectory()) {
		return stat.mtimeMs;
	}
	let newest = 0;
	for (const name of fs.readdirSync(entry)) {
		newest = Math.max(newest, newestMtimeMs(path.join(entry, name)));
	}
	return newest;
}

module.exports = async () => {
	const distEntry = path.join(ROOT, "dist", "index.cjs");
	const inputs = ["src", "package.json", "tsconfig.json", "tsdown.config.ts"]
		.map((p) => path.join(ROOT, p))
		.filter((p) => fs.existsSync(p));
	const newestInput = Math.max(...inputs.map(newestMtimeMs));
	if (!fs.existsSync(distEntry) || fs.statSync(distEntry).mtimeMs < newestInput) {
		console.log("\ndist/ is stale relative to src/ — rebuilding before tests...");
		execSync("npm run build", { stdio: "inherit", cwd: ROOT });
	}
};
