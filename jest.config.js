module.exports = {
	projects: [
		{
			displayName: "unit",
			testMatch: ["<rootDir>/test/unit/**/*.test.js"],
			testEnvironment: "node",
		},
		{
			displayName: "integration",
			testMatch: ["<rootDir>/test/integration/**/*.test.js"],
			testEnvironment: "node",
			globalSetup: "<rootDir>/test/integration/globalSetup.js",
			globalTeardown: "<rootDir>/test/integration/globalTeardown.js",
		},
		{
			displayName: "e2e",
			testMatch: [
				"<rootDir>/test/safe/**/*.test.js",
				"<rootDir>/test/simple/**/*.test.js",
				"<rootDir>/test/eip7702.test.js",
				"<rootDir>/test/entrypoint.test.js",
			],
			testEnvironment: "node",
		},
	],
};
