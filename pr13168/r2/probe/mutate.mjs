// VERIFICATION RIG ONLY (PR #13168 R2): mutation sample over this PR's own guards.
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
const OUT = process.env.MUT_OUT ?? '/Users/wenshao/pr13168-r2/out/mut';
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
  C1: { file: TURN, from: 'const files = await waitForTurn(this.broker.workspaceContext(), signal);', to: 'const files = await this.broker.workspaceContext();', tests: [TT, HS], what: 'cancel: the context read is no longer abortable (round-1 code)' },
  C2: { file: TURN, from: '      await this.acquire(false, signal);\n    }\n    if (signal.aborted) {\n      this.uncertain = false;\n      signal.throwIfAborted();\n    }', to: '      await this.acquire(false, signal);\n    }', tests: [TT, HS], what: 'cancel: no post-acquisition abort check (batch may dispatch after cancel)' },
  C3: { file: TURN, from: '      // latch it: the slot stays undefined and a later turn retries.\n      if (signal.aborted) return;', to: '      // latch it: the slot stays undefined and a later turn retries.', tests: [TT, HS], what: 'latch: an aborted read still writes the slot' },
  C4: { file: TURN, from: 'if (!recovering && this.context?.read() === undefined && signal)', to: 'if (!recovering && signal)', tests: [TT, HS], what: 'once: the read repeats on every acquisition' },
  C5: { file: TURN, from: 'if (!recovering && this.context?.read() === undefined && signal)', to: 'if (this.context?.read() === undefined && signal)', tests: [TT, HS], what: 'recovery: a recovering acquisition also reads' },
  C6: { file: TURN, from: '          .filter(({ text }) => text)\n', to: '', tests: [TT], what: 'assembly: blank files contribute an empty section' },
  C7: { file: TURN, from: '          .map(({ name, text }) => ({ name, text: text.trim() }))\n', to: '', tests: [TT], what: 'assembly: file text not trimmed' },
  C8: { file: TURN, from: 'if (!recovering && this.context?.read() === undefined && signal)', to: 'if (!recovering && !this.context?.read() && signal)', tests: [TT, HS], what: "latch: '' (no files) no longer suppresses the next read (bot R2-4)" },
  H2: { file: MODEL, from: 'if (contextAvailable && contextAvailable !== injectedContext) {', to: 'if (contextAvailable) {', tests: [HM], what: 'model: inject+refresh on every round (dedup removed; bot deferred item)' },
  X1: { file: EXEC, from: 'const boundary = await fs.realpath(tools.workspaceRoot ?? tools.directory);', to: 'const boundary = tools.workspaceRoot ?? tools.directory;', tests: [PW, CW, EX], what: 'worker: boundary not realpathed (round-1 F1)' },
  X2: { file: EXEC, from: "          path.isAbsolute(rel)\n        )\n          continue;\n        text = await fs.readFile(real, 'utf8');", to: "          path.isAbsolute(rel)\n        )\n          void 0;\n        text = await fs.readFile(real, 'utf8');", tests: [PW, CW, EX], what: 'worker: outward symlink no longer skipped' },
  X3: { file: EXEC, from: '      if (text.length > MANAGED_WORKSPACE_CONTEXT_FILE_CHARS) {', to: '      if (false) {', tests: [PW, CW, EX], what: 'worker: no per-file cap' },
  X4: { file: EXEC, from: 'const real = await fs.realpath(path.join(tools.directory, name));', to: 'const real = await fs.realpath(path.join(tools.workspaceRoot ?? tools.directory, name));', tests: [PW, CW, EX], what: 'worker: reads the mount root instead of the Session directory (ancestor discovery)' },
  X5: { file: EXEC, from: 'const boundary = await fs.realpath(tools.workspaceRoot ?? tools.directory);', to: 'const boundary = await fs.realpath(tools.directory);', tests: [PW, CW, EX], what: 'CANDIDATE: boundary = Session directory (expected to survive unless a test pins Workspace-wide links)' },
  W1: { file: WORK, from: "    if (operation.kind === 'workspace-context')\n      return this.executor.readWorkspaceContext(identity.runtimeSessionId);\n", to: '', tests: [PW, CW], what: 'worker route: workspace-context not served' },
  P1: { file: PROT, from: '          index < next ||', to: '          index < 0 ||', tests: [PP], what: 'protocol: file order / duplicates not enforced' },
  P2: { file: PROT, from: "          file['text'].length > MANAGED_WORKSPACE_CONTEXT_FILE_CHARS", to: '          false', tests: [PP], what: 'protocol: oversized text accepted' },
  P3: { file: PROT, from: "    case 'history':\n    case 'workspace-context':\n      keys(op, ['kind']);", to: "    case 'history':\n      keys(op, ['kind']);\n      break;\n    case 'workspace-context':", tests: [PP], what: 'protocol: workspace-context operation shape not closed' },
  H1: { file: MODEL, from: '        await client.refreshSystemInstruction();\n', to: '', tests: [HM], what: 'model: no system-instruction refresh (context never reaches the wire)' },
  S1: { file: SESS, from: '            modelScope,\n            workspaceContext,\n', to: '            modelScope,\n', tests: [HS, HM], what: 'session: ordinary turn does not pass the slot to the model turn' },
  S2: { file: SESS, from: '            signal: abort.signal,\n            workspaceContext,\n            toolTurn,\n', to: '            signal: abort.signal,\n            toolTurn,\n', tests: [HS], what: 'session: continue route does not pass the slot to the model turn' },
  S3: { file: SESS, from: '            profile: session.toolProfile,\n            context: workspaceContext,\n          },\n        );', to: '            profile: session.toolProfile,\n          },\n        );', tests: [HS], what: 'session: continue route tool turn has no context slot' },
  S4: { file: SESS, from: '                  profile: session.toolProfile,\n                  context: workspaceContext,', to: '                  profile: session.toolProfile,', tests: [HS, TT], what: 'session: ordinary tool turn has no context slot (feature off)' },
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
