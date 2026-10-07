// --require preload: re-point the TCP endpoint of TLS connections whose
// SNI/servername is a hardcoded QQ host to the local fake platform.
// TLS itself is untouched: the handshake keeps the original servername,
// so SNI and hostname verification still run against the harness CA cert.
// (Round 3 ran as root on Linux with a loopback alias on :443 + DNS override;
// macOS runs unprivileged, so the fake listens on QQ_FAKE_PORT and we
// redirect at the TLS connect seam instead.)
'use strict';
const tls = require('node:tls');
const net = require('node:net');

const FAKE_PORT = Number(process.env.QQ_FAKE_PORT || 18444);
const HOSTS = new Set([
  'bots.qq.com',
  'api.sgroup.qq.com',
  'sandbox.api.sgroup.qq.com',
  'multimedia.nt.qq.com.cn',
  'gateway.qq.com',
]);

function redirectArgs(args) {
  const opts = args[0];
  if (opts == null || typeof opts !== 'object') return args;
  const host = opts.servername || opts.host;
  if (typeof host !== 'string') return args;
  const name = host.toLowerCase();
  if (!HOSTS.has(name)) return args;
  const next = Object.assign({}, opts, {
    host: '127.0.0.1',
    port: FAKE_PORT,
    servername: name,
  });
  return [next, ...args.slice(1)];
}

const origTlsConnect = tls.connect;
tls.connect = function patchedTlsConnect(...args) {
  return origTlsConnect.apply(this, redirectArgs(args));
};

const origNetConnect = net.connect;
net.connect = function patchedNetConnect(...args) {
  return origNetConnect.apply(this, redirectArgs(args));
};
net.Socket.prototype.connect = new Proxy(net.Socket.prototype.connect, {
  apply(target, thisArg, args) {
    return Reflect.apply(target, thisArg, redirectArgs(args));
  },
});
