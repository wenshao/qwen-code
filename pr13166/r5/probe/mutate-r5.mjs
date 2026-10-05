// VERIFICATION RIG ONLY: round-5 mutation sample over #13166's new commits (worker-thread deadline,
// symlinked search roots, stale sibling bindings, search-profile approval).
// usage: MUT_TREE=<worktree> node mutate-r5.mjs <id|all|baseline> [...]
// Same contract as mutate.mjs: one unique anchor per mutant, restore byte-for-byte before anything
// else, and fail closed when a run never reaches a test summary.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const TREE = process.env.MUT_TREE;
if (!TREE || !fs.existsSync(`${TREE}/packages/cli/package.json`)) {
  console.error('MUT_TREE must point at a built worktree');
  process.exit(2);
}
const OUT = process.env.MUT_OUT ?? '/Users/wenshao/pr13166-rig/out/mut-r5';
fs.mkdirSync(OUT, { recursive: true });
const CORE = 'core', CLI = 'cli';
const GT = 'src/tools/glob.test.ts';
const GW = 'src/tools/glob-search-worker.test.ts';
const CW = 'src/serve/managed-context-worker.test.ts';
const EX = 'src/serve/managed-runtime-tool-executor.test.ts';
const AP = 'src/serve/hosted-tool-approval.test.ts';
const TT = 'src/serve/hosted-workspace-tool-turn.test.ts';
const GLOB = 'src/tools/glob.ts';
const SEARCH = 'src/tools/glob-search.ts';
const EXEC = 'src/serve/managed-runtime-tool-executor.ts';
const WORKER = 'src/serve/managed-context-worker.ts';
const APPR = 'src/serve/hosted-tool-approval.ts';

const M = {
  G1: { pkg: CORE, file: GLOB, from: '      await worker.terminate();', to: '      void worker;', tests: [GT, GW], what: 'deadline: worker thread never terminated' },
  G2: { pkg: CORE, file: GLOB, from: '            timeoutMs,\n          );', to: '            timeoutMs * 1000,\n          );', tests: [GT, GW], what: 'deadline: timer 1000x longer' },
  G3: { pkg: CORE, file: GLOB, from: "          signal.addEventListener('abort', onAbort, { once: true });\n          if (signal.aborted) onAbort();", to: '', tests: [GT, GW], what: 'deadline: abort signal not wired to the worker run' },
  G4: { pkg: CORE, file: GLOB, from: '    if (timeoutMs === undefined) {', to: '    if (true) {', tests: [GT, GW], what: 'deadline: always runs in-thread (no worker)' },
  G5: { pkg: CORE, file: SEARCH, from: '      : (realpathOf(requestedSearchDir) ?? requestedSearchDir);', to: '      : requestedSearchDir;', tests: [GT, GW], what: 'symlink root: search dir not realpathed (follow:false walks nothing)' },
  G6: { pkg: CORE, file: SEARCH, from: '      searchDir === requestedSearchDir\n        ? entry', to: '      true\n        ? entry', tests: [GT, GW], what: 'symlink root: output spelled canonically, not as requested' },
  G7: { pkg: CORE, file: SEARCH, from: '      outputBase = containmentRoot;\n      canonicalBase = root;', to: '      void 0;', tests: [GT, GW], what: '268ea8f876 revert: climbing hit not anchored at the Session root' },
  G8: { pkg: CORE, file: SEARCH, from: '      : (realpathOf(containmentRoot) ?? containmentRoot);', to: '      : containmentRoot;', tests: [GT, GW], what: 'symlink root: containment root not realpathed' },
  E1: { pkg: CLI, file: EXEC, from: '          executionTimeoutMs: 5_000,\n', to: '', tests: [CW, EX], what: 'Hosted glob built without the deadline' },
  C1: { pkg: CLI, file: WORKER, from: '  } catch {\n    return occupied;\n  }', to: '  } catch {\n    return undefined;\n  }', tests: [CW], what: '77abbc3ce7 revert: resolution error vetoes every outside read' },
  C2: { pkg: CLI, file: WORKER, from: '        if (contains(directory, ownDirectory)) continue;\n', to: '', tests: [CW], what: 'ancestor binding (cwd ".") no longer skipped' },
  C3: { pkg: CLI, file: WORKER, from: '  if (resolved !== undefined) return resolved;\n  const root = await mount.rootDirectory();', to: '  if (resolved !== undefined) return resolved;\n  return undefined;\n  const root = await mount.rootDirectory();', tests: [CW], what: 'stale binding falls back to "cannot locate" (vetoes every outside read)' },
  C4: { pkg: CLI, file: WORKER, from: '        pinned !== undefined &&\n        (pinned.dev !== stats.dev || pinned.ino !== stats.ino)', to: '        false', tests: [CW], what: 'mount root identity (dev/ino) not checked for stale-binding location' },
  A1: { pkg: CLI, file: APPR, from: '    !(searchProfile && SEARCH_PREAPPROVED_TOOLS.includes(toolName))', to: '    !SEARCH_PREAPPROVED_TOOLS.includes(toolName)', tests: [AP, TT], what: 'glob pre-approved on /1 profiles too' },
  A2: { pkg: CLI, file: APPR, from: "const SEARCH_PREAPPROVED_TOOLS: readonly string[] = ['glob'];", to: 'const SEARCH_PREAPPROVED_TOOLS: readonly string[] = [];', tests: [AP, TT], what: 'glob asks on /2 profiles' },
};

