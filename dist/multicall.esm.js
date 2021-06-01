import { id } from 'ethers/utils/hash';
import invariant from 'invariant';
import fetch from 'cross-fetch';
import { defaultAbiCoder } from 'ethers/utils/abi-coder';
import debug from 'debug';
import memoize from 'lodash/memoize';
import _extends from '@babel/runtime/helpers/esm/extends';
import WebSocket from 'isomorphic-ws';
import safeStringify from 'fast-safe-stringify';

var log = debug('multicall'); // Function signature for: aggregate((address,bytes)[])

var AGGREGATE_SELECTOR = '0x252dba42';
function strip0x(str) {
  return str.replace(/^0x/, '');
}
function encodeParameters(types, vals) {
  return defaultAbiCoder.encode(types, vals);
}
function decodeParameters(types, vals) {
  return defaultAbiCoder.decode(types, '0x' + vals.replace(/0x/i, ''));
}
function isEmpty(obj) {
  if (Array.isArray(obj)) return obj.length === 0;
  return !obj || Object.keys(obj).length === 0;
}
async function ethCall(rawData, _ref) {
  var id = _ref.id,
      web3 = _ref.web3,
      rpcUrl = _ref.rpcUrl,
      block = _ref.block,
      multicallAddress = _ref.multicallAddress,
      ws = _ref.ws,
      wsResponseTimeout = _ref.wsResponseTimeout;
  var abiEncodedData = AGGREGATE_SELECTOR + strip0x(rawData);

  if (ws) {
    log('Sending via WebSocket');
    return new Promise(function (resolve, reject) {
      ws.send(JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_call',
        params: [{
          to: multicallAddress,
          data: abiEncodedData
        }, block || 'latest'],
        id: id
      }));

      function onMessage(data) {
        if (typeof data !== 'string') data = data.data;
        var json = JSON.parse(data);
        if (!json.id || json.id !== id) return;
        log('Got WebSocket response id #%d', json.id);
        clearTimeout(timeoutHandle);
        ws.onmessage = null;
        resolve(json.result);
      }

      var timeoutHandle = setTimeout(function () {
        if (ws.onmessage !== onMessage) return;
        ws.onmessage = null;
        reject(new Error('WebSocket response timeout'));
      }, wsResponseTimeout);
      ws.onmessage = onMessage;
    });
  } else if (web3) {
    log('Sending via web3 provider');
    return web3.eth.call({
      to: multicallAddress,
      data: abiEncodedData
    });
  } else {
    log('Sending via XHR fetch');
    var rawResponse = await fetch(rpcUrl, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_call',
        params: [{
          to: multicallAddress,
          data: abiEncodedData
        }, block || 'latest'],
        id: 1
      })
    });
    var content = await rawResponse.json();

    if (!content || !content.result) {
      throw new Error('Multicall received an empty response. Check your call configuration for errors.');
    }

    return content.result;
  }
}

function _createForOfIteratorHelperLoose(o, allowArrayLike) { var it = typeof Symbol !== "undefined" && o[Symbol.iterator] || o["@@iterator"]; if (it) return (it = it.call(o)).next.bind(it); if (Array.isArray(o) || (it = _unsupportedIterableToArray(o)) || allowArrayLike && o && typeof o.length === "number") { if (it) o = it; var i = 0; return function () { if (i >= o.length) return { done: true }; return { done: false, value: o[i++] }; }; } throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }

function _unsupportedIterableToArray(o, minLen) { if (!o) return; if (typeof o === "string") return _arrayLikeToArray(o, minLen); var n = Object.prototype.toString.call(o).slice(8, -1); if (n === "Object" && o.constructor) n = o.constructor.name; if (n === "Map" || n === "Set") return Array.from(o); if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _arrayLikeToArray(o, minLen); }

