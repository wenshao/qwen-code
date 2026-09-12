// Runs INSIDE the real web-terminal PTY. It is the oracle: every byte that
// reaches this program's stdin (i.e. the live shell's stdin) is appended to a
// JSONL log with a timestamp.
//
// Round-2 corpus: DECRQM is deliberately NOT emitted here — the built Web Shell's
// xterm throws on it and freezes the terminal (measured separately in the
// `decrqm` scenario), which would contaminate every later measurement.
//
// usage: node recorder2.cjs <logfile> [--flood <bytes>] [--every <ms>]
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

// Six families the browser's xterm 6.0.0 answers.
const QUERIES = [
  ['DA1', '\x1b[c'],
  ['DA2', '\x1b[>c'],
  ['CPR', '\x1b[6n'],
  ['OSC11', '\x1b]11;?\x07'],
  ['OSC12', '\x1b]12;?\x07'],
  ['OSC4', '\x1b]4;1;?\x07'],
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
  if (buf.length === 1 && buf[0] === 0x71 /* q */) {
    append({ kind: 'quit' });
    process.stdout.write('\r\n[recorder] bye\r\n');
    process.exit(0);
  }
  if (buf.length === 1 && buf[0] === 0x62 /* b */) emitBatch('key');
});

append({ kind: 'start', pid: process.pid, flood: flood ?? 0, every: every ?? 0 });
if (flood) {
  const line = 'filler '.repeat(11) + '\r\n';
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
