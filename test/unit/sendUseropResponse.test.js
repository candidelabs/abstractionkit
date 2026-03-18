const ak = require("../../dist/index.umd");

const { SendUseroperationResponse, Bundler } = ak.abstractionkit
	? ak.abstractionkit
	: ak;

describe("SendUseroperationResponse", () => {
	const bundler = new Bundler("http://localhost:3000");
	const hash = "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
	const entrypoint = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";

	test("constructor sets properties", () => {
		const response = new SendUseroperationResponse(
			hash,
			bundler,
			entrypoint,
		);
		expect(response.userOperationHash).toBe(hash);
		expect(response.bundler).toBe(bundler);
		expect(response.entrypointAddress).toBe(entrypoint);
	});

	test("included throws RangeError for timeout <= 0", async () => {
		const response = new SendUseroperationResponse(
			hash,
			bundler,
			entrypoint,
		);
		await expect(response.included(0)).rejects.toThrow(RangeError);
		await expect(response.included(-1)).rejects.toThrow(RangeError);
	});

	test("included throws RangeError for interval <= 0", async () => {
		const response = new SendUseroperationResponse(
			hash,
			bundler,
			entrypoint,
		);
		await expect(response.included(10, 0)).rejects.toThrow(RangeError);
		await expect(response.included(10, -1)).rejects.toThrow(RangeError);
	});

	test("included throws RangeError when timeout < interval", async () => {
		const response = new SendUseroperationResponse(
			hash,
			bundler,
			entrypoint,
		);
		await expect(response.included(1, 5)).rejects.toThrow(RangeError);
	});

	test("included throws RangeError message describes the constraint", async () => {
		const response = new SendUseroperationResponse(
			hash,
			bundler,
			entrypoint,
		);
		await expect(response.included(0)).rejects.toThrow(
			"timeoutInSeconds and requestIntervalInSeconds should be bigger than zero",
		);
	});
});