function _arrayLikeToArray(arr, len) { if (len == null || len > arr.length) len = arr.length; for (var i = 0, arr2 = new Array(len); i < len; i++) { arr2[i] = arr[i]; } return arr2; }
var INSIDE_EVERY_PARENTHESES = /\(.*?\)/g;
var FIRST_CLOSING_PARENTHESES = /^[^)]*\)/;
function _makeMulticallData(calls) {
  var values = [calls.map(function (_ref) {
    var target = _ref.target,
        method = _ref.method,
        args = _ref.args,
        returnTypes = _ref.returnTypes;
    return [target, id(method).substr(0, 10) + (args && args.length > 0 ? strip0x(encodeParameters(args.map(function (a) {
      return a[1];
    }), args.map(function (a) {
      return a[0];
    }))) : '')];
  })];
  var calldata = encodeParameters([{
    components: [{
      type: 'address'
    }, {
      type: 'bytes'
    }],
    name: 'data',
    type: 'tuple[]'
  }], values);
  return calldata;
}
var makeMulticallData = memoize(_makeMulticallData, function () {
  for (var _len = arguments.length, args = new Array(_len), _key = 0; _key < _len; _key++) {
    args[_key] = arguments[_key];
  }

  return JSON.stringify(args);
});
async function aggregate(calls, config) {
  calls = Array.isArray(calls) ? calls : [calls];
  var keyToArgMap = calls.reduce(function (acc, _ref2) {
    var call = _ref2.call,
        returns = _ref2.returns;
    var args = call.slice(1);

    if (args.length > 0) {
      for (var _iterator = _createForOfIteratorHelperLoose(returns), _step; !(_step = _iterator()).done;) {
        var returnMeta = _step.value;
        var key = returnMeta[0];
        acc[key] = args;
      }
    }

    return acc;
  }, {});
  calls = calls.map(function (_ref3) {
    var call = _ref3.call,
        target = _ref3.target,
        returns = _ref3.returns;
    if (!target) target = config.multicallAddress;
    var method = call[0],
        argValues = call.slice(1);

    var _method$match$map = method.match(INSIDE_EVERY_PARENTHESES).map(function (match) {
      return match.slice(1, -1);
    }),
        argTypesString = _method$match$map[0],
        returnTypesString = _method$match$map[1];

    var argTypes = argTypesString.split(',').filter(function (e) {
      return !!e;
    });
    invariant(argTypes.length === argValues.length, "Every method argument must have exactly one type.\n          Comparing argument types " + JSON.stringify(argTypes) + "\n          to argument values " + JSON.stringify(argValues) + ".\n        ");
    var args = argValues.map(function (argValue, idx) {
      return [argValue, argTypes[idx]];
    });
    var returnTypes = !!returnTypesString ? returnTypesString.split(',') : [];
    return {
      method: method.match(FIRST_CLOSING_PARENTHESES)[0],
      args: args,
      returnTypes: returnTypes,
      target: target,
      returns: returns
    };
  });
  var callDataBytes = makeMulticallData(calls, false);
  var outerResults = await ethCall(callDataBytes, config);
  var returnTypeArray = calls.map(function (_ref4) {
    var returnTypes = _ref4.returnTypes;
    return returnTypes;
  }).reduce(function (acc, ele) {
    return acc.concat(ele);
  }, []);
  var returnDataMeta = calls.map(function (_ref5) {
    var returns = _ref5.returns;
    return returns;
  }).reduce(function (acc, ele) {
    return acc.concat(ele);
  }, []);
  invariant(returnTypeArray.length === returnDataMeta.length, 'Missing data needed to parse results');
  var outerResultsDecoded = decodeParameters(['uint256', 'bytes[]'], outerResults);
  var blockNumber = outerResultsDecoded.shift();
  var parsedVals = outerResultsDecoded.reduce(function (acc, r) {
    r.forEach(function (results, idx) {
      var types = calls[idx].returnTypes;
      var resultsDecoded = decodeParameters(types, results);
      acc.push.apply(acc, resultsDecoded.map(function (r, idx) {
        if (types[idx] === 'bool') return r.toString() === 'true';
        return r;
      }));
    });
    return acc;
  }, []);
  var retObj = {
    blockNumber: blockNumber,
    original: {},
    transformed: {}
  };

  for (var i = 0; i < parsedVals.length; i++) {
    var _returnDataMeta$i = returnDataMeta[i],
        name = _returnDataMeta$i[0],
        transform = _returnDataMeta$i[1];
    retObj.original[name] = parsedVals[i];
    retObj.transformed[name] = transform !== undefined ? transform(parsedVals[i]) : parsedVals[i];
  }

  return {
    results: retObj,
    keyToArgMap: keyToArgMap
  };
}

