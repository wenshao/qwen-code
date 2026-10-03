// Process-local DNS override: the four hardcoded QQ hosts resolve to the
// harness's loopback address. Everything else (TLS, SNI, hostname
// verification against the harness CA) runs unmodified.
'use strict';
const dns = require('node:dns');
const SPOOF_IP = process.env.QQ_SPOOF_IP || '127.13.250.1';
const HOSTS = new Set([
  'bots.qq.com',
  'api.sgroup.qq.com',
  'sandbox.api.sgroup.qq.com',
  'multimedia.nt.qq.com.cn',
]);
const origLookup = dns.lookup;
dns.lookup = function patchedLookup(hostname, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  if (typeof options === 'number') options = { family: options };
  if (HOSTS.has(String(hostname).toLowerCase())) {
    if (options && options.all) {
      return process.nextTick(callback, null, [{ address: SPOOF_IP, family: 4 }]);
    }
    return process.nextTick(callback, null, SPOOF_IP, 4);
  }
  return origLookup.call(dns, hostname, options, callback);
};
const origPromisesLookup = dns.promises.lookup;
dns.promises.lookup = async function patchedPromisesLookup(hostname, options) {
  if (HOSTS.has(String(hostname).toLowerCase())) {
    if (options && options.all) return [{ address: SPOOF_IP, family: 4 }];
    return { address: SPOOF_IP, family: 4 };
  }
  return origPromisesLookup.call(dns.promises, hostname, options);
};
