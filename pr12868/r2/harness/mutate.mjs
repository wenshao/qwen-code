// Mutation runner for PR #12868. Runs in the dedicated wt-mut worktree only.
// usage: node mutate.mjs <baseline|ids comma separated|all>
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mutants as round1, round2 } from './mutants.mjs';
const mutants = [...round1, ...round2];

const SP = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const WT = path.join(SP, 'wt-mut');
const OUT = path.join(SP, 'rig', 'out', 'mutation');
fs.mkdirSync(OUT, { recursive: true });
const NODE_BIN = '/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin';
const env = { ...process.env, PATH: `${NODE_BIN}:${process.env.PATH}`, NO_COLOR: '1', FORCE_COLOR: '0', CI: '1' };
const git = (...args) => execFileSync('git', args, { cwd: WT, encoding: 'utf8' }).trim();

const TS_FILES = fs
  .readdirSync(path.join(WT, 'packages/cli/src/serve'))
  .filter((f) => /^(managed|broker|hosted).*\.test\.ts$/.test(f) && !f.includes('.integration.'))
  .map((f) => `src/serve/${f}`);

function run(cmd, args, cwd, log) {
  const r = spawnSync(cmd, args, { cwd, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 15 * 60_000 });
  fs.writeFileSync(log, `${r.stdout ?? ''}\n${r.stderr ?? ''}`);
  return { status: r.status, text: `${r.stdout ?? ''}\n${r.stderr ?? ''}` };
}

function maven(module, log) {
  const r = run(path.join(SP, 'bin/mvnw.sh'), ['-o', '-f', `packages/sdk-java/${module}/pom.xml`, '-Djacoco.skip=true', 'test'], WT, log);
  if (/COMPILATION ERROR/.test(r.text)) return { compile: false, failed: [], total: 0 };
  const totals = [...r.text.matchAll(/Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)\s*$/gm)];
  const last = totals[totals.length - 1];
  const failed = [...r.text.matchAll(/^\[ERROR\]\s+([A-Za-z0-9_.$]+)\.([A-Za-z0-9_]+):\d+/gm)].map((m) => `${m[1].split('.').pop()}.${m[2]}`);
  const errored = [...r.text.matchAll(/^\[ERROR\]\s+([A-Za-z0-9_.$]+)\.([A-Za-z0-9_]+)\s+»/gm)].map((m) => `${m[1].split('.').pop()}.${m[2]}`);
  return {
    compile: true,
    total: last ? Number(last[1]) : 0,
    bad: last ? Number(last[2]) + Number(last[3]) : -1,
    failed: [...new Set([...failed, ...errored])],
    status: r.status,
  };
}

function vitest(pkg, files, log) {
  const r = run('npx', ['vitest', 'run', '--reporter=json', `--outputFile=${log}.json`, ...files], path.join(WT, pkg), log);
  let json;
  try {
    json = JSON.parse(fs.readFileSync(`${log}.json`, 'utf8'));
  } catch {
    return { compile: false, failed: [], total: 0, status: r.status };
  }
  const failed = [];
  for (const file of json.testResults)
    for (const t of file.assertionResults)
      if (t.status === 'failed') failed.push(`${path.basename(file.name)} › ${t.title}`);
  const suiteErrors = json.testResults.filter((f) => f.status === 'failed' && f.assertionResults.length === 0).map((f) => `${path.basename(f.name)} (suite error)`);
  return { compile: true, total: json.numTotalTests, bad: json.numFailedTests + suiteErrors.length, failed: [...failed, ...suiteErrors], status: r.status };
}

function suite(kind, tag) {
  const log = (n) => path.join(OUT, `${tag}-${n}.log`);
  if (kind === 'broker') return [['runtime-broker unit', maven('runtime-broker', log('broker'))]];
  if (kind === 'server') return [['managed-agent-server unit', maven('managed-agent-server', log('server'))]];
  if (kind === 'ts') return [['cli serve (managed/broker/hosted)', vitest('packages/cli', TS_FILES, log('cli'))]];
  if (kind === 'core')
    return [
      ['core managed-tool', vitest('packages/core', ['src/tools/managed-tool'], log('core'))],
      ['cli serve (managed/broker/hosted)', vitest('packages/cli', TS_FILES, log('cli'))],
    ];
  throw new Error(kind);
}

const want = process.argv[2] ?? 'baseline';
if (git('status', '--short') !== '') throw new Error('wt-mut is not clean');
const head = git('rev-parse', 'HEAD');
const results = [];
const record = (line) => {
  console.log(line);
  fs.appendFileSync(path.join(OUT, 'matrix.log'), line + '\n');
};
record(`# head=${head} arm=${want} ${new Date().toISOString()}`);

if (want === 'baseline') {
  for (const kind of ['broker', 'server', 'ts', 'core']) {
    for (const [name, r] of suite(kind, `baseline-${kind}`))
      record(`BASELINE ${kind.padEnd(6)} ${name}: total=${r.total} bad=${r.bad} compile=${r.compile}${r.failed.length ? ` failed=${r.failed.join(' | ')}` : ''}`);
  }
} else {
  const chosen = want === 'all' ? mutants : want === 'round2' ? round2 : mutants.filter((m) => want.split(',').includes(m.id));
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
      const runs = suite(m.suite, m.id);
      const broken = runs.find(([, r]) => !r.compile);
      const failed = runs.flatMap(([, r]) => r.failed);
      const total = runs.reduce((n, [, r]) => n + r.total, 0);
      if (broken) line = `${m.id.padEnd(4)} INVALID (does not compile / suite did not run) :: ${m.what}`;
      else if (failed.length) line = `${m.id.padEnd(4)} KILLED   by ${failed.length} of ${total} :: ${m.what} :: ${failed.slice(0, 4).join(' | ')}${failed.length > 4 ? ' | …' : ''}`;
      else line = `${m.id.padEnd(4)} SURVIVED ${total} tests :: ${m.what}`;
    } finally {
      git('checkout', '--', m.file);
    }
    if (git('status', '--short') !== '') throw new Error(`restore failed after ${m.id}`);
    record(line);
    results.push(line);
  }
  const killed = results.filter((l) => l.includes(' KILLED ')).length;
  const survived = results.filter((l) => l.includes(' SURVIVED ')).length;
  record(`# killed=${killed} survived=${survived} other=${results.length - killed - survived} of ${results.length}`);
}
