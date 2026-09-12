// recorder2 + `--flood-kind cjk`: the filler is SGR-coloured wide CJK text, which
// xterm parses far slower than ASCII. Used only to make the browser's snapshot
// restoration last long enough to type into (and interrupt) deterministically.
//
// usage: node recorder3.cjs <logfile> [--flood <chars>] [--flood-kind cjk] [--every <ms>]
const fs = require('node:fs');

const log = process.argv[2];
const argv = process.argv.slice(3);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const flood = flag('--flood') ? Number(flag('--flood')) : undefined;
const floodKind = flag('--flood-kind') ?? 'ascii';
const every = flag('--every') ? Number(flag('--every')) : undefined;

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

append({ kind: 'start', pid: process.pid, flood: flood ?? 0, floodKind, every: every ?? 0 });
if (flood) {
  let out = 0;
  let row = 0;
  while (out < flood) {
    const s =
      floodKind === 'cjk'
        ? `\x1b[3${(row % 7) + 1};1m${String(row).padStart(7, '0')}\x1b[0m 终端回放验证第${row}行：中文宽字符与颜色 \x1b[4m下划线\x1b[0m\r\n`
        : `${String(row).padStart(7, '0')} ${'filler '.repeat(11)}\r\n`;
    row++;
    process.stdout.write(s);
    out += s.length;
  }
}
emitBatch('start');
if (every) setInterval(() => emitBatch('timer'), every);
