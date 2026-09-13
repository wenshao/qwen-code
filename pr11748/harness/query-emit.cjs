// Runs INSIDE the web terminal. Emits one terminal query between two visible
// markers in a single write, collects whatever reply reaches this program's
// stdin for 1.5 s (raw mode, so nothing leaks into readline), appends the reply
// bytes to <logfile>, prints the count and exits.
// usage: node query-emit.cjs <logfile> <da1|decrqm-private|decrqm-ansi|decrqm-2004>
const fs = require('node:fs');

const [log, which] = process.argv.slice(2);
const QUERIES = {
  da1: '\x1b[c',
  'decrqm-private': '\x1b[?2026$p',
  'decrqm-ansi': '\x1b[4$p',
  'decrqm-2004': '\x1b[?2004$p',
};
const query = QUERIES[which];
if (!query) throw new Error(`unknown query ${which}`);
const tag = which.toUpperCase();
const got = [];
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.on('data', (b) => got.push(b));
process.stdout.write(`BEFORE-${tag} ${query}AFTER-${tag}-SAME-WRITE\r\n`);
setTimeout(() => {
  const buf = Buffer.concat(got);
  fs.appendFileSync(
    log,
    JSON.stringify({ t: Date.now(), which, replyHex: buf.toString('hex'), replyText: JSON.stringify(buf.toString('latin1')), replyBytes: buf.length }) + '\n',
  );
  process.stdout.write(`REPLY-BYTES-${tag}=${buf.length}\r\n`);
  process.exit(0);
}, 1500);
