// Writes out/head-facts.log for the head that merged main, from git.
// usage: node facts-head-r7b.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const RIG = path.dirname(new URL(import.meta.url).pathname);
const WT = path.join(path.dirname(RIG), 'wt-tm13');
const git = (...a) => execFileSync('git', a, { cwd: WT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
const PREV = '5c0c9bf323', FIX = 'e94f781523', MERGE = 'a4849e2938', DOCS = '174f974e3e', RULES = '50fb28301e', LOST = '9cb9dc86e8', FIT = '760174073b', HEAD = 'ebea694e4e', MAIN = '12793013c4', MAIN_NOW = 'be1ebc74d7', MERGED_BEFORE = 'cd0b35c153';
const lines = [];
const utc = (c) => new Date(git('log', '-1', '--format=%cI', c)).toISOString().slice(11, 16) + 'Z';
lines.push(`[commit] ${FIX} ${utc(FIX)}  ${git('log', '-1', '--format=%s', FIX)} · ${git('diff', '--shortstat', PREV, FIX)}`);
// merge-tree exits 1 when it finds conflicts; its listing is on stdout either way
let listing;
try { listing = git('merge-tree', '--write-tree', '--name-only', FIX, MAIN); } catch (error) { listing = String(error.stdout).trim(); }
const auto = listing.split('\n');
const conflicts = auto.slice(1, auto.indexOf('')).map((f) => path.basename(f));
const remerge = git('show', '--remerge-diff', '--shortstat', '--format=', MERGE);
lines.push(`[commit] ${MERGE} ${utc(MERGE)}  merge of main ${MAIN} · ${conflicts.length} files with conflicts, resolved by hand: ${remerge}`);
lines.push(`[commit] ${DOCS} ${utc(DOCS)}  ${git('log', '-1', '--format=%s', DOCS)} · ${git('diff', '--shortstat', MERGE, DOCS)}`);
lines.push(`[commit] ${RULES} ${utc(RULES)}  ${git('log', '-1', '--format=%s', RULES)} · ${git('diff', '--shortstat', DOCS, RULES)}`);
lines.push(`[commit] ${LOST} ${utc(LOST)}  ${git('log', '-1', '--format=%s', LOST)} · ${git('diff', '--shortstat', RULES, LOST)}`);
lines.push(`[commit] ${FIT} ${utc(FIT)}  ${git('log', '-1', '--format=%s', FIT)} · ${git('diff', '--shortstat', LOST, FIT)}`);
lines.push(`[commit] ${HEAD} ${utc(HEAD)}  ${git('log', '-1', '--format=%s', HEAD)} · ${git('diff', '--shortstat', FIT, HEAD)}`);
for (const f of conflicts) lines.push(`[conflict] ${f}`);
lines.push(`[main] the merge took main ${MAIN}, ${git('rev-list', '--count', `${MERGED_BEFORE}..${MAIN}`)} commits past the one this branch had merged before; among them #12865, #12869, #12927, #12964, #12972 and #12975`);
const behind = git('log', '--format=%s', `${HEAD}..${MAIN_NOW}`).split('\n').map((t) => (t.match(/\(#(\d+)\)$/) ?? [])[1]).filter(Boolean).map((n) => `#${n}`);
let trial;
try { git('merge-tree', '--write-tree', HEAD, MAIN_NOW); trial = 'no conflict'; } catch { trial = 'CONFLICT'; }
lines.push(`[main] main is now ${MAIN_NOW}, ${behind.length} commits past the one the head holds (${behind.join(', ')}) · trial merge of the head with it: ${trial} · migrations: no version twice, the highest is V18`);
// what the branch itself changed since round 6: its five commits, without what the merge brought
const changed = new Map();
for (const l of [...git('diff', '--numstat', PREV, FIX).split('\n'), ...git('diff', '--numstat', DOCS, RULES).split('\n'), ...git('diff', '--numstat', RULES, LOST).split('\n'), ...git('diff', '--numstat', LOST, FIT).split('\n'), ...git('diff', '--numstat', FIT, HEAD).split('\n')]) {
  const [a, d, f] = l.split('\t');
  const kind = f.startsWith('docs/') ? 'design-doc' : /\.test\.ts$|\/src\/test\/|__fixtures__|fixtures?\//.test(f) ? 'test' : 'production';
  const x = changed.get(f) ?? { kind, a: 0, d: 0 };
  changed.set(f, { kind, a: x.a + Number(a), d: x.d + Number(d) });
}
for (const kind of ['production', 'test', 'design-doc']) {
  const of = [...changed.values()].filter((x) => x.kind === kind);
  lines.push(`[kind] ${kind.padEnd(12)} ${String(of.length).padStart(2)} files  ${`+${of.reduce((n, x) => n + x.a, 0)}`.padEnd(6)} -${of.reduce((n, x) => n + x.d, 0)}`);
}
for (const [f, x] of changed) if (x.kind === 'production') lines.push(`[file] ${`+${x.a}`.padEnd(5)} ${`-${x.d}`.padEnd(5)} ${path.basename(f)}`);
fs.writeFileSync(path.join(RIG, 'out', 'head-facts.log'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
