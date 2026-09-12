// Runs inside the web terminal. Emits ONE query between two visible markers,
// swallows whatever reply arrives for 1.5 s (raw mode, so nothing leaks into
// readline), logs the reply bytes, prints the count, and exits.
// usage: node decrqm-emit.cjs <logfile> <da1|decrqm>
const fs = require('node:fs');
const [log, which] = process.argv.slice(2);
const query = which === 'decrqm' ? '\x1b[?2026$p' : '\x1b[c';
const got = [];
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.on('data', (b) => got.push(b));
process.stdout.write(`BEFORE-${which.toUpperCase()}\r\n`);
process.stdout.write(query);
process.stdout.write(`AFTER-${which.toUpperCase()}-IN-SAME-WRITE\r\n`);
setTimeout(() => {
  const buf = Buffer.concat(got);
  fs.appendFileSync(log, JSON.stringify({ t: Date.now(), which, replyHex: buf.toString('hex'), replyBytes: buf.length }) + '\n');
  process.stdout.write(`REPLY-BYTES-${which.toUpperCase()}=${buf.length}\r\n`);
  process.exit(0);
}, 1500);
