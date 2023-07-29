import {
	keccak256 as t,
	AbiCoder as e,
	solidityPacked as r,
	solidityPackedKeccak256 as n,
	ZeroAddress as i,
} from "ethers";
import * as o from "isomorphic-unfetch";
function s(r, n, i) {
	var o = t(
			(function (r) {
				var n = [
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
						n,
					);
			})(r),
		),
		s = e
			.defaultAbiCoder()
			.encode(["bytes32", "address", "uint256"], [o, n, i]);
	return t(s);
}
function c(t, r, n) {
	return t + e.defaultAbiCoder().encode(r, n).slice(2);
}
var a = /*#__PURE__*/ (function () {
	function e(t, e, r, n, i, o) {
		(this.singletonAddress = void 0),
			(this.proxyByteCode = void 0),
			(this.initializerFunctionSelector = void 0),
			(this.initializerFunctionInputAbi = void 0),
			(this.executorFunctionSelector = void 0),
			(this.executorFunctionInputAbi = void 0),
			(this.singletonAddress = t),
			(this.proxyByteCode = e),
			(this.initializerFunctionSelector = r),
			(this.initializerFunctionInputAbi = n),
			(this.executorFunctionSelector = i),
			(this.executorFunctionInputAbi = o);
	}
	var i = e.prototype;
	return (
		(i.getInitializerCallData = function (t) {
			return c(
				this.initializerFunctionSelector,
				this.initializerFunctionInputAbi,
				t,
			);
		}),
		(i.getExecutorCallData = function (t) {
			return c(this.executorFunctionSelector, this.executorFunctionInputAbi, t);
		}),
		(i.getProxyAddress = function (e, i, o) {
			var s = t(r(["bytes32", "uint256"], [t(e), o])),
				c = t(
					r(["bytes", "uint256"], [this.proxyByteCode, this.singletonAddress]),
				);
			return (
				"0x" +
				n(["bytes1", "address", "bytes32", "bytes32"], ["0xff", i, s, c]).slice(
					-40,
				)
			);
		}),
		e
	);
})();
function u() {
	return (
		(u = Object.assign
			? Object.assign.bind()
			: function (t) {
					for (var e = 1; e < arguments.length; e++) {
						var r = arguments[e];
						for (var n in r)
							Object.prototype.hasOwnProperty.call(r, n) && (t[n] = r[n]);
					}
					return t;
			  }),
		u.apply(this, arguments)
	);
}
function d(t, e) {
	(t.prototype = Object.create(e.prototype)),
		(t.prototype.constructor = t),
		l(t, e);
}
function l(t, e) {
	return (
		(l = Object.setPrototypeOf
			? Object.setPrototypeOf.bind()
			: function (t, e) {
					return (t.__proto__ = e), t;
			  }),
		l(t, e)
	);
}
var p = /*#__PURE__*/ (function () {
		function t(t, e, r) {
			(this.address = void 0),
				(this.generatorFunctionSelector = void 0),
				(this.generatorFunctionInputAbi = void 0),
				(this.address = t),
				(this.generatorFunctionSelector = e),
				(this.generatorFunctionInputAbi = r);
		}
		return (
			(t.prototype.getFactoryGeneratorFunctionCallData = function (t) {
				var e = c(
					this.generatorFunctionSelector,
					this.generatorFunctionInputAbi,
					t,
				);
				return this.address + e.slice(2);
			}),
			t
		);
	})(),
	h = /*#__PURE__*/ (function (t) {
		function e(e) {
			return (
				void 0 === e && (e = "0xb73Eb505Abc30d0e7e15B73A492863235B3F4309"),
				t.call(this, e, "0x1688f0b9", ["address", "bytes", "uint256"]) || this
			);
		}
		return d(e, t), e;
	})(p),
	f = /*#__PURE__*/ (function (t) {
		function e(e, r, n) {
			var i;
			return (
				void 0 === e && (e = "0x3A0a17Bcc84576b099373ab3Eed9702b07D30402"),
				void 0 === r && (r = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789"),
				void 0 === n && (n = new h()),
				((i =
					t.call(
						this,
						e,
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
						[
							"address",
							"uint256",
							"bytes",
							"uint8",
							"address",
							"address",
							"uint256",
						],
					) || this).entrypointAddress = void 0),
				(i.candideAccountFactory = void 0),
				(i.entrypointAddress = r),
				(i.candideAccountFactory = n),
				i
			);
		}
		d(e, t);
		var r = e.prototype;
		return (
			(r.createNewAccount = function (t, e, r, n) {
				void 0 === e && (e = 1),
					void 0 === r && (r = 0),
					void 0 === n && (n = i);
				var o = this.getInitializerCallData([
					t,
					e,
					i,
					"0x",
					n,
					i,
					0,
					i,
					this.entrypointAddress,
				]);
				return [
					this.getProxyAddress(o, this.candideAccountFactory.address, r),
					this.candideAccountFactory.getFactoryGeneratorFunctionCallData([
						this.singletonAddress,
						o,
						r,
					]),
				];
			}),
			(r.createSendEthCallData = function (t, e) {
				return this.createCallData(t, e, "0x", 0, i, i, 0);
			}),
			(r.createCallData = function (t, e, r, n, i, o, s) {
				return this.getExecutorCallData([t, e, r, n, i, o, s]);
			}),
			e
		);
	})(a),
	y = /*#__PURE__*/ (function () {
		function t(t, e) {
			(this.rpcUrl = void 0),
				(this.entrypointAddress = void 0),
				(this.rpcUrl = t),
				(this.entrypointAddress = e);
		}
		var e = t.prototype;
		return (
			(e.chainId = function () {
				try {
					return Promise.resolve(
						this.sendJsonRpcRequest(this.rpcUrl, "eth_chainId", []),
					).then(function (t) {
						return "result" in t ? { chainId: t.result } : t.error;
					});
				} catch (t) {
					return Promise.reject(t);
				}
			}),
			(e.supportedEntryPoints = function () {
				try {
					return Promise.resolve(
						this.sendJsonRpcRequest(
							this.rpcUrl,
							"eth_supportedEntryPoints",
							[],
						),
					).then(function (t) {
						return "result" in t ? { supportedEntryPoints: t.result } : t.error;
					});
				} catch (t) {
					return Promise.reject(t);
				}
			}),
			(e.estimateUserOperationGas = function (t) {
				try {
					var e = this;
					return Promise.resolve(
						e.sendJsonRpcRequest(e.rpcUrl, "eth_estimateUserOperationGas", [
							t,
							e.entrypointAddress,
						]),
					).then(function (t) {
						return "result" in t ? t.result : t.error;
					});
				} catch (t) {
					return Promise.reject(t);
				}
			}),
			(e.sendUserOperation = function (t) {
				try {
					var e = this;
					return Promise.resolve(
						e.sendJsonRpcRequest(e.rpcUrl, "eth_sendUserOperation", [
							t,
							e.entrypointAddress,
						]),
					).then(function (t) {
						return "result" in t ? { userOperationHash: t.result } : t.error;
					});
				} catch (t) {
					return Promise.reject(t);
				}
			}),
			(e.getUserOperationReceipt = function (t) {
				try {
					return Promise.resolve(
						this.sendJsonRpcRequest(
							this.rpcUrl,
							"eth_getUserOperationReceipt",
							[t],
						),
					).then(function (t) {
						if ("result" in t) {
							var e = t.result,
								r = u({}, e.receipt, { logs: JSON.stringify(e.receipt.logs) });
							return u({}, e, { logs: JSON.stringify(e.logs), receipt: r });
						}
						return t.error;
					});
				} catch (t) {
					return Promise.reject(t);
				}
			}),
			(e.getUserOperationByHash = function (t) {
				try {
					return Promise.resolve(
						this.sendJsonRpcRequest(this.rpcUrl, "eth_getUserOperationByHash", [
							t,
						]),
					).then(function (t) {
						return "result" in t ? t.result : t.error;
					});
				} catch (t) {
					return Promise.reject(t);
				}
			}),
			(e.sendJsonRpcRequest = function (t, e, r) {
				try {
					var n = o.default || o,
						i = JSON.stringify({ method: e, params: r, id: 1, jsonrpc: "2.0" });
					return Promise.resolve(
						n(t, {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: i,
							redirect: "follow",
						}),
					).then(function (t) {
						return Promise.resolve(t.text()).then(JSON.parse);
					});
				} catch (t) {
					return Promise.reject(t);
				}
			}),
			t
		);
	})(),
	b = {
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
	},
	v = {
		__proto__: null,
		SmartAccount: a,
		CandideAccount: f,
		SmartAccountFactory: p,
		CandideAccountFactory: h,
		Bundler: y,
		getUserOperationHash: s,
		UserOperationEmptyValues: b,
	};
export {
	y as Bundler,
	f as CandideAccount,
	h as CandideAccountFactory,
	a as SmartAccount,
	p as SmartAccountFactory,
	b as UserOperationEmptyValues,
	v as abstractionkit,
	s as getUserOperationHash,
};
