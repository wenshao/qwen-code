// Runs every mutant in mutants.mjs against two arms that share one source
// tree: arm "main" (fixtures + TS test file from c3e880b842) and arm "pr"
// (from 93343ac9f9). Only the fixture file and the one-line test change
// differ between the arms, so any verdict change comes from the new cases.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
const M = await import(process.argv[3] ?? './mutants.mjs');

const SP = path.resolve(import.meta.dirname, '..');
const W = path.join(SP, 'wt-pr');
const OUT = path.join(SP, 'mut', 'out');
fs.mkdirSync(OUT, { recursive: true });
const only = process.argv[2]; // 'ts' | 'java' | undefined
const FIX = 'packages/core/src/managed-runtime/contracts/managed-extension-record-v1.fixtures.json';
const TEST = 'packages/core/src/managed-runtime/managed-extension-record.test.ts';
const arms = {
  main: { [FIX]: git('show', `c3e880b842:${FIX}`), [TEST]: git('show', `c3e880b842:${TEST}`) },
  pr: { [FIX]: git('show', `93343ac9f9:${FIX}`), [TEST]: git('show', `93343ac9f9:${TEST}`) },
};
function git(...args) {
  return execFileSync('git', args, { cwd: W, maxBuffer: 1 << 30, encoding: 'utf8' });
}
function useArm(name) {
  for (const [file, text] of Object.entries(arms[name])) fs.writeFileSync(path.join(W, file), text);
}
const sha = (file) => createHash('sha1').update(fs.readFileSync(file)).digest('hex');
const results = [];
function record(row) {
  results.push(row);
  console.log(JSON.stringify(row));
  fs.appendFileSync(path.join(OUT, 'results.jsonl'), JSON.stringify(row) + '\n');
}

// ---- TypeScript: vitest on the two focused files, JSON reporter ----------
const CORE = path.join(W, 'packages/core');
const VITEST = path.join(W, 'node_modules/vitest/vitest.mjs');
function runTs(tag) {
  const out = path.join(OUT, `${tag}.vitest.json`);
  const r = spawnSync(process.execPath, [VITEST, 'run',
    'src/managed-runtime/managed-extension-record.test.ts',
    'src/managed-runtime/managed-session-records.test.ts',
    '--coverage.enabled=false', '--reporter=json', `--outputFile=${out}`], { cwd: CORE, encoding: 'utf8' });
  let failed = [];
  let total = 0;
  try {
    const j = JSON.parse(fs.readFileSync(out, 'utf8'));
    total = j.numTotalTests;
    for (const f of j.testResults) for (const a of f.assertionResults) if (a.status !== 'passed') failed.push(a.title);
    if (j.numFailedTestSuites && !failed.length) failed.push('<suite error>');
  } catch (e) {
    failed = [`<no report: exit ${r.status}> ${r.stderr.slice(-300)}`];
  }
  return { exit: r.status, total, failed };
}

