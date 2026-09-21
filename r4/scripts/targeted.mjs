// usage: node targeted.mjs <arm-root>  — mutants aimed at the two lines 32035a1 changed
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.argv[2];
const core = path.join(root, 'packages/core');
const dir = path.join(core, 'src/managed-runtime');
const prod = fs.readFileSync(path.join(dir, 'managed-session-records.ts'), 'utf8');
const test = fs.readFileSync(path.join(dir, 'managed-session-records.test.ts'), 'utf8');
const D = "assertJsonValue(events, 'events', new Set<object>(), 0);";
const T = "assertJsonValue(events, 'transaction.events', new Set<object>(), 0);";
for (const needle of [D, T]) if (prod.split(needle).length !== 2) throw new Error('site not found: ' + needle);
const MUTANTS = [
  ['t0', 'control (unmutated)', (s) => s],
  ['t1', 'digest: container charged a level again (revert to bf1a6b1)', (s) => s.replace(D, "assertJsonValue(events, 'events');")],
  ['t2', 'transaction: container charged a level again (revert to bf1a6b1)', (s) => s.replace(T, "assertJsonValue(events, 'transaction.events');")],
  ['t3', 'digest: start at -1 (would admit depth 65)', (s) => s.replace(D, D.replace(', 0);', ', -1);'))],
  ['t4', 'transaction: start at -1 (would admit depth 65)', (s) => s.replace(T, T.replace(', 0);', ', -1);'))],
  ['t5', 'digest: empty-list guard deleted', (s) => s.replace("return fail('transaction identity must contain at least one event.');", 'void 0;')],
];
const mutRoot = path.join(dir, '__mut__');
fs.rmSync(mutRoot, { recursive: true, force: true });
for (const [id, , f] of MUTANTS) {
  const out = f(prod);
  if (id !== 't0' && out === prod) throw new Error('mutant did not apply: ' + id);
  fs.mkdirSync(path.join(mutRoot, id), { recursive: true });
  fs.writeFileSync(path.join(mutRoot, id, 'managed-session-records.ts'), out.replaceAll("'../utils/", "'../../../utils/"));
  fs.writeFileSync(path.join(mutRoot, id, 'managed-session-records.test.ts'), test);
}
const outFile = path.join(here, 'targeted-vitest.json');
spawnSync('npx', ['vitest', 'run', 'src/managed-runtime/__mut__', '--reporter=json', `--outputFile=${outFile}`], { cwd: core, env: { ...process.env, CI: 'true' }, encoding: 'utf8' });
fs.rmSync(mutRoot, { recursive: true, force: true });
const clean = execFileSync('git', ['status', '--porcelain', '--', 'packages/core/src'], { cwd: root, encoding: 'utf8' }).trim() === '';
const report = JSON.parse(fs.readFileSync(outFile, 'utf8'));
const rows = MUTANTS.map(([id, label]) => {
  const file = report.testResults.find((r) => r.name.includes(`/__mut__/${id}/`));
  const failed = file.assertionResults.filter((a) => a.status === 'failed');
  return { id, label, total: file.assertionResults.length, failed: failed.length, by: failed.map((a) => a.title) };
});
fs.writeFileSync(path.join(here, 'targeted.json'), JSON.stringify({ clean, rows }, null, 1));
for (const r of rows) console.log(r.id, r.failed === 0 ? (r.id === 't0' ? 'GREEN   ' : 'SURVIVED') : 'KILLED  ', `${r.total - r.failed}/${r.total}`, r.label, r.by.length ? `← ${r.by.join(' | ')}` : '');
console.log('tree clean after:', clean);
