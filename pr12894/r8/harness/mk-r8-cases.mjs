import fs from 'node:fs';
const R = process.argv[2], N = process.argv[3];
const c = (so, kind, k, code, name) => ({ name, cmd: `${N} ${R}/tailgen.mjs ${so} ${kind} ${k} ${code}`, marker: 'END_MARK', code });
const cases = [
  ...[0, 1, 2].map((k) => c(200000, 'cjk', k, 0, `CJK stdout 200 KB, tail offset ${k}`)),
  ...[0, 1, 2].map((k) => c(200000, 'cjklines', k, 0, `CJK log lines 200 KB, tail offset ${k}`)),
  c(90003, 'cjk', 0, 0, 'CJK stdout 90 KB'),
  ...[0, 1, 2].map((k) => c(200000, 'ansi', k, 0, `ANSI-coloured stdout 200 KB, tail offset ${k}`)),
];
fs.writeFileSync(`${R}/r8-tail-cases.json`, JSON.stringify(cases));
console.log(cases.length);
