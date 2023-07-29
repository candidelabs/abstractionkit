!(function (e, t) {
	"object" == typeof exports && "undefined" != typeof module
		? t(exports, require("ethers"), require("isomorphic-unfetch"))
		: "function" == typeof define && define.amd
		? define(["exports", "ethers", "isomorphic-unfetch"], t)
		: t(((e || self).abstractionkit = {}), e.ethers, e.isomorphicUnfetch);
})(this, function (e, t, r) {
	function n(e) {
		if (e && e.__esModule) return e;
		var t = Object.create(null);
		return (
			e &&
				Object.keys(e).forEach(function (r) {
					if ("default" !== r) {
						var n = Object.getOwnPropertyDescriptor(e, r);
						Object.defineProperty(
							t,
							r,
							n.get
								? n
								: {
										enumerable: !0,
										get: function () {
											return e[r];
										},
								  },
						);
					}
				}),
			(t.default = e),
			t
		);
	}
	var i = /*#__PURE__*/ n(r);
	function o(e, r, n) {
		var i = t.keccak256(
				(function (e) {
					var r = [
						e.sender,
						e.nonce,
						t.keccak256(e.initCode),
						t.keccak256(e.callData),
						e.callGasLimit,
						e.verificationGasLimit,
						e.preVerificationGas,
						e.maxFeePerGas,
						e.maxPriorityFeePerGas,
						t.keccak256(e.paymasterAndData),
					];
					return t.AbiCoder.defaultAbiCoder().encode(
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
						r,
					);
				})(e),
			),
			o = t.AbiCoder.defaultAbiCoder().encode(
				["bytes32", "address", "uint256"],
				[i, r, n],
			);
		return t.keccak256(o);
	}
	function s(e, r, n) {
		return e + t.AbiCoder.defaultAbiCoder().encode(r, n).slice(2);
	}
	var c = /*#__PURE__*/ (function () {
		function e(e, t, r, n, i, o) {
			(this.singletonAddress = void 0),
				(this.proxyByteCode = void 0),
				(this.initializerFunctionSelector = void 0),
				(this.initializerFunctionInputAbi = void 0),
				(this.executorFunctionSelector = void 0),
				(this.executorFunctionInputAbi = void 0),
				(this.singletonAddress = e),
				(this.proxyByteCode = t),
				(this.initializerFunctionSelector = r),
				(this.initializerFunctionInputAbi = n),
				(this.executorFunctionSelector = i),
				(this.executorFunctionInputAbi = o);
		}
		var r = e.prototype;
		return (
			(r.getInitializerCallData = function (e) {
				return s(
					this.initializerFunctionSelector,
					this.initializerFunctionInputAbi,
					e,
				);
			}),
			(r.getExecutorCallData = function (e) {
				return s(
					this.executorFunctionSelector,
					this.executorFunctionInputAbi,
					e,
				);
			}),
			(r.getProxyAddress = function (e, r, n) {
				var i = t.keccak256(
						t.solidityPacked(["bytes32", "uint256"], [t.keccak256(e), n]),
					),
					o = t.keccak256(
						t.solidityPacked(
							["bytes", "uint256"],
							[this.proxyByteCode, this.singletonAddress],
						),
					);
				return (
					"0x" +
					t
						.solidityPackedKeccak256(
							["bytes1", "address", "bytes32", "bytes32"],
							["0xff", r, i, o],
						)
						.slice(-40)
				);
			}),
			e
		);
	})();
	function a() {
		return (
			(a = Object.assign
				? Object.assign.bind()
				: function (e) {
						for (var t = 1; t < arguments.length; t++) {
							var r = arguments[t];
							for (var n in r)
								Object.prototype.hasOwnProperty.call(r, n) && (e[n] = r[n]);
						}
						return e;
				  }),
			a.apply(this, arguments)
		);
	}
	function u(e, t) {
		(e.prototype = Object.create(t.prototype)),
			(e.prototype.constructor = e),
			d(e, t);
	}
	function d(e, t) {
		return (
			(d = Object.setPrototypeOf
				? Object.setPrototypeOf.bind()
				: function (e, t) {
						return (e.__proto__ = t), e;
				  }),
			d(e, t)
		);
	}
	var l = /*#__PURE__*/ (function () {
			function e(e, t, r) {
				(this.address = void 0),
					(this.generatorFunctionSelector = void 0),
					(this.generatorFunctionInputAbi = void 0),
					(this.address = e),
					(this.generatorFunctionSelector = t),
					(this.generatorFunctionInputAbi = r);
			}
			return (
				(e.prototype.getFactoryGeneratorFunctionCallData = function (e) {
					var t = s(
						this.generatorFunctionSelector,
						this.generatorFunctionInputAbi,
						e,
					);
					return this.address + t.slice(2);
				}),
				e
			);
		})(),
		f = /*#__PURE__*/ (function (e) {
			function t(t) {
				return (
					void 0 === t && (t = "0xb73Eb505Abc30d0e7e15B73A492863235B3F4309"),
					e.call(this, t, "0x1688f0b9", ["address", "bytes", "uint256"]) || this
				);
			}
			return u(t, e), t;
		})(l),
		p = /*#__PURE__*/ (function (e) {
			function r(t, r, n) {
				var i;
				return (
					void 0 === t && (t = "0x3A0a17Bcc84576b099373ab3Eed9702b07D30402"),
					void 0 === r && (r = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789"),
					void 0 === n && (n = new f()),
					((i =
						e.call(
							this,
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
			u(r, e);
			var n = r.prototype;
			return (
				(n.createNewAccount = function (e, r, n, i) {
					void 0 === r && (r = 1),
						void 0 === n && (n = 0),
						void 0 === i && (i = t.ZeroAddress);
					var o = this.getInitializerCallData([
						e,
						r,
						t.ZeroAddress,
						"0x",
						i,
						t.ZeroAddress,
						0,
						t.ZeroAddress,
						this.entrypointAddress,
					]);
					return [
						this.getProxyAddress(o, this.candideAccountFactory.address, n),
						this.candideAccountFactory.getFactoryGeneratorFunctionCallData([
							this.singletonAddress,
							o,
							n,
						]),
					];
				}),
				(n.createSendEthCallData = function (e, r) {
					return this.createCallData(
						e,
						r,
						"0x",
						0,
						t.ZeroAddress,
						t.ZeroAddress,
						0,
					);
				}),
				(n.createCallData = function (e, t, r, n, i, o, s) {
					return this.getExecutorCallData([e, t, r, n, i, o, s]);
				}),
				r
			);
		})(c),
		h = /*#__PURE__*/ (function () {
			function e(e, t) {
				(this.rpcUrl = void 0),
					(this.entrypointAddress = void 0),
					(this.rpcUrl = e),
					(this.entrypointAddress = t);
			}
			var t = e.prototype;
			return (
				(t.chainId = function () {
					try {
						return Promise.resolve(
							this.sendJsonRpcRequest(this.rpcUrl, "eth_chainId", []),
						).then(function (e) {
							return "result" in e ? { chainId: e.result } : e.error;
						});
					} catch (e) {
						return Promise.reject(e);
					}
				}),
				(t.supportedEntryPoints = function () {
					try {
						return Promise.resolve(
							this.sendJsonRpcRequest(
								this.rpcUrl,
								"eth_supportedEntryPoints",
								[],
							),
						).then(function (e) {
							return "result" in e
								? { supportedEntryPoints: e.result }
								: e.error;
						});
					} catch (e) {
						return Promise.reject(e);
					}
				}),
				(t.estimateUserOperationGas = function (e) {
					try {
						var t = this;
						return Promise.resolve(
							t.sendJsonRpcRequest(t.rpcUrl, "eth_estimateUserOperationGas", [
								e,
								t.entrypointAddress,
							]),
						).then(function (e) {
							return "result" in e ? e.result : e.error;
						});
					} catch (e) {
						return Promise.reject(e);
					}
				}),
				(t.sendUserOperation = function (e) {
					try {
						var t = this;
						return Promise.resolve(
							t.sendJsonRpcRequest(t.rpcUrl, "eth_sendUserOperation", [
								e,
								t.entrypointAddress,
							]),
						).then(function (e) {
							return "result" in e ? { userOperationHash: e.result } : e.error;
						});
					} catch (e) {
						return Promise.reject(e);
					}
				}),
				(t.getUserOperationReceipt = function (e) {
					try {
						return Promise.resolve(
							this.sendJsonRpcRequest(
								this.rpcUrl,
								"eth_getUserOperationReceipt",
								[e],
							),
						).then(function (e) {
							if ("result" in e) {
								var t = e.result,
									r = a({}, t.receipt, {
										logs: JSON.stringify(t.receipt.logs),
									});
								return a({}, t, { logs: JSON.stringify(t.logs), receipt: r });
							}
							return e.error;
						});
					} catch (e) {
						return Promise.reject(e);
					}
				}),
				(t.getUserOperationByHash = function (e) {
					try {
						return Promise.resolve(
							this.sendJsonRpcRequest(
								this.rpcUrl,
								"eth_getUserOperationByHash",
								[e],
							),
						).then(function (e) {
							return "result" in e ? e.result : e.error;
						});
					} catch (e) {
						return Promise.reject(e);
					}
				}),
				(t.sendJsonRpcRequest = function (e, t, r) {
					try {
						var n = i.default || i,
							o = JSON.stringify({
								method: t,
								params: r,
								id: 1,
								jsonrpc: "2.0",
							});
						return Promise.resolve(
							n(e, {
								method: "POST",
								headers: { "Content-Type": "application/json" },
								body: o,
								redirect: "follow",
							}),
						).then(function (e) {
							return Promise.resolve(e.text()).then(JSON.parse);
						});
					} catch (e) {
						return Promise.reject(e);
					}
				}),
				e
			);
		})(),
		y = {
			sender: t.ZeroAddress,
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
		b = {
			__proto__: null,
			SmartAccount: c,
			CandideAccount: p,
			SmartAccountFactory: l,
			CandideAccountFactory: f,
			Bundler: h,
			getUserOperationHash: o,
			UserOperationEmptyValues: y,
		};
	(e.Bundler = h),
		(e.CandideAccount = p),
		(e.CandideAccountFactory = f),
		(e.SmartAccount = c),
		(e.SmartAccountFactory = l),
		(e.UserOperationEmptyValues = y),
		(e.abstractionkit = b),
		(e.getUserOperationHash = o);
});
