// Preloaded into the daemon only: sends the Live provider socket for dashscope.aliyuncs.com to the
// local fake realtime server instead of the Internet.
import tls from 'node:tls';
const port = Number(process.env.FAKE_REALTIME_PORT || 18443);
const orig = tls.connect;
tls.connect = function (...args) {
  const o = args.find((a) => a && typeof a === 'object');
  const host = o?.host || o?.servername;
  if (o && typeof host === 'string' && /(^|\.)dashscope\.aliyuncs\.com$/i.test(host)) {
    o.host = '127.0.0.1'; o.port = port; o.rejectUnauthorized = false;
    process.stderr.write(`[redirect] ${host} -> 127.0.0.1:${port}\n`);
  }
  return orig.apply(this, args);
};
