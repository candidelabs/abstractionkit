/* eslint-env node */
module.exports = {
	extends: [
		"eslint:recommended",
		"plugin:@typescript-eslint/recommended",
		"plugin:@typescript-eslint/recommended-requiring-type-checking",
	],
	parser: "@typescript-eslint/parser",
	parserOptions: {
		tsconfigRootDir: __dirname,
		project: ["./tsconfig.json"],
		ecmaVersion: 2018,
    	sourceType: "module"
	},
	plugins: [
		"@typescript-eslint",
		"eslint-plugin-tsdoc"
	],
	extends:  [
	  'plugin:@typescript-eslint/recommended'
	],
	rules: {
	  "tsdoc/syntax": "warn"
	},
	root: true,
};
