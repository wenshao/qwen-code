// Runs every mutant against the base, (mid) and head arms of PR #13120.
// Production sources are identical across arms; an arm swaps only the shared
// fixture JSON and the test files the PR changed.
// usage: node lanes.mjs java|ts [mutantIds...]
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { MUTANTS } from './mutants.mjs';

const S = path.resolve(import.meta.dirname, '..');
const WT = path.join(S, 'wt-pr');
const FIX = 'packages/core/src/managed-runtime/contracts/managed-extension-record-v1.fixtures.json';
const REC_TEST = 'packages/core/src/managed-runtime/managed-extension-record.test.ts';
const GATE_TEST = 'packages/core/src/managed-runtime/managed-operation-grant-gate.test.ts';
const MOD = path.join(WT, 'packages/sdk-java/managed-agent-server');
const JAVA_HOME = '/Users/wenshao/Install/jdk21';
const NODE_BIN = '/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin';
const env = { ...process.env, JAVA_HOME, PATH: `${JAVA_HOME}/bin:${NODE_BIN}:${process.env.PATH}` };

const sha = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const git = (...args) => execFileSync('git', ['-C', WT, ...args], { encoding: 'utf8' });
const pristine = (rel) => git('show', `HEAD:${rel}`);

function mutate(id, rel) {
  const source = pristine(rel);
  if (id === 'none') return source;
  const m = MUTANTS.find((each) => each.id === id);
  if (m.file !== rel) throw new Error(`${id} targets ${m.file}, not ${rel}`);
  const parts = source.split(m.find);
  if (parts.length !== 2) throw new Error(`${id}: find occurs ${parts.length - 1} times`);
  return parts.join(m.replace);
}

function useArm(arm, files) {
  for (const [from, rel] of files) {
    fs.copyFileSync(path.join(S, 'arms', arm, from), path.join(WT, rel));
  }
}

const lang = process.argv[2];
const only = process.argv.slice(3);
const outDir = path.join(S, 'results', lang);
fs.mkdirSync(outDir, { recursive: true });

