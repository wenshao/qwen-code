// Real CLI: --to-anchors hard-linked to --out. Guard must refuse; if it
// admits the alias, the anchors write + artifact write hit one file.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const [cli, dir, label] = process.argv.slice(2);
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
const input = path.join(dir, 'in.json');
fs.writeFileSync(input, JSON.stringify([{ id: 'f1', severity: 'Critical', summary: 'The retry counter is never reset, so the third attempt is refused.', failureScenario: 'A request that fails twice then succeeds leaves attempts at 2; the next request starts at 2.', file: 'src/retry.ts', line: 42, anchor: 'attempts += 1' }]));
const out = path.join(dir, 'findings.json');
const anchors = path.join(dir, 'anchors.json');
fs.writeFileSync(out, 'PREVIOUS-RUN-ARTIFACT\n');
fs.linkSync(out, anchors);
const b = fs.statSync(out, { bigint: true }), n = fs.statSync(out);
const r = spawnSync(process.execPath, [cli, 'review', 'findings', '--input', input, '--out', out, '--to-anchors', anchors], { encoding: 'utf8', env: { ...process.env, HOME: path.join(dir, 'home'), USERPROFILE: path.join(dir, 'home') } });
const res = { label, dir, exit: r.status, inoBig: String(b.ino), inoNumber: n.ino, numberSafe: Number.isSafeInteger(n.ino), nlink: Number(b.nlink),
  refused: /points at the same file/.test(r.stderr), anchorsHead: fs.readFileSync(anchors, 'utf8').slice(0, 40), outHead: fs.readFileSync(out, 'utf8').slice(0, 40), stderrTail: r.stderr.trim().split('\n').slice(-2).join(' | ').slice(0, 300) };
console.log('PROBE_JSON ' + JSON.stringify(res));
