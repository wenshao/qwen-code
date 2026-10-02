// VERIFICATION RIG ONLY: mutation sample over PR #13166's guards.
// usage: MUT_TREE=<worktree> node mutate.mjs <id|all|baseline> [...]
// Each mutant replaces one unique anchor, runs the listed vitest files from packages/cli,
// records failing test names, then restores the file byte-for-byte.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const TREE = process.env.MUT_TREE;
if (!TREE || !fs.existsSync(`${TREE}/packages/cli/package.json`)) {
  console.error('MUT_TREE must point at a built worktree');
  process.exit(2);
}
const OUT = process.env.MUT_OUT ?? '/Users/wenshao/pr13166-rig/out/mut';
fs.mkdirSync(OUT, { recursive: true });
const S = 'src/serve/';
const TT = `${S}hosted-workspace-tool-turn.test.ts`;
const HS = `${S}hosted-harness-session.test.ts`;
const CW = `${S}managed-context-worker.test.ts`;
const EX = `${S}managed-runtime-tool-executor.test.ts`;
const AP = `${S}hosted-tool-approval.test.ts`;
const TURN = `${S}hosted-workspace-tool-turn.ts`;
const EXEC = `${S}managed-runtime-tool-executor.ts`;
const SESS = `${S}hosted-harness-session.ts`;
const APPR = `${S}hosted-tool-approval.ts`;

const M = {
  H1: { file: TURN, from: '            path.isAbsolute(pattern) ||\n            pattern.split', to: '            pattern.split', tests: [TT], what: 'Harness: absolute pattern no longer refused pre-acquisition' },
  H2: { file: TURN, from: "            pattern.split(/[\\\\/]/).includes('..')\n          ) {", to: '            false\n          ) {', tests: [TT], what: "Harness: '..' pattern segment no longer refused pre-acquisition" },
  H3: { file: TURN, from: "                input['path'] = normalizeWorkspaceRelativePath(\n                  directory.trim(),\n                );", to: "                input['path'] = directory.trim();", tests: [TT], what: 'Harness: glob path not normalized/validated' },
  H4: { file: TURN, from: "              delete input['path'];", to: "              input['path'] = '..';", tests: [TT], what: 'Harness: blank path dispatched as ..' },
  H5: { file: TURN, from: "            input['pattern'] = pattern.trim();", to: '            void 0;', tests: [TT], what: 'Harness: untrimmed pattern dispatched' },
  H6: { file: TURN, from: 'export function isHostedWorkspaceSearchProfile(profile: unknown): boolean {\n  return (', to: 'export function isHostedWorkspaceSearchProfile(profile: unknown): boolean {\n  return true || (', tests: [TT, HS], what: '/1 profiles advertise glob' },
  H7: { file: TURN, from: '    profile === HOSTED_WORKSPACE_FILE_PROFILE_V2 ||\n    profile === HOSTED_WORKSPACE_SHELL_PROFILE_V2\n  );\n}\nexport function isRetryable', to: '    profile === HOSTED_WORKSPACE_FILE_PROFILE_V2\n  );\n}\nexport function isRetryable', tests: [TT, HS], what: 'shell/2 loses glob' },
  H8: { file: TURN, from: "          if (request.call.name === 'glob') {", to: '          if (true) {', tests: [TT], what: 'prefix truncation applied to every tool, not only glob' },
  H9: { file: TURN, from: '    if (fits(candidate)) return candidate;\n    lines.pop();', to: '    if (fits(candidate)) return candidate;\n    lines.splice(Math.floor(lines.length / 2));', tests: [TT], what: 'truncation drops half the lines per step (not longest prefix)' },
  H10: { file: TURN, from: '            const truncated = truncateHostedGlobResponse(converted, fits);', to: '            const truncated = undefined as Part[] | undefined;', tests: [TT], what: 'no glob truncation (falls to output-omitted path)' },
  W1: { file: EXEC, from: "        params['path'] = resolved;", to: '        void resolved;', tests: [CW, EX], what: 'worker: glob not pinned to the Session directory (searches includeDirectories)' },
  W2: { file: EXEC, from: '        if (path.isAbsolute(pattern) || pattern.split(/[\\\\/]/).includes(\'..\')) {', to: '        if (false) {', tests: [CW, EX], what: 'worker: pattern guard removed' },
  W3: { file: EXEC, from: '          await realpathIfPresent(root),\n          await realpathIfPresent(resolved),', to: '          root,\n          resolved,', tests: [CW, EX], what: 'worker: glob path containment lexical only (no realpath)' },
  W4: { file: EXEC, from: '        if (Array.isArray(resultPaths)) {', to: '        if (false && Array.isArray(resultPaths)) {', tests: [CW, EX], what: 'worker: output containment removed' },
  W5: { file: EXEC, from: '        result = relativizeGlobResult(result, root);', to: '        void relativizeGlobResult;', tests: [CW, EX], what: 'worker: results not relativized' },
  W6: { file: EXEC, from: "  if (typeof next.error?.message === 'string') {", to: "  if (false && typeof next.error?.message === 'string') {", tests: [CW, EX], what: 'worker: glob error.message not relativized' },
  W7: { file: EXEC, from: '            entry.toolName === GlobTool.Name && tools.directory !== undefined\n              ? relativizeGlobText(message, tools.directory)\n              : message,', to: '            message,', tests: [CW, EX], what: 'worker: thrown glob error not relativized' },
  W8: { file: EXEC, from: "          await realpathIfPresent(directory),\n          await realpathIfPresent(params['file_path'] as string),", to: "          directory,\n          params['file_path'] as string,", tests: [CW, EX], what: 'worker: read_file realpath containment removed (lexical only)' },
  W9: { file: EXEC, from: "  const tokenPrefix = new RegExp(`(?<![\\\\w./\\\\\\\\-])${escape(prefix)}`, 'g');", to: "  const tokenPrefix = new RegExp(escape(prefix), 'g');", tests: [CW, EX], what: 'relativize: token-start lookbehind removed' },
  W10: { file: EXEC, from: '  if (root === path.sep) return text;', to: '', tests: [CW, EX], what: "relativize: '/' root stand-down removed" },
  W11: { file: EXEC, from: '        new GlobTool(config),\n', to: '', tests: [CW, EX], what: 'worker: GlobTool not built into the tool set' },
  W12: { file: EXEC, from: '  GlobTool.Name,\n]);', to: ']);', tests: [CW, EX], what: 'worker: glob not admitted' },
  W13: { file: EXEC, from: "    `(?<![\\\\w./\\\\-])${escape(root)}(?![/\\\\w.-])`,", to: "    `${escape(root)}(?![/\\\\w.-])`,", tests: [CW, EX], what: 'relativize: bare-root leading boundary removed' },
  A1: { file: APPR, from: "  default: ['read_file', 'glob'],", to: "  default: ['read_file'],", tests: [AP, TT], what: 'approval: glob asks under default' },
  A2: { file: APPR, from: "  'auto-edit': ['read_file', 'write_file', 'edit', 'glob'],", to: "  'auto-edit': ['read_file', 'write_file', 'edit'],", tests: [AP, TT], what: 'approval: glob asks under auto-edit' },
  S1: { file: SESS, from: '                session.mcp,\n                session.toolProfile,\n                session.hooks,', to: '                session.mcp,\n                undefined,\n                session.hooks,', tests: [HS, TT], what: 'session: turn built without the profile (/2 behaves as /1)' },
  S2: { file: SESS, from: '        toolProfile === undefined &&\n        isHostedWorkspaceProfile(savedProfile)\n      )', to: "        toolProfile === undefined &&\n        isHostedWorkspaceProfile(savedProfile) && !String(savedProfile).endsWith('/2')\n      )", tests: [HS], what: 'session: reload without profile forgets a saved /2 profile' },
};

