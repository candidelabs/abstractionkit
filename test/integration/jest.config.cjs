module.exports = {
	testEnvironment: "node",
	rootDir: "../..",
	testMatch: ["<rootDir>/test/integration/**/*.test.js"],
	globalSetup: "<rootDir>/test/integration/globalSetup.cjs",
	globalTeardown: "<rootDir>/test/integration/globalTeardown.cjs",
};
