// Round 2: for each surviving record-level Java mutant, compile the mutated
// ManagedExtensionRecords into its own directory, put it first on the
// classpath, replay the 200k head2 candidates with Drive, and count verdicts
// that differ from the unmutated head2 Java verdicts.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { MUTANTS } from './java-mutants2.mjs';

const SP = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/375ea070-7eb1-408b-8193-ec64d7c2959a/scratchpad';
const WT = `${SP}/wt-mut2`;
const MOD = `${WT}/packages/sdk-java/managed-agent-server`;
const JDK = `${process.env.HOME}/Install/jdk21/bin`;
const CP = `${MOD}/target/classes:${fs.readFileSync(`${SP}/rig/cp.txt`, 'utf8').trim()}`;
const D = `${SP}/rig2/diff/head2`;
const OUT = `${SP}/rig2/mut/java`;
const REC = 'packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/store/ManagedExtensionRecords.java';
const ids = process.argv.slice(2);
const base = fs.readFileSync(`${D}/java.tsv`, 'utf8').trim().split('\n');
const original = fs.readFileSync(`${WT}/${REC}`, 'utf8');
const results = [];
try {
  for (const [id, file, find, replace, scope] of MUTANTS) {
    if (!ids.includes(id.split(' ')[0]) || file !== REC) continue;
    const at = scope === 'child' ? original.indexOf('public static void requireChildRun(JsonNode child)') : 0;
    const head = original.slice(0, at), tail = original.slice(at);
    if (tail.split(find).length - 1 !== 1) { console.log(`${id}: BAD_ANCHOR`); continue; }
    fs.writeFileSync(`${WT}/${REC}`, head + tail.replace(find, () => replace));
    const dir = `${OUT}/cls/${id.split(' ')[0]}`;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const c = spawnSync(`${JDK}/javac`, ['--release', '21', '-parameters', '-g', '-nowarn', '-d', dir, '-cp', CP, `${WT}/${REC}`], { encoding: 'utf8' });
    fs.writeFileSync(`${WT}/${REC}`, original);
    if (c.status !== 0) { console.log(`${id}: COMPILE_ERROR`); continue; }
    const tsv = `${OUT}/${id.split(' ')[0]}.verdicts.tsv`;
    const r = spawnSync(`${JDK}/java`, ['-cp', `${dir}:${D}/cls:${CP}`, 'Drive', `${D}/cands.jsonl`, tsv], { encoding: 'utf8' });
    if (r.status !== 0) { console.log(`${id}: DRIVE_FAILED ${r.stderr.slice(0, 200)}`); continue; }
    const got = fs.readFileSync(tsv, 'utf8').trim().split('\n');
    if (got.length !== base.length) { console.log(`${id}: LENGTH ${got.length}`); continue; }
    let n = 0;
    for (let i = 0; i < got.length; i++) if (got[i] !== base[i]) n++;
    results.push({ id, distinguishing: n });
    console.log(`${id}: ${n} distinguishing candidates`);
  }
} finally {
  fs.writeFileSync(`${WT}/${REC}`, original);
}
fs.writeFileSync(`${OUT}/classification.json`, JSON.stringify(results, null, 1));
console.log(fs.readFileSync(`${WT}/${REC}`, 'utf8') === original ? 'source restored' : 'WARNING source differs');