if (lang === 'java') {
  const JM = MUTANTS.find((m) => m.lang === 'java').file;
  const cp = [
    path.join(MOD, 'target/classes'),
    path.join(MOD, 'target/test-classes'),
    fs.readFileSync(path.join(S, 'cp.txt'), 'utf8').trim(),
  ].join(':');
  const javac = (file, dest) =>
    execFileSync(`${JAVA_HOME}/bin/javac`, ['--release', '21', '-parameters', '-g', '-nowarn', '-d', dest, '-cp', cp, file], { env, stdio: 'pipe' });
  const mainSrc = path.join(S, 'jsrc/main/ManagedExtensionRecords.java');
  const classFile = path.join(MOD, 'target/classes/com/alibaba/qwen/code/managedagent/store/ManagedExtensionRecords.class');
  fs.mkdirSync(path.dirname(mainSrc), { recursive: true });
  const compileMain = (id) => {
    fs.writeFileSync(mainSrc, mutate(id, JM));
    javac(mainSrc, path.join(MOD, 'target/classes'));
    return sha(classFile);
  };
  const pristineClass = compileMain('none');
  const ids = only.length ? only : ['none', ...MUTANTS.filter((m) => m.lang === 'java').map((m) => m.id)];
  for (const arm of (process.env.ARMS ? process.env.ARMS.split(',') : ['base', 'head'])) {
    useArm(arm, [['fixtures.json', FIX]]);
    const testSrc = path.join(S, 'jsrc', arm, 'ManagedExtensionRecordContractTest.java');
    fs.mkdirSync(path.dirname(testSrc), { recursive: true });
    fs.copyFileSync(path.join(S, 'arms', arm, 'ContractTest.java'), testSrc);
    javac(testSrc, path.join(MOD, 'target/test-classes'));
    const fixtureSha = sha(path.join(WT, FIX));
    for (const id of ids) {
      const classSha = compileMain(id);
      if ((id === 'none') !== (classSha === pristineClass)) throw new Error(`${id}: class sha check failed`);
      const report = path.join(MOD, 'target/surefire-reports/TEST-com.alibaba.qwen.code.managedagent.ManagedExtensionRecordContractTest.xml');
      fs.rmSync(report, { force: true });
      const run = spawnSync('/Users/wenshao/Install/maven/bin/mvn', ['--batch-mode', '--no-transfer-progress', '-o', '-q', `-Dmaven.repo.local=${S}/m2`, '-f', path.join(MOD, 'pom.xml'), 'surefire:test', '-Dtest=ManagedExtensionRecordContractTest', '-DtrimStackTrace=true'], { env, encoding: 'utf8' });
      if (sha(path.join(WT, FIX)) !== fixtureSha) throw new Error('fixture changed during run');
      const xml = fs.readFileSync(report, 'utf8');
      const cases = [...xml.matchAll(/<testcase name="([^"]+)"[^>]*?(\/>|>([\s\S]*?)<\/testcase>)/g)].map((m) => {
        const body = m[3] ?? '';
        const f = body.match(/<(failure|error) message="([^"]*)" type="([^"]+)"/);
        return { name: m[1], outcome: f ? f[1] : 'pass', type: f?.[3] ?? null, message: f ? f[2].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&').slice(0, 600) : null };
      });
      const result = { lang, arm, id, classSha, fixtureSha, mvnExit: run.status, tests: cases.length, red: cases.filter((c) => c.outcome !== 'pass') };
      fs.writeFileSync(path.join(outDir, `${arm}-${id}.json`), JSON.stringify(result, null, 2));
      console.log(`RESULT java ${arm} ${id} tests=${result.tests} red=${result.red.length} ${result.red.map((r) => `${r.name}:${r.outcome}:${r.type}`).join(' ')}`);
    }
  }
  // Leave the tree as the PR has it: head test class, pristine main class.
  if (compileMain('none') !== pristineClass) throw new Error('pristine class not restored');
  javac(path.join(MOD, 'src/test/java/com/alibaba/qwen/code/managedagent/ManagedExtensionRecordContractTest.java'), path.join(MOD, 'target/test-classes'));
  git('checkout', '--', FIX);
  console.log(`java done; status=[${git('status', '--short').trim()}]`);
} else if (lang === 'ts') {
  const tsMutants = MUTANTS.filter((m) => m.lang === 'ts');
  const prod = [...new Set(tsMutants.map((m) => m.file))];
  const restore = () => git('checkout', '--', ...prod);
  const plan = only.length
    ? (process.env.ARMS ? process.env.ARMS.split(',') : ['base', 'mid', 'head']).map((a) => [a, only])
    : [
        ['base', ['none', ...tsMutants.map((m) => m.id)]],
        ['mid', ['none', 'G1', 'G2']],
        ['head', ['none', ...tsMutants.map((m) => m.id)]],
      ];
  for (const [arm, ids] of plan) {
    useArm(arm, [['fixtures.json', FIX], ['record.test.ts', REC_TEST], ['gate.test.ts', GATE_TEST]]);
    for (const id of ids) {
      restore();
      if (id !== 'none') {
        const m = MUTANTS.find((each) => each.id === id);
        fs.writeFileSync(path.join(WT, m.file), mutate(id, m.file));
      }
      const out = path.join(outDir, `${arm}-${id}.vitest.json`);
      fs.rmSync(out, { force: true });
      const run = spawnSync(`${NODE_BIN}/npx`, ['--no-install', 'vitest', 'run', 'src/managed-runtime/managed-extension-record.test.ts', 'src/managed-runtime/managed-operation-grant-gate.test.ts', '--reporter=json', `--outputFile=${out}`], { cwd: path.join(WT, 'packages/core'), env, encoding: 'utf8' });
      restore();
      let report;
      try {
        report = JSON.parse(fs.readFileSync(out, 'utf8'));
      } catch {
        console.log(`RESULT ts ${arm} ${id} NO-REPORT exit=${run.status} ${run.stderr.slice(-400)}`);
        continue;
      }
      const all = report.testResults.flatMap((file) => file.assertionResults.map((a) => ({ file: path.basename(file.name), name: a.fullName, status: a.status, message: (a.failureMessages ?? []).join('\n').split('\n')[0].slice(0, 400) })));
      const suiteErrors = report.testResults.filter((f) => f.status === 'failed' && f.assertionResults.length === 0).map((f) => f.message);
      const result = { lang, arm, id, exit: run.status, tests: all.length, red: all.filter((a) => a.status !== 'passed'), suiteErrors };
      fs.writeFileSync(path.join(outDir, `${arm}-${id}.json`), JSON.stringify(result, null, 2));
      console.log(`RESULT ts ${arm} ${id} tests=${result.tests} red=${result.red.length} ${result.red.map((r) => r.name).join(' | ')}${suiteErrors.length ? ' SUITE-ERRORS' : ''}`);
    }
  }
  restore();
  git('checkout', '--', FIX, REC_TEST, GATE_TEST);
  console.log(`ts done; status=[${git('status', '--short').trim()}]`);
}