// ---- Java: javac the one class, surefire:test the contract test ----------
const MAS = path.join(W, 'packages/sdk-java/managed-agent-server');
const CLASSES = path.join(MAS, 'target/classes');
const CLASS = path.join(CLASSES, 'com/alibaba/qwen/code/managedagent/store/ManagedExtensionRecords.class');
const CP = `${CLASSES}:${fs.readFileSync(path.join(SP, 'cp.txt'), 'utf8').trim()}`;
const JAVAC = path.join(process.env.HOME, 'Install/jdk21/bin/javac');
const javaSrc = path.join(W, M.JAVA_FILE);
const javaOrig = fs.readFileSync(javaSrc, 'utf8');
function javac(text) {
  const dir = fs.mkdtempSync(path.join(SP, 'mut', 'jsrc-'));
  const file = path.join(dir, 'ManagedExtensionRecords.java');
  fs.writeFileSync(file, text);
  execFileSync(JAVAC, ['--release', '21', '-parameters', '-g', '-nowarn', '-d', CLASSES, '-cp', CP, file], { stdio: 'pipe' });
  fs.rmSync(dir, { recursive: true });
}
function runJava(tag) {
  const report = path.join(MAS, 'target/surefire-reports/TEST-com.alibaba.qwen.code.managedagent.ManagedExtensionRecordContractTest.xml');
  fs.rmSync(report, { force: true });
  const r = spawnSync(path.join(SP, 'mvnw.sh'), ['-o', '-q', 'surefire:test', '-Dtest=ManagedExtensionRecordContractTest'], { cwd: MAS, encoding: 'utf8' });
  fs.writeFileSync(path.join(OUT, `${tag}.mvn.log`), r.stdout + r.stderr);
  if (!fs.existsSync(report)) return { exit: r.status, total: 0, failed: [`<no report: exit ${r.status}>`] };
  const xml = fs.readFileSync(report, 'utf8');
  fs.copyFileSync(report, path.join(OUT, `${tag}.surefire.xml`));
  const total = Number(/tests="(\d+)"/.exec(xml)[1]);
  const failed = [];
  for (const m of xml.matchAll(/<testcase name="([^"]+)"[^>]*>\s*<(failure|error)[^>]*message="([^"]*)"/g)) {
    const cases = [...m[3].matchAll(/([A-Za-z]+Cases\/[A-Za-z0-9-]+)/g)].map((x) => x[1]);
    failed.push(`${m[1]}${cases.length ? ' [' + [...new Set(cases)].join(', ') + ']' : ' (' + m[3].slice(0, 160) + ')'}`);
  }
  return { exit: r.status, total, failed };
}

function mutate(text, m) {
  if (text.split(m.from).length !== 2) throw new Error(`anchor not unique: ${m.id}`);
  return text.replace(m.from, () => m.to);
}

try {
  if (only !== 'java') {
    const srcOf = (m) => path.join(W, m.file ?? M.TS_FILE);
    const originals = new Map(M.ts.map((m) => [srcOf(m), fs.readFileSync(srcOf(m), 'utf8')]));
    const restoreTs = () => { for (const [f, t] of originals) fs.writeFileSync(f, t); };
    try {
      for (const arm of process.argv[3] ? [] : ['main', 'pr']) {
        useArm(arm);
        record({ lang: 'ts', id: 'baseline', arm, ...runTs(`baseline-ts-${arm}`) });
      }
      for (const m of M.ts) {
        const tsSrc = srcOf(m);
        const tsOrig = originals.get(tsSrc);
        fs.writeFileSync(tsSrc, mutate(tsOrig, m));
        for (const arm of ['main', 'pr']) {
          useArm(arm);
          record({ lang: 'ts', id: m.id, gap: m.gap, arm, ...runTs(`${m.id}-${arm}`) });
        }
        fs.writeFileSync(tsSrc, tsOrig);
      }
    } finally {
      restoreTs();
    }
  }
  if (only !== 'ts') {
    javac(javaOrig);
    const baseSha = sha(CLASS);
    for (const arm of ['main', 'pr']) {
      useArm(arm);
      record({ lang: 'java', id: 'baseline', arm, classSha: baseSha, ...runJava(`baseline-java-${arm}`) });
    }
    try {
      for (const m of M.java) {
        javac(mutate(javaOrig, m));
        const mSha = sha(CLASS);
        for (const arm of ['main', 'pr']) {
          useArm(arm);
          record({ lang: 'java', id: m.id, gap: m.gap, arm, classSha: mSha, ...runJava(`${m.id}-${arm}`) });
        }
      }
    } finally {
      javac(javaOrig);
      console.log('restored class sha matches baseline:', sha(CLASS) === baseSha);
    }
  }
} finally {
  useArm('pr');
  console.log('worktree status:', git('status', '--porcelain').trim() || '(clean)');
}
