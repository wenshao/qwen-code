// Source mutants for PR #12828, each run against the PR's own focused tests in
// an APFS clone (MUT_WT) of the head worktree. A mutant is KILLED when at least
// one test fails. Usage: MUT_WT=~/git/pr12828-mut node mut-unit.mjs [ids...]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const WT = process.env.MUT_WT;
const CLI = path.join(WT, 'packages/cli');
const SEL = 'src/serve/session-execution-engine-selector.ts';
const SRV = 'src/serve/server.ts';
const RQS = 'src/serve/run-qwen-serve.ts';
const HHP = 'src/serve/hosted-harness-profile.ts';
const CMD = 'src/commands/serve.ts';
const ERR = 'src/serve/server/error-response.ts';
const T = {
  sel: 'src/serve/session-execution-engine-selector.test.ts',
  wire: 'src/serve/paired-engine-host-wiring.test.ts',
  dflt: 'src/serve/server-default-bridge-wiring.test.ts',
  rqs: 'src/serve/run-qwen-serve.test.ts',
  hhp: 'src/serve/hosted-harness-profile.test.ts',
  cmd: 'src/commands/serve.test.ts',
  err: 'src/serve/server/error-response.test.ts',
};
const selTests = [T.sel, T.wire, T.dflt];
const M = [
  ['S01', 'deferred purposes ignored', SEL, 'if (!managed || isDeferredCreation(selection)) return', 'if (!managed) return', selTests],
  ['S02', 'daemonOwnedStandalone eligible', SEL, 'selection.daemonOwnedStandalone ||', 'false ||', selTests],
  ['S03', 'parentSessionId eligible', SEL, 'request.parentSessionId !== undefined ||', 'false ||', selTests],
  ['S04', 'worktree eligible', SEL, 'request.worktree !== undefined ||', 'false ||', selTests],
  ['S05', 'branch eligible', SEL, 'request.branch !== undefined ||', 'false ||', selTests],
  ['S06', 'non-default source eligible', SEL, "(request.sourceType !== 'default' || request.sourceId !== undefined)", '(request.sourceId !== undefined)', selTests],
  ['S07', 'default source with id eligible', SEL, "(request.sourceType !== 'default' || request.sourceId !== undefined)", "(request.sourceType !== 'default')", selTests],
  ['S08', 'no-source creation deferred', SEL, "(request.sourceType !== undefined &&\n      (request.sourceType !== 'default' || request.sourceId !== undefined))", "(request.sourceType !== 'default' || request.sourceId !== undefined)", selTests],
  ['S09', 'deferred evaluation selects managed', SEL, "return compatibility.status === 'compatible' ? 'managed' : 'legacy';", "return compatibility.status !== 'unknown' ? 'managed' : 'legacy';", selTests],
  ['S10', 'unknown evaluation selects managed', SEL, "return compatibility.status === 'compatible' ? 'managed' : 'legacy';", "return compatibility.status !== 'deferred' ? 'managed' : 'legacy';", selTests],
  ['S11', 'failed evaluation counts as compatible', SEL, "return { status: 'unknown', reason: 'the compatibility check failed' };", "return { status: 'compatible' };", selTests],
  ['S12', 'managed owner falls back to legacy without engine', SEL, "if (owner.engine === 'legacy') return 'legacy';", "if (owner.engine === 'legacy' || !managed) return 'legacy';", selTests],
  ['S13', 'managed owner ignores compatibility', SEL, "if (compatibility.status === 'compatible') return 'managed';", "return 'managed';", selTests],
  ['S14', 'incompatible managed owner falls back to legacy', SEL, "    if (compatibility.status === 'compatible') return 'managed';\n    throw new SessionExecutionEngineError(", "    if (compatibility.status === 'compatible') return 'managed';\n    if (1) return 'legacy';\n    throw new SessionExecutionEngineError(", selTests],
  ['S15', 'registered managed factory dropped', SEL, 'managed: options.managed?.factory ?? managedEngineUnavailable,', 'managed: managedEngineUnavailable,', selTests],
  ['S16', 'Managed-owned sub-session restored on Legacy (purpose re-checked on restore)', SEL, "if (owner.engine === 'legacy') return 'legacy';", "if (owner.engine === 'legacy' || selection.request.parentSessionId !== undefined) return 'legacy';", selTests],
  ['S16b', 'restore re-checks sourceType (equivalent: restore requests carry none)', SEL, "if (owner.engine === 'legacy') return 'legacy';", "if (owner.engine === 'legacy') return 'legacy';\n    if ((selection.request as { sourceType?: string }).sourceType !== undefined) return 'legacy';", selTests],
  ['S16c', 'Managed-owned standalone restore sent to Legacy', SEL, "if (owner.engine === 'legacy') return 'legacy';", "if (owner.engine === 'legacy' || selection.daemonOwnedStandalone) return 'legacy';", selTests],
  ['S17', 'deferred purposes still consult the engine', SEL, 'if (!managed || isDeferredCreation(selection)) return', "if (!managed) return 'legacy';\n      if (isDeferredCreation(selection)) { await checkCompatibility(managed, selection); return 'legacy'; }\n      if (false) return", selTests],
  ['V01', 'default Bridge drops injected Managed engine', SRV, 'managed: deps.managedExecutionEngine,', 'managed: undefined,', [T.dflt, T.wire]],
  ['V02', 'default Bridge ignores its spawn factory', SRV, 'legacy: channelFactory ?? defaultSpawnChannelFactory,', 'legacy: defaultSpawnChannelFactory,', [T.dflt, T.wire]],
  ['V03', 'default Bridge ignores the option', SRV, 'if (!opts.experimentalPairedEngines) {', 'if (true) {', [T.dflt, T.wire]],
  ['V04', 'default Bridge reads owners elsewhere', SRV, "      executionEngines: createPairedExecutionEngines({\n        legacy: channelFactory ?? defaultSpawnChannelFactory,\n        runtimeBaseDir: Storage.getRuntimeBaseDir(),", "      executionEngines: createPairedExecutionEngines({\n        legacy: channelFactory ?? defaultSpawnChannelFactory,\n        runtimeBaseDir: '/nonexistent-rig-storage',", [T.dflt, T.wire]],
  ['R01', 'primary ignores the option', RQS, "...(opts.experimentalPairedEngines\n          ? {\n              executionEngines: runtime.createPairedExecutionEngines({\n                legacy: channelFactory,", "...(false\n          ? {\n              executionEngines: runtime.createPairedExecutionEngines({\n                legacy: channelFactory,", [T.rqs]],
  ['R02', 'primary reads owners elsewhere', RQS, "legacy: channelFactory,\n                runtimeBaseDir: primarySessionRuntimeBaseDir,", "legacy: channelFactory,\n                runtimeBaseDir: '/nonexistent-rig-storage',", [T.rqs]],
  ['R03', 'secondary ignores the option', RQS, "...(opts.experimentalPairedEngines\n          ? {\n              executionEngines: runtime.createPairedExecutionEngines({\n                legacy: secondaryChannelFactory,", "...(false\n          ? {\n              executionEngines: runtime.createPairedExecutionEngines({\n                legacy: secondaryChannelFactory,", [T.rqs]],
  ['R04', 'secondary reads primary storage', RQS, 'runtimeBaseDir: secondaryEnv.sessionRuntimeBaseDir,\n              }),', 'runtimeBaseDir: primarySessionRuntimeBaseDir,\n              }),', [T.rqs]],
  ['R05', 'secondary uses primary factory', RQS, 'legacy: secondaryChannelFactory,', 'legacy: channelFactory,', [T.rqs]],
  ['R06', 'dynamic ignores the option', RQS, "...(opts.experimentalPairedEngines &&\n          provenance !== 'live-conversation'", "...(false &&\n          provenance !== 'live-conversation'", [T.rqs]],
  ['R07', 'dynamic reads primary storage', RQS, 'legacy: wsChannelFactory,\n                  runtimeBaseDir: wsEnv.sessionRuntimeBaseDir,', 'legacy: wsChannelFactory,\n                  runtimeBaseDir: primarySessionRuntimeBaseDir,', [T.rqs]],
  ['R08', 'dynamic uses primary factory', RQS, 'legacy: wsChannelFactory,\n                  runtimeBaseDir', 'legacy: channelFactory,\n                  runtimeBaseDir', [T.rqs]],
  ['R09', 'Conversations runtime paired', RQS, "...(opts.experimentalPairedEngines &&\n          provenance !== 'live-conversation'", '...(opts.experimentalPairedEngines', [T.rqs]],
  ['H01', 'Hosted accepts the option', HHP, 'if (opts.experimentalPairedEngines) {', 'if (false) {', [T.hhp, T.rqs]],
  ['L01', 'selector refusal not logged', ERR, "    // that cannot run here.\n    recordExpectedBridgeError(err, ctx, daemonLog);", "    // that cannot run here.", [T.err]],
  ['L02', 'child refusal (-32024 kind) not logged', ERR, "      if (kind === 'session_execution_engine_unavailable') {\n        recordExpectedBridgeError(\n          err instanceof Error ? err : new Error(errorMessage(err)),\n          ctx,\n          daemonLog,\n        );", "      if (kind === 'session_execution_engine_unavailable') {", [T.err]],
  ['P01', 'paired primary also turns the session shell off', RQS, "                legacy: channelFactory,\n                runtimeBaseDir: primarySessionRuntimeBaseDir,\n              }),\n            }", "                legacy: channelFactory,\n                runtimeBaseDir: primarySessionRuntimeBaseDir,\n              }),\n              sessionShellCommandEnabled: false,\n            }", [T.rqs]],
  ['P02', 'paired dynamic runtime drops childEnvOverrides', RQS, "                  legacy: wsChannelFactory,\n                  runtimeBaseDir: wsEnv.sessionRuntimeBaseDir,\n                }),\n              }", "                  legacy: wsChannelFactory,\n                  runtimeBaseDir: wsEnv.sessionRuntimeBaseDir,\n                }),\n                childEnvOverrides: {},\n              }", [T.rqs]],
  ['P03', 'paired default Bridge changes maxSessions', SRV, "        managed: deps.managedExecutionEngine,\n      }),\n    };", "        managed: deps.managedExecutionEngine,\n      }),\n      maxSessions: 1,\n    };", [T.dflt, T.wire]],
  ['C01', 'CLI drops the option', CMD, "...(argv['experimental-paired-engines']", '...(false', [T.cmd]],
];