var mainnet = {
	multicall: "0xeefba1e63905ef1d7acba5a8513c70307c1ce441",
	rpcUrl: "https://mainnet.infura.io"
};
var kovan = {
	multicall: "0x2cc8688c5f75e365aaeeb4ea8d6a480405a48d2a",
	rpcUrl: "https://kovan.infura.io"
};
var rinkeby = {
	multicall: "0x42ad527de7d4e9d9d011ac45b31d8551f8fe9821",
	rpcUrl: "https://rinkeby.infura.io"
};
var goerli = {
	multicall: "0x77dca2c955b15e9de4dbbcf1246b4b85b651e50e",
	rpcUrl: "https://rpc.slock.it/goerli"
};
var xdai = {
	multicall: "0xb5b692a88bdfc81ca69dcb1d924f59f0413a602a",
	rpcUrl: "https://dai.poa.network"
};
var addresses = {
	mainnet: mainnet,
	kovan: kovan,
	rinkeby: rinkeby,
	goerli: goerli,
	xdai: xdai
};

var log$1 = debug('multicall');
var reWsEndpoint = /^wss?:\/\//i;

function isNewState(type, value, store) {
  return store[type] === undefined || (value !== null && store[type] !== null && typeof value === 'object' && typeof value.toString === 'function' && typeof store[type] === 'object' && typeof store[type].toString === 'function' ? value.toString() !== store[type].toString() : value !== store[type]);
}

function prepareConfig(config) {
  config = _extends({
    interval: 1000,
    staleBlockRetryWait: 3000,
    errorRetryWait: 5000,
    wsResponseTimeout: 5000,
    wsReconnectTimeout: 5000
  }, config);

  if (config.preset !== undefined) {
    if (addresses[config.preset] !== undefined) {
      config.multicallAddress = addresses[config.preset].multicall;
      config.rpcUrl = addresses[config.preset].rpcUrl;
    } else throw new Error("Unknown preset " + config.preset);
  }

  return config;
}

