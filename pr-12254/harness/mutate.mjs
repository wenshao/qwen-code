// PR #12254 — in-place mutation sweep against the PR's own unit tests.
// Each mutant: edit one production line, run the focused suites, restore from the in-memory original.
// Usage: node mutate.mjs <out-dir>
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import * as path from 'node:path';

const OUT = path.resolve(process.argv[2] ?? '/root/verify/pr12254-harness/out');
const WT = '/root/verify/pr12254-head';
const CLI = path.join(WT, 'packages/cli');
const SDK = path.join(WT, 'packages/sdk-typescript');
const ROUTE = 'packages/cli/src/serve/routes/session-catalog.ts';
const LIST = 'packages/cli/src/serve/server/session-list.ts';
const SEL = 'packages/cli/src/serve/workspace-route-runtime.ts';
const RATE = 'packages/cli/src/serve/rate-limit.ts';
const TEL = 'packages/cli/src/serve/server/telemetry.ts';
const CLIENT = 'packages/sdk-typescript/src/daemon/DaemonClient.ts';
const CLI_TESTS = ['src/serve/routes/session-catalog.test.ts', 'src/serve/server/session-list.test.ts', 'src/serve/workspace-route-runtime.test.ts', 'src/serve/rate-limit.test.ts', 'src/serve/server/telemetry.test.ts', 'src/serve/server/telemetry-catalog.test.ts'];
const SDK_TESTS = ['test/unit/DaemonClient.test.ts', 'test/unit/daemon-public-surface.test.ts'];

const M = [
  ['R01', ROUTE, 'post-read generation re-check removed', '        if (!isCurrent()) return unavailable();\n        const result: CatalogMember = {', '        const result: CatalogMember = {'],
  ['R02', ROUTE, 'untrusted-primary 403 gate removed', 'if (runtime.primary && !runtime.trusted) {', 'if (false as boolean) {'],
  ['R03', ROUTE, 'untrusted secondary merges live state', 'mergeLive: runtime.trusted,', 'mergeLive: true,'],
  ['R04', ROUTE, 'untrusted read keeps debug-log session', '        const page = await (runtime.trusted\n          ? read()\n          : runWithoutDebugLogSession(read));', '        const page = await read();'],
  ['R05', ROUTE, '512 KiB member cap removed', 'if (Buffer.byteLength(JSON.stringify(result)) > MAX_MEMBER_BYTES) {', 'if (Buffer.byteLength(JSON.stringify(result)) > Infinity) {'],
  ['R06', ROUTE, 'read concurrency 4 → 20', 'const READ_CONCURRENCY = 4;', 'const READ_CONCURRENCY = 20;'],
  ['R07', ROUTE, '"all" > 20 no longer rejected', 'if (selections.length > MAX_WORKSPACES) {', 'if (selections.length > Infinity) {'],
  ['R08', ROUTE, 'session.workspaceCwd not normalized to the owner', '            workspaceCwd: runtime.workspaceCwd,\n          })),', '          })),'],
  ['R09', ROUTE, 'paginateMerged: true → false', 'paginateMerged: true,', 'paginateMerged: false,'],
  ['R10', ROUTE, 'queued members still start after abort', '              !controller.signal.aborted &&\n', ''],
  ['R11', ROUTE, 'abort signal not passed to the read', '                    signal: controller.signal,\n', ''],
  ['R12', ROUTE, 'group_not_found mapped to 400 instead of 404', "code === 'group_not_found'\n            ? 404", "code === 'group_not_found'\n            ? 400"],
  ['R13', ROUTE, 'groups re-read instead of reusing the page snapshot', '(page.groups ??\n                    (await createSessionOrganizationService(\n                      runtime.workspaceCwd,\n                    ).listGroups()))', '(await createSessionOrganizationService(\n                      runtime.workspaceCwd,\n                    ).listGroups())'],
  ['R14', ROUTE, 'generation-id comparison removed from isCurrent', '        entry.current?.generationId === generation?.generationId &&\n', ''],
  ['R15', ROUTE, 'registry identity check removed from isCurrent', '        workspaceRegistry.getEntryByWorkspaceId(entry.workspaceId) === entry &&\n', ''],
  ['R16', ROUTE, 'guard.closed check removed from isCurrent', '        generation !== undefined &&\n        !generation.guard.closed;', '        generation !== undefined;'],
  ['R17', ROUTE, 'entry.state === active check removed', "        entry.state === 'active' &&\n", ''],
  ['R18', ROUTE, 'group without organized view accepted', "(options.group !== undefined && options.view !== 'organized') ||", '(false as boolean) ||'],
  ['R19', ROUTE, 'unknown workspace returns an empty page instead of 404', "        return failedMember(\n          workspace,\n          undefined,\n          404,", "        return { workspace, sessions: [] } as unknown as CatalogMember;\n        return failedMember(\n          workspace,\n          undefined,\n          404,"],
  ['R20', ROUTE, 'runtime storage scope dropped (reads run in ambient storage)', 'runWithWorkspaceRuntimeStorage(runtime, async () => {', '(async (_r: unknown, f: () => Promise<unknown>) => f())(runtime, async () => {'],
  ['L01', LIST, 'live-only rows first-page-only even when paginateMerged', '(isFirstPage || readOptions.paginateMerged) &&', 'isFirstPage &&'],
  ['L02', LIST, 'organized cursor mode binding removed', '      ((parsed as OrganizedCursor).paginateMerged !== undefined &&\n        (parsed as OrganizedCursor).paginateMerged !==\n          expected.paginateMerged) ||\n', ''],
  ['L03', LIST, 'organized cursor family binding removed', "      ((parsed as OrganizedCursor).catalogKind !== undefined &&\n        (parsed as OrganizedCursor).catalogKind !== 'organized') ||\n", ''],
  ['L04', LIST, 'metadata cursor family binding removed', "      ((parsed as { catalogKind?: unknown }).catalogKind !== undefined &&\n        (parsed as { catalogKind?: unknown }).catalogKind !== 'metadata') ||\n", ''],
  ['L05', LIST, 'metadata cursor mode binding removed', '      ((parsed as { paginateMerged?: unknown }).paginateMerged !== undefined &&\n        (parsed as { paginateMerged?: unknown }).paginateMerged !==\n          expected.paginateMerged) ||\n', ''],
  ['L06', LIST, 'paginateMerged no longer routes unfiltered reads to the merged paginator', '    readOptions.paginateMerged ||\n    options?.parentSessionId !== undefined ||', '    options?.parentSessionId !== undefined ||'],
  ['L07', LIST, 'organized result omits the snapshot group catalog', '    ...(readOptions.includeGroups\n      ? {', '    ...((false as boolean)\n      ? {'],
  ['L08', LIST, 'invalid-cursor kind discriminator reverted', "expected.parentSessionId !== undefined ? 'parent' : 'metadata',", "expected.sourceType === undefined ? 'parent' : 'metadata',"],
  ['S01', SEL, 'relative selectors no longer rejected by the shared resolver', '  if (!isPortableAbsolutePath(selector)) return undefined;\n', ''],
  ['Q01', RATE, 'batch POST falls into the mutation tier', "  if (method === 'POST' && /^\\/sessions\\/catalog$/i.test(p)) return 'read';\n", ''],
  ['T01', TEL, 'telemetry route entry removed', "  {\n    method: 'POST',\n    path: '/sessions/catalog',\n    attribution: 'handler_resolved',\n    route: 'POST /sessions/catalog',\n  },\n", ''],
  ['K01', CLIENT, 'SDK sends pageSize instead of size', ': { ...options, size: pageSize },', ': { ...options, pageSize },'],
  ['K02', CLIENT, 'SDK does not forward signal', "        mode: 'rest',\n        signal: opts?.signal,\n        timeoutMs: opts?.timeoutMs,", "        mode: 'rest',\n        timeoutMs: opts?.timeoutMs,"],
  ['K03', CLIENT, 'SDK does not forward timeoutMs', "        signal: opts?.signal,\n        timeoutMs: opts?.timeoutMs,\n      },\n    );\n  }\n\n  /**\n   * Search user/assistant", "        signal: opts?.signal,\n      },\n    );\n  }\n\n  /**\n   * Search user/assistant"],
  ['K04', CLIENT, 'SDK leaks transport options into the JSON body', '          ...request,\n          options:', '          ...request,\n          ...opts,\n          options:'],
];