const only = process.argv.slice(2);
const results = [];
for (const [id, desc, file, find, repl, tests] of M) {
  if (only.length && !only.includes(id)) continue;
  const abs = path.join(CLI, file);
  const orig = fs.readFileSync(abs, 'utf8');
  const n = orig.split(find).length - 1;
  if (n !== 1) { results.push({ id, desc, verdict: `ANCHOR x${n}` }); console.log(id, `ANCHOR x${n}`); continue; }
  fs.writeFileSync(abs, orig.replace(find, repl));
  const t0 = Date.now();
  let r;
  try {
    r = spawnSync('npx', ['vitest', 'run', ...tests], { cwd: CLI, encoding: 'utf8', timeout: 1_500_000, env: { ...process.env, CI: '1', NO_COLOR: '1', FORCE_COLOR: '0' } });
  } finally {
    fs.writeFileSync(abs, orig);
  }
  const out = ((r.stdout ?? '') + (r.stderr ?? '')).replace(/\x1b\[[0-9;]*m/g, '');
  const line = /^\s+Tests\s+(.*)$/m.exec(out)?.[1]?.trim() ?? 'NO TESTS LINE';
  const failed = [...out.matchAll(/^\s*(?:×|FAIL)\s+(.+)$/gm)].map((m) => m[1].trim()).filter((s) => !/^src\/.*\.ts\s*$/.test(s)).slice(0, 3);
  const verdict = r.status !== 0 && /failed/.test(line) ? 'KILLED' : r.status === 0 ? 'SURVIVED' : `ERROR(${r.status})`;
  results.push({ id, desc, verdict, tests: line, secs: Math.round((Date.now() - t0) / 1000), failed });
  console.log(id, verdict, line, `${Math.round((Date.now() - t0) / 1000)}s`, failed[0] ?? '');
  fs.writeFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), process.env.MUT_OUT ?? 'mut-unit.json'), JSON.stringify(results, null, 2));
}