function createWatcher(model, config) {
  var state = {
    model: [].concat(model),
    store: {},
    storeTransformed: {},
    keyToArgMap: {},
    latestPromiseId: 0,
    latestBlockNumber: null,
    id: 0,
    listeners: {
      subscribe: [],
      block: [],
      poll: [],
      error: []
    },
    handler: null,
    wsReconnectHandler: null,
    watching: false,
    config: prepareConfig(config),
    ws: null
  };

  function reconnectWebSocket(timeout) {
    clearTimeout(state.handler);
    state.handler = null;
    clearTimeout(state.wsReconnectHandler);
    state.wsReconnectHandler = setTimeout(function () {
      destroyWebSocket();
      setupWebSocket();
    }, timeout);
  }

  function setupWebSocket() {
    if (reWsEndpoint.test(state.config.rpcUrl)) {
      log$1("Connecting to WebSocket " + state.config.rpcUrl + "...");
      state.ws = new WebSocket(state.config.rpcUrl);

      state.ws.onopen = function () {
        log$1('WebSocket connected');
        if (state.handler) throw new Error('Existing poll setTimeout handler set');

        if (state.watching) {
          _poll.call({
            state: state,
            interval: 0,
            resolveFetchPromise: state.initialFetchResolver
          });
        }
      };

      state.ws.onclose = function (err) {
        log$1('WebSocket closed: %s', safeStringify(err));
        log$1("Reconnecting in " + state.config.wsReconnectTimeout / 1000 + " seconds.");
        reconnectWebSocket(state.config.wsReconnectTimeout);
      };

      state.ws.onerror = function (err) {
        log$1('WebSocket error: %s', safeStringify(err));
        log$1("Reconnecting in " + state.config.wsReconnectTimeout / 1000 + " seconds.");
        reconnectWebSocket(state.config.wsReconnectTimeout);
      };
    }
  }

  function destroyWebSocket() {
    log$1('destroyWebSocket()');
    state.ws.onopen = null;
    state.ws.onclose = null;
    state.ws.onerror = null;
    state.ws.onmessage = null;
    state.ws.close();
  }

  setupWebSocket();
  state.initialFetchPromise = new Promise(function (resolve) {
    state.initialFetchResolver = resolve;
  });

  function _subscribe(listener, id, batch) {
    if (batch === void 0) {
      batch = false;
    }

    if (!isEmpty(state.storeTransformed)) {
      var events = Object.entries(state.storeTransformed).map(function (_ref) {
        var type = _ref[0],
            value = _ref[1];
        return {
          type: type,
          value: value,
          args: state.keyToArgMap[type] || []
        };
      });
      batch ? listener(events) : events.forEach(listener);
    }

    state.listeners.subscribe.push({
      listener: listener,
      id: id,
      batch: batch
    });
  }

  function alertListeners(events) {
    if (!isEmpty(events)) state.listeners.subscribe.forEach(function (_ref2) {
      var listener = _ref2.listener,
          batch = _ref2.batch;
      return batch ? listener(events) : events.forEach(listener);
    });
  }

  function _poll() {
    var _this = this;

    var interval = this.interval !== undefined ? this.interval : this.state.config.interval;
    log$1('poll() called, %s%s', 'interval: ' + interval, this.retry ? ', retry: ' + this.retry : '');
    this.state.handler = setTimeout(async function () {
      try {
        if (!_this.state.handler) return;
        _this.state.latestPromiseId++;
        var promiseId = _this.state.latestPromiseId;
        state.listeners.poll.forEach(function (_ref3) {
          var listener = _ref3.listener;
          return listener(_extends({
            id: promiseId,
            latestBlockNumber: _this.state.latestBlockNumber
          }, _this.retry ? {
            retry: _this.retry
          } : {}));
        });

        var _await$aggregate = await aggregate(_this.state.model, _extends({}, _this.state.config, {
          ws: _this.state.ws,
          id: _this.state.latestPromiseId
        })),
            _await$aggregate$resu = _await$aggregate.results,
            blockNumber = _await$aggregate$resu.blockNumber,
            data = _extends({}, _await$aggregate$resu.original),
            dataTransformed = _extends({}, _await$aggregate$resu.transformed),
            keyToArgMap = _await$aggregate.keyToArgMap;

        if (_this.state.cancelPromiseId === promiseId) return;
        if (typeof _this.resolveFetchPromise === 'function') _this.resolveFetchPromise();

        if (_this.state.latestBlockNumber !== null && blockNumber < _this.state.latestBlockNumber) {
          // Retry if blockNumber is lower than latestBlockNumber
          log$1("Stale block returned, retrying in " + _this.state.config.staleBlockRetryWait / 1000 + " seconds");

          _poll.call({
            state: _this.state,
            interval: _this.state.config.staleBlockRetryWait,
            retry: _this.retry ? _this.retry + 1 : 1
          });
        } else {
          if (_this.state.latestBlockNumber === null || _this.state.latestBlockNumber !== null && blockNumber > _this.state.latestBlockNumber) {
            _this.state.latestBlockNumber = parseInt(blockNumber);
            state.listeners.block.forEach(function (_ref4) {
              var listener = _ref4.listener;
              return listener(_this.state.latestBlockNumber);
            });
          }

          var events = Object.entries(data).filter(function (_ref5) {
            var type = _ref5[0],
                value = _ref5[1];
            return isNewState(type, value, _this.state.store);
          }).map(function (_ref6) {
            var type = _ref6[0];
            return {
              type: type,
              value: dataTransformed[type],
              args: keyToArgMap[type] || []
            };
          });
          _this.state.store = _extends({}, data);
          _this.state.storeTransformed = _extends({}, dataTransformed);
          _this.state.keyToArgMap = _extends({}, keyToArgMap);
          alertListeners(events);

          _poll.call({
            state: _this.state
          });
        }
      } catch (err) {
        log$1('Error: %s', err.message);
        state.listeners.error.forEach(function (_ref7) {
          var listener = _ref7.listener;
          return listener(err, _this.state);
        });
        if (!_this.state.handler) return; // Retry on error

        log$1("Error occured, retrying in " + _this.state.config.errorRetryWait / 1000 + " seconds");

        _poll.call({
          state: _this.state,
          interval: _this.state.config.errorRetryWait,
          retry: _this.retry ? _this.retry + 1 : 1
        });
      }
    }, interval);
  }

  var watcher = {
    tap: function tap(transform) {
      log$1('watcher.tap() called');
      var nextModel = transform([].concat(state.model));
      state.model = [].concat(nextModel);
      return this.poll();
    },
    poll: function poll() {
      log$1('watcher.poll() called');
      var resolveFetchPromise;
      var fetchPromise = new Promise(function (resolve) {
        resolveFetchPromise = resolve;
      });

      if (state.watching && (!state.ws || state.ws.readyState === WebSocket.OPEN)) {
        clearTimeout(state.handler);
        state.handler = null;

        _poll.call({
          state: state,
          interval: 0,
          resolveFetchPromise: resolveFetchPromise
        });

        return fetchPromise;
      }

      return Promise.resolve();
    },
    subscribe: function subscribe(listener) {
      var id = state.id++;

      _subscribe(listener, id, false);

      return {
        unsub: function unsub() {
          state.listeners.subscribe = state.listeners.subscribe.filter(function (_ref8) {
            var _id = _ref8.id;
            return _id !== id;
          });
        }
      };
    },
    batch: function batch() {
      return {
        subscribe: function subscribe(listener) {
          var id = state.id++;

          _subscribe(listener, id, true);

          return {
            unsub: function unsub() {
              state.listeners.subscribe = state.listeners.subscribe.filter(function (_ref9) {
                var _id = _ref9.id;
                return _id !== id;
              });
            }
          };
        }
      };
    },
    onNewBlock: function onNewBlock(listener) {
      var id = state.id++;
      state.latestBlockNumber && listener(state.latestBlockNumber);
      state.listeners.block.push({
        listener: listener,
        id: id
      });
      return {
        unsub: function unsub() {
          state.listeners.block = state.listeners.block.filter(function (_ref10) {
            var _id = _ref10.id;
            return _id !== id;
          });
        }
      };
    },
    onPoll: function onPoll(listener) {
      var id = state.id++;
      state.listeners.poll.push({
        listener: listener,
        id: id
      });
      return {
        unsub: function unsub() {
          state.listeners.poll = state.listeners.poll.filter(function (_ref11) {
            var _id = _ref11.id;
            return _id !== id;
          });
        }
      };
    },
    onError: function onError(listener) {
      var id = state.id++;
      state.listeners.error.push({
        listener: listener,
        id: id
      });
      return {
        unsub: function unsub() {
          state.listeners.error = state.listeners.error.filter(function (_ref12) {
            var _id = _ref12.id;
            return _id !== id;
          });
        }
      };
    },
    start: function start() {
      log$1('watcher.start() called');
      state.watching = true;

      if (!state.ws || state.ws.readyState === WebSocket.OPEN) {
        _poll.call({
          state: state,
          interval: 0,
          resolveFetchPromise: state.initialFetchResolver
        });
      }

      return state.initialFetchPromise;
    },
    stop: function stop() {
      log$1('watcher.stop() called');
      clearTimeout(state.handler);
      state.handler = null;
      clearTimeout(state.wsReconnectHandler);
      state.wsReconnectHandler = null;
      state.watching = false;
    },
    recreate: function recreate(model, config) {
      log$1('watcher.recreate() called');
      clearTimeout(state.handler);
      state.handler = null;
      clearTimeout(state.wsReconnectHandler);
      state.wsReconnectHandler = null;
      if (state.ws) destroyWebSocket();
      state.ws = null;
      state.config = prepareConfig(config);
      state.model = [].concat(model);
      state.store = {};
      state.storeTransformed = {};
      state.latestBlockNumber = null;
      state.cancelPromiseId = state.latestPromiseId;
      setupWebSocket();

      if (state.watching && !state.ws) {
        var resolveFetchPromise;
        var fetchPromise = new Promise(function (resolve) {
          resolveFetchPromise = resolve;
        });

        _poll.call({
          state: state,
          interval: 0,
          resolveFetchPromise: resolveFetchPromise
        });

        return fetchPromise;
      }

      return Promise.resolve();
    },
    awaitInitialFetch: function awaitInitialFetch() {
      return state.initialFetchPromise;
    },

    get initialFetch() {
      return state.initialFetchPromise;
    },

    get schemas() {
      return state.model;
    }

  };
  return watcher;
}

export { aggregate, createWatcher };
//# sourceMappingURL=multicall.esm.js.map
