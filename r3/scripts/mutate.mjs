// usage: node mutate.mjs <arm-root> <label>
// Guard-deletion sweep: one mutant per `fail(` call site in
// managed-session-records.ts. Mutants live in an untracked __mut__ directory
// next to the source, each with its own copy of the PR's test file, so the
// tracked files are never edited and one vitest run covers them all.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const [root, label] = process.argv.slice(2);
const core = path.join(root, 'packages/core');
const srcDir = path.join(core, 'src/managed-runtime');
const prod = fs.readFileSync(path.join(srcDir, 'managed-session-records.ts'), 'utf8');
const test = fs.readFileSync(path.join(srcDir, 'managed-session-records.test.ts'), 'utf8');
const mutRoot = path.join(srcDir, '__mut__');
fs.rmSync(mutRoot, { recursive: true, force: true });

const sites = [];
const re = /\bfail\(/g;
let match;
while ((match = re.exec(prod)) !== null) {
  if (prod.slice(Math.max(0, match.index - 9), match.index) === 'function ') continue;
  const line = prod.slice(0, match.index).split('\n').length;
  // enclosing top-level function name
  const before = prod.slice(0, match.index);
  const fnMatches = [...before.matchAll(/^(?:export )?function ([A-Za-z]+)|^const ([A-Za-z]+) = \(/gm)];
  const fn = fnMatches.length ? fnMatches[fnMatches.length - 1][1] ?? fnMatches[fnMatches.length - 1][2] : '?';
  const msg = prod
    .slice(match.index + 5, match.index + 200)
    .replace(/\s+/g, ' ')
    .replace(/^[`'"\s(]+/, '')
    .split(/[`'"]\s*[,)]/)[0]
    .slice(0, 78);
  sites.push({ index: match.index, line, fn, msg });
}

const fixImports = (text) => text.replaceAll("'../utils/", "'../../../utils/");
const NOFAIL = '\nfunction noFail(_message: string): undefined {\n  return undefined;\n}\n';
const write = (id, text) => {
  const dir = path.join(mutRoot, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'managed-session-records.ts'), fixImports(text));
  fs.writeFileSync(path.join(dir, 'managed-session-records.test.ts'), test);
};
write('m000', prod); // control: unmutated copy must stay green
sites.forEach((site, i) => {
  const id = `m${String(i + 1).padStart(3, '0')}`;
  site.id = id;
  write(id, prod.slice(0, site.index) + 'noFail(' + prod.slice(site.index + 5) + NOFAIL);
});

const outFile = path.join(here, `mut-vitest-${label}.json`);
const t0 = Date.now();
const run = spawnSync(
  'npx',
  ['vitest', 'run', 'src/managed-runtime/__mut__', '--reporter=json', `--outputFile=${outFile}`],
  { cwd: core, env: { ...process.env, CI: 'true' }, encoding: 'utf8', maxBuffer: 1 << 28 },
);
const seconds = ((Date.now() - t0) / 1000).toFixed(1);
fs.rmSync(mutRoot, { recursive: true, force: true });
const status = execFileSync('git', ['status', '--porcelain', '--', 'packages/core/src'], { cwd: root, encoding: 'utf8' });

const report = JSON.parse(fs.readFileSync(outFile, 'utf8'));
const byId = new Map();
for (const file of report.testResults) {
  const id = /__mut__\/(m\d+)\//.exec(file.name)[1];
  const failed = file.assertionResults.filter((a) => a.status === 'failed');
  byId.set(id, {
    total: file.assertionResults.length,
    failed: failed.length,
    firstFailed: failed[0]?.title ?? null,
    fileStatus: file.status,
  });
}
const control = byId.get('m000');
for (const site of sites) {
  const r = byId.get(site.id);
  site.killed = !r || r.fileStatus !== 'passed' || r.failed > 0;
  site.failedTests = r?.failed ?? -1;
  site.firstFailed = r?.firstFailed ?? '(file failed to load)';
}
const result = {
  label,
  head: execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  control,
  seconds,
  treeCleanAfter: status.trim() === '',
  vitestExit: run.status,
  sites,
};
fs.writeFileSync(path.join(here, `mut-${label}.json`), JSON.stringify(result, null, 1));
const killed = sites.filter((s) => s.killed).length;
console.log(
  `${label} ${result.head}: control ${control.total - control.failed}/${control.total} green, ${sites.length} mutants, ${killed} killed, ${sites.length - killed} survived, ${seconds}s, tree clean after: ${result.treeCleanAfter}`,
);
for (const s of sites.filter((x) => !x.killed)) console.log(`  SURVIVED ${s.id} L${s.line} ${s.fn}: ${s.msg}`);
