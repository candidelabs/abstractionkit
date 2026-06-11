module.exports = {
	testEnvironment: "node",
	modulePathIgnorePatterns: ["/.worktrees/"],
	testPathIgnorePatterns: ["/node_modules/", "/dist/", "/.worktrees/", "/test/integration/"],
	// Tests import the built package from dist/; rebuild when src/ is newer.
	globalSetup: "<rootDir>/test/_ensureFreshDist.cjs",
};
