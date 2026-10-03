// VERIFICATION RIG ONLY (PR #13168 R2): round-3 mutation sample over the c9586fc guards.
// usage: MUT_TREE=<worktree> node mutate.mjs <id...|all|baseline>
// Each mutant replaces one unique anchor (fails closed when it is not unique), runs the listed
// vitest files from packages/cli, records failing test names, then restores the file byte-for-byte.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const TREE = process.env.MUT_TREE;
if (!TREE || !fs.existsSync(`${TREE}/packages/cli/src/generated`)) {
  console.error('MUT_TREE must point at a built worktree (packages/cli/src/generated present)');
  process.exit(2);
}
const OUT = process.env.MUT_OUT ?? '/Users/wenshao/pr13168-r2/out/mut-r3';
fs.mkdirSync(OUT, { recursive: true });
const S = 'src/serve/';
const TT = `${S}hosted-workspace-tool-turn.test.ts`;
const HS = `${S}hosted-harness-session.test.ts`;
const HM = `${S}hosted-harness-model.test.ts`;
const CW = `${S}managed-context-worker.test.ts`;
const PW = `${S}managed-runtime-provider-worker.test.ts`;
const PP = `${S}managed-runtime-provider-protocol.test.ts`;
const EX = `${S}managed-runtime-tool-executor.test.ts`;
const TURN = `${S}hosted-workspace-tool-turn.ts`;
const EXEC = `${S}managed-runtime-tool-executor.ts`;
const SESS = `${S}hosted-harness-session.ts`;
const MODEL = `${S}hosted-harness-model.ts`;
const PROT = `${S}managed-runtime-provider-protocol.ts`;
const WORK = `${S}managed-runtime-provider-worker.ts`;

const M = {
  N1: { file: EXEC, from: "const boundary = await fs.realpath(tools.directory);", to: "const boundary = await fs.realpath(tools.workspaceRoot ?? tools.directory);", tests: [CW, PW, EX], what: "context read boundary back to the mount root (R2 F1 / bot R3-2)" },
  N2: { file: TURN, from: "          if (this.context?.read() === undefined && signal)\n            await this.fetchWorkspaceContext(signal);\n          return;", to: "          return;", tests: [TT, HS], what: "takeover through the original broker: no context read (R3-1 early-return arm)" },
  N3: { file: TURN, from: "await this.acquire(true, signal);", to: "await this.acquire(true);", tests: [TT, HS], what: "recovery acquire without the turn signal (R3-1 acquire arm)" },
  N4: { file: SESS, from: "await toolTurn.resumeCommittedResults(abort.signal);\n          } catch (cause) {", to: "await toolTurn.resumeCommittedResults();\n          } catch (cause) {", tests: [HS], what: "ordinary-turn resume does not pass the signal" },
  N5: { file: SESS, from: "await toolTurn.resumeCommittedResults(abort.signal);\n          const result", to: "await toolTurn.resumeCommittedResults();\n          const result", tests: [HS], what: "continue-route resume does not pass the signal" },
  N6: { file: TURN, from: "        if (this.context?.read() === undefined && signal)\n          await this.fetchWorkspaceContext(signal);\n      }", to: "        if (!recovering && this.context?.read() === undefined && signal)\n          await this.fetchWorkspaceContext(signal);\n      }", tests: [TT, HS], what: "restore the !recovering gate (round-2 code)" },
  N7: { file: EXEC, from: "await realpathDeepestExisting(params['file_path'] as string),", to: "params['file_path'] as string,", tests: [CW, EX], what: "file_path containment compares the lexical target (R3-3 arm)" },
  N8: { file: EXEC, from: "path.join(\n                await realpathDeepestExisting(path.dirname(hit)),\n                path.basename(hit),\n              ),", to: "await realpathDeepestExisting(hit),", tests: [CW, EX], what: "glob output guard realpaths the hit itself (R3-4 round-2 code)" },
  N9: { file: TURN, from: "            braceExpand(pattern).some(", to: "            [pattern].some(", tests: [TT], what: "Harness glob gate without brace expansion (R1-4 Harness arm)" },
  N10: { file: EXEC, from: "          braceExpand(pattern).some(", to: "          [pattern].some(", tests: [CW, EX], what: "worker glob gate without brace expansion (R1-4 worker arm)" },
  N11: { file: EXEC, from: "      tail.unshift(path.basename(resolved));\n      resolved = parent;", to: "      return candidate;", tests: [CW, EX], what: "deepest-existing-ancestor walk removed (round-2 ENOENT fallback)" },
  N12: { file: TURN, from: "        if (this.context?.read() === undefined && signal)\n          await this.fetchWorkspaceContext(signal);\n      }", to: "        if (!this.context?.read() && signal)\n          await this.fetchWorkspaceContext(signal);\n      }", tests: [TT, HS], what: "latch: '' (no files) no longer suppresses the next read (bot R2-4; round-2 C8 on the new code)" },
};