function run(pkg, tests, tag) {
  const r = spawnSync('npx', ['vitest', 'run', ...tests], {
    cwd: `${TREE}/packages/${pkg}`,
    encoding: 'utf8',
    env: { ...process.env, PATH: `/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:${process.env.PATH}`, CI: '1' },
    maxBuffer: 256 * 1024 * 1024,
    timeout: 1_800_000,
  });
  const out = ((r.stdout ?? '') + (r.stderr ?? '')).replace(/\x1b\[[0-9;]*m/g, '');
  fs.writeFileSync(`${OUT}/${tag}.log`, out);
  const failed = [...new Set([...out.matchAll(/^ (?:FAIL|×) +(.+?)(?: \d+ms)?$/gm)].map((m) => m[1].replace(/^src\/[^ ]+ > /, '').trim()))];
  const summary = (out.match(/Tests\s+([^\n]+)/) ?? [])[1] ?? `exit=${r.status}`;
  if (!/\d+ passed/.test(summary)) return { status: r.status, failed, summary, invalid: true };
  return { status: r.status, failed, summary };
}

const ids = process.argv.slice(2);
const list = ids.includes('all') ? Object.keys(M) : ids.filter((i) => i !== 'baseline');
const ledger = `${OUT}/ledger.jsonl`;
if (ids.includes('baseline')) {
  const groups = new Map();
  for (const m of Object.values(M)) groups.set(`${m.pkg}:${m.tests.join(',')}`, m);
  for (const [key, m] of groups) {
    const b = run(m.pkg, m.tests, `baseline-${key.replace(/[^\w]+/g, '_')}`);
    if (b.invalid) { console.error(`baseline ${key}: no test summary — aborting`); process.exit(3); }
    fs.appendFileSync(ledger, JSON.stringify({ id: 'baseline', key, ...b, t: new Date().toISOString() }) + '\n');
    console.log(`baseline ${key}: ${b.summary} failed=${b.failed.length}`);
  }
}
for (const id of list) {
  const m = M[id];
  const p = `${TREE}/packages/${m.pkg}/${m.file}`;
  const orig = fs.readFileSync(p, 'utf8');
  const count = orig.split(m.from).length - 1;
  if (count !== 1) {
    console.log(`${id}: anchor matched ${count} times — skipped`);
    fs.appendFileSync(ledger, JSON.stringify({ id, skipped: `anchor x${count}` }) + '\n');
    continue;
  }
  fs.writeFileSync(p, orig.replace(m.from, m.to));
  let r;
  try {
    r = run(m.pkg, m.tests, id);
    fs.appendFileSync(ledger, JSON.stringify({ id, what: m.what, tests: m.tests, ...r, t: new Date().toISOString() }) + '\n');
    console.log(`${id}: ${r.summary} failed=${r.failed.length} — ${m.what}`);
  } finally {
    fs.writeFileSync(p, orig);
  }
  if (r?.invalid) { console.error(`${id}: no test summary (exit=${r.status}) — restored, aborting; see ${OUT}/${id}.log`); process.exit(3); }
}
