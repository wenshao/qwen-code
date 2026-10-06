// VERIFICATION RIG ONLY: round-6 mutation sample over #13166's c1bb0b2f81 (R9-1) and 0d6a6307ab (R10-1, R11-1..3).
// usage: MUT_TREE=<worktree> node mutate-r6.mjs <id|all|baseline> [...]
// Same contract as mutate.mjs: one unique anchor per mutant, restore byte-for-byte before anything
// else, and fail closed when a run never reaches a test summary.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const TREE = process.env.MUT_TREE;
if (!TREE || !fs.existsSync(`${TREE}/packages/cli/package.json`)) {
  console.error('MUT_TREE must point at a built worktree');
  process.exit(2);
}
const OUT = process.env.MUT_OUT ?? '/Users/wenshao/pr13166-rig/out/mut-r6';
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
  R9a: { pkg: CLI, file: WORKER, from: '        (root === undefined || ownDirectory !== root);', to: '        true;', tests: [CW], what: 'R9-1 revert: a root-bound caller treats the whole mount as its own estate' },
  R9b: { pkg: CLI, file: WORKER, from: '        if (root !== undefined && directory === root) continue;', to: '        if (contains(directory, ownDirectory)) continue;', tests: [CW], what: 'R9-1 revert: any ancestor binding is exempt (geometric exemption)' },
  R11c: { pkg: CLI, file: WORKER, from: '          (directory !== ownDirectory && contains(ownDirectory, directory))', to: '          false', tests: [CW], what: 'R11-3 revert: a Session nested inside the caller owns nothing against it' },
  STALE: { pkg: CLI, file: WORKER, from: '          if (ownEstate) continue;\n          return true;', to: '          return true;', tests: [CW], what: 'unlocatable binding vetoes the caller own estate' },
  R10a: { pkg: CLI, file: EXEC, from: '        let buildError: unknown;\n        try {\n          fileInvocation = sessionIdContext.run(sessionId, () =>\n            tool.build(params),\n          );\n        } catch (error) {\n          buildError = error;\n        }', to: '        let buildError: unknown;\n        fileInvocation = sessionIdContext.run(sessionId, () =>\n          tool.build(params),\n        );', tests: [CW, EX], what: 'R10-1 revert (file arm): build failure thrown before the boundary is judged' },
  R10b: { pkg: CLI, file: EXEC, from: '        let globBuildError: unknown;\n        try {\n          fileInvocation = sessionIdContext.run(sessionId, () =>\n            tool.build(params),\n          );\n        } catch (error) {\n          globBuildError = error;\n        }', to: '        let globBuildError: unknown;\n        fileInvocation = sessionIdContext.run(sessionId, () =>\n          tool.build(params),\n        );', tests: [CW, EX], what: 'R10-1 revert (glob arm): build failure thrown before the boundary is judged' },
  R11a: { pkg: CLI, file: EXEC, from: '          escapesSession(path.relative(realRoot, realResolved)) ||\n          (await this.ownsAnotherSessionDir?.(\n            tools.sessionId,\n            realResolved,\n            realRoot,\n          ))', to: '          escapesSession(path.relative(realRoot, realResolved))', tests: [CW, EX], what: 'R11-1 revert: glob input admission skips sibling ownership' },
  R11b: { pkg: CLI, file: EXEC, from: "        const requested =\n          typeof params['path'] === 'string' ? params['path'].trim() : '';\n        const resolved =", to: "        const requested =\n          typeof entry.input!['path'] === 'string' ? (entry.input!['path'] as string).trim() : '';\n        const resolved =", tests: [CW, EX], what: 'R11-2 revert: certify the raw path spelling, search the unescaped one' },
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
