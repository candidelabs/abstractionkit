import {
	keccak256 as t,
	AbiCoder as e,
	solidityPacked as r,
	solidityPackedKeccak256 as s,
	ZeroAddress as i,
} from "ethers";
import * as n from "isomorphic-unfetch";
function a(r, s, i) {
	const n = t(
			(function (r) {
				const s = [
					r.sender,
					r.nonce,
					t(r.initCode),
					t(r.callData),
					r.callGasLimit,
					r.verificationGasLimit,
					r.preVerificationGas,
					r.maxFeePerGas,
					r.maxPriorityFeePerGas,
					t(r.paymasterAndData),
				];
				return e
					.defaultAbiCoder()
					.encode(
						[
							"address",
							"uint256",
							"bytes32",
							"bytes32",
							"uint256",
							"uint256",
							"uint256",
							"uint256",
							"uint256",
							"bytes32",
						],
						s,
					);
			})(r),
		),
		a = e
			.defaultAbiCoder()
			.encode(["bytes32", "address", "uint256"], [n, s, i]);
	return t(a);
}
function o(t, r, s) {
	return t + e.defaultAbiCoder().encode(r, s).slice(2);
}
class c {
	constructor(t, e, r, s, i, n) {
		(this.singletonAddress = void 0),
			(this.proxyByteCode = void 0),
			(this.initializerFunctionSelector = void 0),
			(this.initializerFunctionInputAbi = void 0),
			(this.executorFunctionSelector = void 0),
			(this.executorFunctionInputAbi = void 0),
			(this.singletonAddress = t),
			(this.proxyByteCode = e),
			(this.initializerFunctionSelector = r),
			(this.initializerFunctionInputAbi = s),
			(this.executorFunctionSelector = i),
			(this.executorFunctionInputAbi = n);
	}
	getInitializerCallData(t) {
		return o(
			this.initializerFunctionSelector,
			this.initializerFunctionInputAbi,
			t,
		);
	}
	getExecutorCallData(t) {
		return o(this.executorFunctionSelector, this.executorFunctionInputAbi, t);
	}
	getProxyAddress(e, i, n) {
		const a = t(r(["bytes32", "uint256"], [t(e), n])),
			o = t(
				r(["bytes", "uint256"], [this.proxyByteCode, this.singletonAddress]),
			);
		return (
			"0x" +
			s(["bytes1", "address", "bytes32", "bytes32"], ["0xff", i, a, o]).slice(
				-40,
			)
		);
	}
}
class d {
	constructor(t, e, r) {
		(this.address = void 0),
			(this.generatorFunctionSelector = void 0),
			(this.generatorFunctionInputAbi = void 0),
			(this.address = t),
			(this.generatorFunctionSelector = e),
			(this.generatorFunctionInputAbi = r);
	}
	getFactoryGeneratorFunctionCallData(t) {
		const e = o(
			this.generatorFunctionSelector,
			this.generatorFunctionInputAbi,
			t,
		);
		return this.address + e.slice(2);
	}
}
class u extends d {
	constructor(t = "0xb73Eb505Abc30d0e7e15B73A492863235B3F4309") {
		super(t, "0x1688f0b9", ["address", "bytes", "uint256"]);
	}
}
class l extends c {
	constructor(
		t = "0x3A0a17Bcc84576b099373ab3Eed9702b07D30402",
		e = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789",
		r = new u(),
	) {
		super(
			t,
			"0x608060405234801561001057600080fd5b5060405161017338038061017383398101604081905261002f916100b9565b6001600160a01b0381166100945760405162461bcd60e51b815260206004820152602260248201527f496e76616c69642073696e676c65746f6e20616464726573732070726f766964604482015261195960f21b606482015260840160405180910390fd5b600080546001600160a01b0319166001600160a01b03929092169190911790556100e9565b6000602082840312156100cb57600080fd5b81516001600160a01b03811681146100e257600080fd5b9392505050565b607c806100f76000396000f3fe6080604052600080546001600160a01b0316813563530ca43760e11b1415602857808252602082f35b3682833781823684845af490503d82833e806041573d82fd5b503d81f3fea2646970667358221220022b6bb97dd1e16cb867add83d4159f7550336cbb5b40514145e43f493c1377664736f6c634300080c0033",
			"0x6a1e9826",
			[
				"address[]",
				"uint256",
				"address",
				"bytes",
				"address",
				"address",
				"uint256",
				"address",
				"address",
			],
			"0xf34308ef",
			["address", "uint256", "bytes", "uint8", "address", "address", "uint256"],
		),
			(this.entrypointAddress = void 0),
			(this.candideAccountFactory = void 0),
			(this.entrypointAddress = e),
			(this.candideAccountFactory = r);
	}
	createNewAccount(t, e = 1, r = 0, s = i) {
		const n = this.getInitializerCallData([
			t,
			e,
			i,
			"0x",
			s,
			i,
			0,
			i,
			this.entrypointAddress,
		]);
		return [
			this.getProxyAddress(n, this.candideAccountFactory.address, r),
			this.candideAccountFactory.getFactoryGeneratorFunctionCallData([
				this.singletonAddress,
				n,
				r,
			]),
		];
	}
	createSendEthCallData(t, e) {
		return this.createCallData(t, e, "0x", 0, i, i, 0);
	}
	createCallData(t, e, r, s, i, n, a) {
		return this.getExecutorCallData([t, e, r, s, i, n, a]);
	}
}
function h() {
	return (
		(h = Object.assign
			? Object.assign.bind()
			: function (t) {
					for (var e = 1; e < arguments.length; e++) {
						var r = arguments[e];
						for (var s in r)
							Object.prototype.hasOwnProperty.call(r, s) && (t[s] = r[s]);
					}
					return t;
			  }),
		h.apply(this, arguments)
	);
}
class p {
	constructor(t, e) {
		(this.rpcUrl = void 0),
			(this.entrypointAddress = void 0),
			(this.rpcUrl = t),
			(this.entrypointAddress = e);
	}
	async chainId() {
		const t = await this.sendJsonRpcRequest(this.rpcUrl, "eth_chainId", []);
		return "result" in t ? { chainId: t.result } : t.error;
	}
	async supportedEntryPoints() {
		const t = await this.sendJsonRpcRequest(
			this.rpcUrl,
			"eth_supportedEntryPoints",
			[],
		);
		return "result" in t ? { supportedEntryPoints: t.result } : t.error;
	}
	async estimateUserOperationGas(t) {
		const e = await this.sendJsonRpcRequest(
			this.rpcUrl,
			"eth_estimateUserOperationGas",
			[t, this.entrypointAddress],
		);
		return "result" in e ? e.result : e.error;
	}
	async sendUserOperation(t) {
		const e = await this.sendJsonRpcRequest(
			this.rpcUrl,
			"eth_sendUserOperation",
			[t, this.entrypointAddress],
		);
		return "result" in e ? { userOperationHash: e.result } : e.error;
	}
	async getUserOperationReceipt(t) {
		const e = await this.sendJsonRpcRequest(
			this.rpcUrl,
			"eth_getUserOperationReceipt",
			[t],
		);
		if ("result" in e) {
			const t = e.result,
				r = h({}, t.receipt, { logs: JSON.stringify(t.receipt.logs) });
			return h({}, t, { logs: JSON.stringify(t.logs), receipt: r });
		}
		return e.error;
	}
	async getUserOperationByHash(t) {
		const e = await this.sendJsonRpcRequest(
			this.rpcUrl,
			"eth_getUserOperationByHash",
			[t],
		);
		return "result" in e ? e.result : e.error;
	}
	async sendJsonRpcRequest(t, e, r) {
		const s = n.default || n,
			i = {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ method: e, params: r, id: 1, jsonrpc: "2.0" }),
				redirect: "follow",
			},
			a = await s(t, i);
		return JSON.parse(await a.text());
	}
}
const b = {
	sender: i,
	nonce: 0,
	initCode: "0x",
	callData: "0x",
	callGasLimit: 0,
	verificationGasLimit: 0,
	preVerificationGas: 0,
	maxFeePerGas: 0,
	maxPriorityFeePerGas: 0,
	paymasterAndData: "0x",
	signature: "0x",
};
var y = {
	__proto__: null,
	SmartAccount: c,
	CandideAccount: l,
	SmartAccountFactory: d,
	CandideAccountFactory: u,
	Bundler: p,
	getUserOperationHash: a,
	UserOperationEmptyValues: b,
};
export {
	p as Bundler,
	l as CandideAccount,
	u as CandideAccountFactory,
	c as SmartAccount,
	d as SmartAccountFactory,
	b as UserOperationEmptyValues,
	y as abstractionkit,
	a as getUserOperationHash,
};