mkdirSync(OUT, { recursive: true });
const results = [];
function run(file) {
  const isSdk = file.startsWith('packages/sdk-typescript');
  const cwd = isSdk ? SDK : CLI;
  const tests = isSdk ? SDK_TESTS : CLI_TESTS;
  const json = path.join(OUT, 'mut-last.json');
  const r = spawnSync('npx', ['vitest', 'run', ...tests, '--reporter=json', `--outputFile=${json}`], { cwd, env: { ...process.env, CI: 'true' }, encoding: 'utf8', timeout: 240_000 });
  try {
    const j = JSON.parse(readFileSync(json, 'utf8'));
    const failed = j.testResults.flatMap((t) => t.assertionResults.filter((a) => a.status === 'failed').map((a) => `${path.basename(t.name)} › ${a.title}`));
    const suiteErr = j.testResults.filter((t) => t.status === 'failed' && t.assertionResults.length === 0).map((t) => `${path.basename(t.name)} (suite error)`);
    return { exit: r.status, total: j.numTotalTests, failed: [...failed, ...suiteErr] };
  } catch {
    return { exit: r.status, total: 0, failed: ['<no json: ' + (r.stderr ?? '').slice(-300) + '>'] };
  }
}

// control
for (const f of [ROUTE, CLIENT]) {
  const c = run(f);
  console.log(`CONTROL ${f.split('/')[1]}: ${c.total} tests, ${c.failed.length} failed`);
  if (c.failed.length) throw new Error('control not green: ' + c.failed.join('; '));
}

for (const [id, file, desc, from, to] of M) {
  const abs = path.join(WT, file);
  const original = readFileSync(abs, 'utf8');
  const count = original.split(from).length - 1;
  if (count !== 1) {
    console.log(`${id} SKIP (anchor matched ${count}×): ${desc}`);
    results.push({ id, file, desc, status: 'anchor-miss', count });
    continue;
  }
  copyFileSync(abs, path.join(OUT, 'mut-backup.ts'));
  try {
    writeFileSync(abs, original.replace(from, to));
    const r = run(file);
    const killed = r.failed.length > 0;
    results.push({ id, file, desc, status: killed ? 'killed' : 'SURVIVED', failedCount: r.failed.length, firstFailures: r.failed.slice(0, 3) });
    console.log(`${id} ${killed ? 'killed  ' : 'SURVIVED'} ${desc}${killed ? `  (${r.failed.length} failing: ${r.failed[0]})` : ''}`);
  } finally {
    writeFileSync(abs, original);
  }
}
const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: WT, encoding: 'utf8' }).trim();
console.log(dirty ? `TREE DIRTY:\n${dirty}` : 'tracked tree clean after sweep');
writeFileSync(path.join(OUT, 'mutation.json'), JSON.stringify(results, null, 2));
const k = results.filter((r) => r.status === 'killed').length;
const sv = results.filter((r) => r.status === 'SURVIVED').length;
console.log(`\n${k} killed, ${sv} survived, ${results.length - k - sv} skipped of ${results.length}`);
