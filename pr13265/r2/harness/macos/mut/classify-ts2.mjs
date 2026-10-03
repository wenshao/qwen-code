// For each surviving TS mutant: transpile the mutated source into wt-mut's
// dist, replay the differential candidates, and diff the verdicts against
// the unmutated head. A changed verdict is an input the PR's fixtures do not
// pin; no change across all candidates suggests an equivalent mutant.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { MUTANTS as ALL } from './ts-mutants2.mjs';
const FILE = 'packages/core/src/managed-runtime/managed-child-run-record.ts';
const MUTANTS = ALL.filter((m) => m[1] === FILE).map(([id, , find, replace]) => [id, find, replace]);

const SP = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/375ea070-7eb1-408b-8193-ec64d7c2959a/scratchpad';
const WT = `${SP}/wt-mut2`;
const SRC = `${WT}/${FILE}`;
const DIST = `${WT}/packages/core/dist/src/managed-runtime/managed-child-run-record.js`;
const CANDS = `${SP}/rig2/diff/head2/cands.jsonl`;
const BASE = fs.readFileSync(`${SP}/rig2/diff/head2/ts.tsv`, 'utf8').trim().split('\n');
const cands = fs.readFileSync(CANDS, 'utf8').trim().split('\n');
const sha = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const original = fs.readFileSync(SRC, 'utf8');
const distOriginal = fs.readFileSync(DIST);
const distSha = sha(DIST);
const survivors = JSON.parse(fs.readFileSync(`${SP}/rig2/mut/ts/survivors.json`, 'utf8'));
const out = [];
try {
  for (const [id, find, replace] of MUTANTS) {
    if (!survivors.includes(id.split(' ')[0])) continue;
    const mutated = original.replace(find, replace);
    if (mutated === original) throw new Error(`${id} did not apply`);
    const js = execFileSync(`${WT}/node_modules/.bin/esbuild`, ['--loader=ts', '--format=esm', '--target=es2022'], { input: mutated, encoding: 'utf8' });
    fs.writeFileSync(DIST, js);
    const tsv = `${SP}/rig2/mut/ts/${id.split(' ')[0]}.verdicts.tsv`;
    const r = spawnSync('node', [`${SP}/rig/diff/ts-drive.mjs`], { env: { ...process.env, WT, IN: CANDS, OUT: tsv }, encoding: 'utf8' });
    fs.writeFileSync(DIST, distOriginal);
    if (r.status !== 0) throw new Error(`${id} driver failed: ${r.stderr.slice(0, 300)}`);
    const got = fs.readFileSync(tsv, 'utf8').trim().split('\n');
    if (got.length !== BASE.length) throw new Error(`${id} length ${got.length}`);
    const diffs = [];
    for (let i = 0; i < got.length; i++) if (got[i] !== BASE[i]) diffs.push(i);
    const examples = diffs.slice(0, 2).map((i) => ({ was: BASE[i], now: got[i], cand: cands[i].slice(0, 700) }));
    out.push({ id, distinguishing: diffs.length, examples });
    console.log(`${id}: ${diffs.length} distinguishing candidates${diffs.length ? '' : ' (no input among 200k tells it apart)'}`);
  }
} finally {
  fs.writeFileSync(DIST, distOriginal);
  if (sha(DIST) !== distSha) throw new Error('dist not restored');
  const st = execFileSync('git', ['-C', WT, 'status', '--porcelain', '--', FILE], { encoding: 'utf8' }).trim();
  if (st) throw new Error(`source dirty: ${st}`);
}
fs.writeFileSync(`${SP}/rig2/mut/ts/classification.json`, JSON.stringify(out, null, 1));
console.log('dist restored, sha matches');
