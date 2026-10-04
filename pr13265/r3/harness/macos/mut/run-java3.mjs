// Applies each round-2 Java mutant in wt-mut2: javac the one mutated file
// into target/classes, run the three contract/store test classes offline
// with surefire, restore the source, recompile, and check class hashes.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { MUTANTS } from './java-mutants3.mjs';

const SP = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/375ea070-7eb1-408b-8193-ec64d7c2959a/scratchpad';
const WT = `${SP}/wt-mut3`;
const MOD = `${WT}/packages/sdk-java/managed-agent-server`;
const CLASSES = `${MOD}/target/classes`;
const JDK = `${process.env.HOME}/Install/jdk21/bin`;
const CP = `${CLASSES}:${fs.readFileSync(`${SP}/rig/cp.txt`, 'utf8').trim()}`;
const TESTS = process.env.TESTS ?? 'ManagedChildRunRecordContractTest,ManagedExtensionProjectionContractTest,ManagedExtensionRecordStoreTest';
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
const env = { ...process.env, JAVA_HOME: `${process.env.HOME}/Install/jdk21`, PATH: `${JDK}:${process.env.HOME}/Install/maven/bin:${process.env.PATH}` };
const storeDir = path.join(CLASSES, 'com/alibaba/qwen/code/managedagent/store');
const classHash = () => {
  const h = createHash('sha256');
  for (const f of fs.readdirSync(storeDir).filter((n) => /^ManagedExtension(Records|Projection|RecordStore)/.test(n)).sort()) h.update(f).update(fs.readFileSync(path.join(storeDir, f)));
  return h.digest('hex');
};
const javac = (file) => spawnSync(`${JDK}/javac`, ['--release', '21', '-parameters', '-g', '-nowarn', '-d', CLASSES, '-cp', CP, `${WT}/${file}`], { encoding: 'utf8' });
const files = [...new Set(MUTANTS.map((m) => m[1]))];
const originals = new Map(files.map((f) => [f, fs.readFileSync(`${WT}/${f}`, 'utf8')]));
for (const f of files) { const r = javac(f); if (r.status !== 0) throw new Error(`baseline javac ${f}: ${r.stderr}`); }
const baseHash = classHash();
const runTests = () => {
  fs.rmSync(`${MOD}/target/surefire-reports`, { recursive: true, force: true });
  spawnSync('mvn', ['--batch-mode', '--no-transfer-progress', '-o', '-q', '-s', `${SP}/m2settings.xml`, `-Dmaven.repo.local=${SP}/m2repo`, 'surefire:test', `-Dtest=${TESTS}`, '-Dsurefire.failIfNoSpecifiedTests=false'], { cwd: MOD, env, encoding: 'utf8' });
  let tests = 0, failures = 0, errors = 0; const msgs = [];
  for (const x of fs.existsSync(`${MOD}/target/surefire-reports`) ? fs.readdirSync(`${MOD}/target/surefire-reports`).filter((n) => n.endsWith('.xml')) : []) {
    const s = fs.readFileSync(`${MOD}/target/surefire-reports/${x}`, 'utf8');
    tests += Number((s.match(/ tests="(\d+)"/) || [])[1] || 0);
    failures += Number((s.match(/ failures="(\d+)"/) || [])[1] || 0);
    errors += Number((s.match(/ errors="(\d+)"/) || [])[1] || 0);
    for (const m of s.matchAll(/<(failure|error) message="([^"]{0,120})/g)) msgs.push(m[2]);
  }
  return { tests, failures, errors, msgs: msgs.slice(0, 2) };
};
const base = runTests();
console.log(`baseline: tests=${base.tests} failures=${base.failures} errors=${base.errors}`);
if (base.tests === 0 || base.failures || base.errors) throw new Error('baseline not green');
const results = [];
try {
  for (const [id, file, find, replace, scope] of MUTANTS) {
    if (only && !only.some((o) => id.startsWith(o))) continue;
    const src = originals.get(file);
    const at = scope === 'child' ? src.indexOf('public static void requireChildRun(JsonNode child)') : 0;
    const head = src.slice(0, at), tail = src.slice(at);
    const n = tail.split(find).length - 1;
    if (at < 0 || n !== 1) { console.log(`${id}: BAD_ANCHOR(${n})`); results.push({ id, status: 'BAD_ANCHOR' }); continue; }
    fs.writeFileSync(`${WT}/${file}`, head + tail.replace(find, () => replace));
    const c = javac(file);
    fs.writeFileSync(`${WT}/${file}`, src);
    if (c.status !== 0) { console.log(`${id}: COMPILE_ERROR ${c.stderr.split('\n')[0]}`); results.push({ id, status: 'COMPILE_ERROR' }); javac(file); continue; }
    const r = runTests();
    const rc = javac(file);
    if (rc.status !== 0) throw new Error(`restore javac failed for ${file}`);
    const status = r.tests === 0 ? 'NO_RUN' : r.failures + r.errors > 0 ? 'KILLED' : 'SURVIVED';
    results.push({ id, status, ...r });
    console.log(`${id}: ${status} (tests=${r.tests} failures=${r.failures} errors=${r.errors}) ${r.msgs.join(' | ')}`);
  }
} finally {
  for (const [f, s] of originals) { fs.writeFileSync(`${WT}/${f}`, s); javac(f); }
}
const after = classHash();
console.log(after === baseHash ? 'restored class hash matches baseline' : 'WARNING class hash differs after restore');
console.log(execFileSync('git', ['-C', WT, 'status', '--porcelain', '--', 'packages/sdk-java'], { encoding: 'utf8' }).trim() || 'java sources clean');
fs.mkdirSync(`${SP}/rig3/mut/java`, { recursive: true });
fs.writeFileSync(`${SP}/rig3/mut/java/summary.json`, JSON.stringify(results, null, 1));
console.log(`RESULT killed ${results.filter((r) => r.status === 'KILLED').length}/${results.length}; survivors: ${results.filter((r) => r.status === 'SURVIVED').map((r) => r.id.split(' ')[0]).join(' ')}`);
