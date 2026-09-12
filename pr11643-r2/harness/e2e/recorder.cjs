// Runs INSIDE the real web-terminal PTY. It is the oracle: every byte that
// reaches this program's stdin (i.e. the live shell's stdin) is appended to a
// JSONL log with a timestamp and the phase label active at the time.
//
// usage: node recorder.cjs <logfile> [--flood <bytes>] [--every <ms>]
//   Emits one query batch at start (batch 0). With --every, emits a numbered
//   batch every <ms>. With --flood, first prints <bytes> of filler so the
//   reconnect snapshot is large and restoration takes measurable time.
//   Keys: 'q' quits, 'b' emits a batch now. Everything else is only logged.
const fs = require('node:fs');

const log = process.argv[2];
const argv = process.argv.slice(3);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? Number(argv[i + 1]) : undefined;
};
const flood = flag('--flood');
const every = flag('--every');

// The corpus: one probe per family that either end answers.
const QUERIES = [
  ['DA1', '\x1b[c'],
  ['DA2', '\x1b[>c'],
  ['CPR', '\x1b[6n'],
  ['DECRQM', '\x1b[?2026$p'],
  ['OSC11', '\x1b]11;?\x07'],
  ['OSC12', '\x1b]12;?\x07'],
  ['OSC4', '\x1b]4;1;?\x07'],
  ['XTVERSION', '\x1b[>0q'],
];

let batch = 0;
const append = (rec) =>
  fs.appendFileSync(log, JSON.stringify({ t: Date.now(), ...rec }) + '\n');

function emitBatch(label) {
  const n = batch++;
  append({ kind: 'emit', batch: n, label });
  process.stdout.write(`\r\n[recorder] batch ${n} (${label}) `);
  for (const [, seq] of QUERIES) process.stdout.write(seq);
  process.stdout.write('\r\n');
}

if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.on('data', (buf) => {
  append({ kind: 'stdin', hex: buf.toString('hex'), text: JSON.stringify(buf.toString('latin1')) });
  if (buf.includes(0x71 /* q */) && buf.length === 1) {
    append({ kind: 'quit' });
    process.stdout.write('\r\n[recorder] bye\r\n');
    process.exit(0);
  }
  if (buf.length === 1 && buf[0] === 0x62 /* b */) emitBatch('key');
});

append({ kind: 'start', pid: process.pid, flood: flood ?? 0, every: every ?? 0 });
if (flood) {
  const line = 'filler '.repeat(11) + '\r\n'; // 79 cols + CRLF
  let out = 0;
  let row = 0;
  while (out < flood) {
    const s = `${String(row++).padStart(7, '0')} ${line}`;
    process.stdout.write(s);
    out += s.length;
  }
}
emitBatch('start');
if (every) setInterval(() => emitBatch('timer'), every);
