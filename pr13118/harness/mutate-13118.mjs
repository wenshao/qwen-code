// Mutation runner for PR #13118. One mutant at a time in a dedicated worktree;
// the mutated file is restored from the bytes read before the edit.
// usage: node mutate-13118.mjs <worktree dir name> <arm label> <ids|all|baseline> [tsSet=worker|serve]
import { spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mutants } from './mutants-13118.mjs';

const SP = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const [wtName, arm, want = 'all', tsSet = 'worker'] = process.argv.slice(2);
const WT = path.join(SP, wtName);
const OUT = path.join(SP, 'results', 'mutation', arm);
fs.mkdirSync(OUT, { recursive: true });
const NODE_BIN = '/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin';
const env = {
  ...process.env,
  PATH: `${NODE_BIN}:/Users/wenshao/Install/jdk21/bin:${process.env.PATH}`,
  JAVA_HOME: '/Users/wenshao/Install/jdk21',
  NO_COLOR: '1',
  FORCE_COLOR: '0',
  CI: '1',
};
const M2 = path.join(SP, `m2-${process.env.M2_ARM ?? arm.replace(/-.*/, '')}`);
const git = (...args) => execFileSync('git', args, { cwd: WT, encoding: 'utf8' }).trim();
const dirty = () =>
  git('status', '--short')
    .split('\n')
    .filter((l) => l && !l.endsWith('junit.xml'))
    .join('\n');

const SERVE_FILES = fs
  .readdirSync(path.join(WT, 'packages/cli/src/serve'))
  .filter((f) => /^(managed|broker|hosted).*\.test\.ts$/.test(f) && !f.includes('.integration.'))
  .map((f) => `src/serve/${f}`);
const TS_FILES = tsSet === 'serve' ? SERVE_FILES : ['src/serve/managed-runtime-provider-worker.test.ts'];

function run(cmd, args, cwd, log) {
  const started = Date.now();
  const r = spawnSync(cmd, args, { cwd, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 30 * 60_000 });
  fs.writeFileSync(log, `${r.stdout ?? ''}\n${r.stderr ?? ''}`);
  return { status: r.status, text: `${r.stdout ?? ''}\n${r.stderr ?? ''}`, ms: Date.now() - started };
}

function maven(log) {
  const args = ['--batch-mode', '--no-transfer-progress', '-o', `-Dmaven.repo.local=${M2}`,
    '-f', 'packages/sdk-java/runtime-broker/pom.xml', '-Djacoco.skip=true'];
  if (process.env.JAVA_TESTS) args.push(`-Dtest=${process.env.JAVA_TESTS}`, '-Dsurefire.failIfNoSpecifiedTests=false');
  args.push('test');
  const r = run('/Users/wenshao/Install/maven/bin/mvn', args, WT, log);
  if (/COMPILATION ERROR/.test(r.text)) return { compile: false, failed: [], total: 0, ms: r.ms };
  const totals = [...r.text.matchAll(/Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)\s*$/gm)];
  const last = totals[totals.length - 1];
  const failed = [...r.text.matchAll(/^\[ERROR\]\s+([A-Za-z0-9_.$]+)\.([A-Za-z0-9_]+):\d+/gm)].map((m) => `${m[1].split('.').pop()}.${m[2]}`);
  const errored = [...r.text.matchAll(/^\[ERROR\]\s+([A-Za-z0-9_.$]+)\.([A-Za-z0-9_]+)\s+»/gm)].map((m) => `${m[1].split('.').pop()}.${m[2]}`);
  return {
    compile: !!last,
    total: last ? Number(last[1]) : 0,
    bad: last ? Number(last[2]) + Number(last[3]) : -1,
    failed: [...new Set([...failed, ...errored])],
    ms: r.ms,
  };
}

function vitest(log) {
  const r = run('npx', ['vitest', 'run', '--reporter=json', `--outputFile=${log}.json`, ...TS_FILES], path.join(WT, 'packages/cli'), log);
  let json;
  try {
    json = JSON.parse(fs.readFileSync(`${log}.json`, 'utf8'));
  } catch {
    return { compile: false, failed: [], total: 0, ms: r.ms };
  }
  const failed = [];
  for (const file of json.testResults)
    for (const t of file.assertionResults)
      if (t.status === 'failed') failed.push(`${path.basename(file.name)} › ${t.title}`);
  const suiteErrors = json.testResults
    .filter((f) => f.status === 'failed' && f.assertionResults.length === 0)
    .map((f) => `${path.basename(f.name)} (suite error)`);
  return { compile: true, total: json.numTotalTests, bad: json.numFailedTests + suiteErrors.length, failed: [...failed, ...suiteErrors], ms: r.ms };
}

const suite = (kind, tag) => (kind === 'broker' ? maven(path.join(OUT, `${tag}-broker.log`)) : vitest(path.join(OUT, `${tag}-cli.log`)));

if (dirty() !== '') throw new Error(`${WT} is not clean:\n${dirty()}`);
const head = git('rev-parse', 'HEAD');
const matrix = path.join(OUT, 'matrix.log');
const record = (line) => {
  console.log(line);
  fs.appendFileSync(matrix, line + '\n');
};
record(`# arm=${arm} head=${head} ts=${tsSet}(${TS_FILES.length} files) java=${process.env.JAVA_TESTS ?? 'module'} ${new Date().toISOString()}`);

if (want === 'baseline' || want.startsWith('baseline:')) {
  const kinds = want === 'baseline' ? ['ts', 'broker'] : want.slice(9).split(',');
  for (const kind of kinds) {
    const r = suite(kind, `baseline-${kind}`);
    record(`BASELINE ${kind.padEnd(6)} total=${r.total} bad=${r.bad} compile=${r.compile} ${Math.round(r.ms / 1000)}s${r.failed.length ? ` failed=${r.failed.join(' | ')}` : ''}`);
  }
} else {
  const ids = want === 'all' ? null : want.split(',');
  const chosen = ids ? mutants.filter((m) => ids.includes(m.id)) : mutants;
  const results = [];
  for (const m of chosen) {
    const file = path.join(WT, m.file);
    const source = fs.readFileSync(file, 'utf8');
    const hits = source.split(m.find).length - 1;
    if (hits !== 1) {
      record(`${m.id.padEnd(4)} SKIPPED anchor matched ${hits} times :: ${m.what}`);
      continue;
    }
    fs.writeFileSync(file, source.replace(m.find, m.replace));
    let line;
    try {
      const r = suite(m.suite, m.id);
      const t = `${Math.round(r.ms / 1000)}s`;
      if (!r.compile) line = `${m.id.padEnd(4)} INVALID (does not compile / suite did not run) ${t} :: ${m.what}`;
      else if (r.failed.length) line = `${m.id.padEnd(4)} KILLED   by ${r.failed.length} of ${r.total} ${t} :: ${m.what} :: ${r.failed.join(' | ')}`;
      else line = `${m.id.padEnd(4)} SURVIVED ${r.total} tests ${t} :: ${m.what}`;
    } finally {
      fs.writeFileSync(file, source);
    }
    if (dirty() !== '') throw new Error(`restore failed after ${m.id}`);
    record(line);
    results.push(line);
  }
  const killed = results.filter((l) => l.includes(' KILLED ')).length;
  const survived = results.filter((l) => l.includes(' SURVIVED ')).length;
  record(`# killed=${killed} survived=${survived} other=${results.length - killed - survived} of ${results.length}`);
}
