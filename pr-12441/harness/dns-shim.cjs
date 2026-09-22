// Resolve ONLY the fake DashScope host to loopback; every other lookup is untouched.
const dns = require('dns');
const HOST = 'fake-live.dashscope.aliyuncs.com';
const orig = dns.lookup;
dns.lookup = function (hostname, options, cb) {
  if (hostname === HOST) {
    if (typeof options === 'function') { cb = options; options = {}; }
    if (typeof options === 'number') options = { family: options };
    if (options && options.all) return process.nextTick(cb, null, [{ address: '127.0.0.1', family: 4 }]);
    return process.nextTick(cb, null, '127.0.0.1', 4);
  }
  return orig.apply(this, arguments);
};
const origP = dns.promises.lookup;
dns.promises.lookup = async function (hostname, options) {
  if (hostname === HOST) return options && options.all ? [{ address: '127.0.0.1', family: 4 }] : { address: '127.0.0.1', family: 4 };
  return origP.apply(this, arguments);
};