function run(tests, tag) {
  const r = spawnSync('npx', ['vitest', 'run', ...tests], {
    cwd: `${TREE}/packages/cli`,
    encoding: 'utf8',
    env: { ...process.env, PATH: `/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:${process.env.PATH}`, CI: '1' },
    maxBuffer: 256 * 1024 * 1024,
    timeout: 1_800_000,
  });
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  fs.writeFileSync(`${OUT}/${tag}.log`, out);
  const failed = [...new Set([...out.matchAll(/^ FAIL  (.+)$/gm)].map((m) => m[1].trim()))];
  const summary = (out.match(/Tests\s+([^\n]+)/) ?? [])[1] ?? `exit=${r.status}`;
  // Fail closed: a run that never reached the test summary is not evidence of anything.
  if (!/\d+ passed/.test(summary)) {
    console.error(`${tag}: no test summary (exit=${r.status}) — aborting; see ${OUT}/${tag}.log`);
    process.exit(3);
  }
  return { status: r.status, failed, summary };
}

const ids = process.argv.slice(2);
const list = ids.includes('all') ? Object.keys(M) : ids.filter((i) => i !== 'baseline');
const ledger = `${OUT}/ledger.jsonl`;
if (ids.includes('baseline')) {
  const files = [...new Set(Object.values(M).flatMap((m) => m.tests))];
  for (const f of files) {
    const b = run([f], `baseline-${f.split('/').pop()}`);
    fs.appendFileSync(ledger, JSON.stringify({ id: 'baseline', file: f, ...b, t: new Date().toISOString() }) + '\n');
    console.log(`baseline ${f}: ${b.summary} failed=${b.failed.length}`);
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
    const r = run(m.tests, id);
    fs.appendFileSync(ledger, JSON.stringify({ id, what: m.what, tests: m.tests, ...r, t: new Date().toISOString() }) + '\n');
    console.log(`${id}: ${r.summary} failed=${r.failed.length} — ${m.what}`);
  } finally {
    fs.writeFileSync(p, orig);
  }
}