const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
function run(tests, tag) {
  const r = spawnSync('npx', ['vitest', 'run', ...tests], {
    cwd: `${TREE}/packages/cli`,
    encoding: 'utf8',
    env: { ...process.env, PATH: `/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:${process.env.PATH}`, CI: '1' },
    maxBuffer: 256 * 1024 * 1024,
    timeout: 1_800_000,
  });
  const out = strip((r.stdout ?? '') + (r.stderr ?? ''));
  fs.writeFileSync(`${OUT}/${tag}.log`, out);
  const failed = [...new Set([...out.matchAll(/^ (?:FAIL|×) +(.+)$/gm)].map((m) => m[1].trim()))];
  const summary = (out.match(/Tests\s+([^\n]+)/) ?? [])[1] ?? `exit=${r.status}`;
  if (!/\d+ passed/.test(summary) && !/\d+ failed/.test(summary)) {
    console.error(`${tag}: no test summary (exit=${r.status}) — aborting; see ${OUT}/${tag}.log`);
    process.exit(3);
  }
  return { status: r.status, killed: /\d+ failed/.test(summary), failed: failed.slice(0, 12), summary };
}

const ids = process.argv.slice(2);
const list = ids.includes('all') ? Object.keys(M) : ids.filter((i) => i !== 'baseline');
const ledger = `${OUT}/ledger.jsonl`;
// A failure counts only when it reproduces on an immediate rerun of the same files: the
// hosted-harness-session suite has load flakes on this host (both arms pass them in isolation).
function confirmed(tests, tag) {
  const first = run(tests, tag);
  if (!first.killed) return first;
  const again = run(tests, `${tag}-rerun`);
  const both = first.failed.filter((f) => again.failed.includes(f));
  return { ...again, killed: again.killed && both.length > 0, failed: both, firstFailed: first.failed, summary: `${first.summary} / rerun: ${again.summary}` };
}
if (ids.includes('baseline')) {
  // The baseline covers exactly the suites the selected mutants will run.
  const files = [...new Set(list.flatMap((id) => M[id]?.tests ?? []))];
  const b = confirmed(files, 'baseline');
  fs.appendFileSync(ledger, JSON.stringify({ id: 'baseline', files, ...b, t: new Date().toISOString() }) + '\n');
  console.log(`baseline: ${b.summary} killed=${b.killed}`);
  if (b.killed) {
    console.error('baseline has failures — mutation results would be meaningless; aborting');
    process.exit(4);
  }
}
for (const id of list) {
  const m = M[id];
  const p = `${TREE}/packages/cli/${m.file}`;
  const orig = fs.readFileSync(p, 'utf8');
  const count = orig.split(m.from).length - 1;
  if (count !== 1) {
    console.log(`${id}: anchor matched ${count} times — skipped`);
    fs.appendFileSync(ledger, JSON.stringify({ id, skipped: `anchor x${count}` }) + '\n');
    continue;
  }
  fs.writeFileSync(p, orig.replace(m.from, m.to));
  try {
    // Staged: one suite at a time, cheapest first; stop at the first suite that kills.
    // Only failures in the session suite (load flakes on this host) need a reproducing rerun.
    let r;
    for (const t of m.tests) {
      r = run([t], `${id}-${t.split('/').pop()}`);
      if (r.killed && t === HS) {
        const again = run([t], `${id}-${t.split('/').pop()}-rerun`);
        const both = r.failed.filter((f) => again.failed.includes(f));
        r = { ...again, killed: again.killed && both.length > 0, failed: both, summary: `${r.summary} / rerun: ${again.summary}` };
      }
      r.suite = t;
      if (r.killed) break;
    }
    fs.appendFileSync(ledger, JSON.stringify({ id, what: m.what, tests: m.tests, ...r, t: new Date().toISOString() }) + '\n');
    console.log(`${id}: ${r.killed ? 'KILLED' : 'SURVIVED'} ${r.summary} — ${m.what}${r.failed.length ? ` | ${r.failed.slice(0, 3).join(' ; ')}` : ''}`);
  } finally {
    fs.writeFileSync(p, orig);
  }
}
