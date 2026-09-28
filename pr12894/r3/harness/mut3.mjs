import fs from 'node:fs';
import { execSync } from 'node:child_process';
const W = `${process.env.HOME}/git/qwen-code-pr12894-mut3`;
const MVN = `${process.env.S}/rig/mvn.sh`;
const T = {
  pub: `cd ${W}/packages/cli && npx vitest run src/serve/remote-shell-result-publication.test.ts 2>&1`,
  turn: `cd ${W}/packages/cli && npx vitest run src/serve/hosted-workspace-tool-turn.test.ts 2>&1`,
  broker: `cd ${W}/packages/cli && npx vitest run src/serve/hosted-workspace-broker.test.ts 2>&1`,
  store: `cd ${W}/packages/core && npx vitest run src/managed-runtime/http-managed-session-store.test.ts 2>&1`,
  shell: `cd ${W}/packages/core && npx vitest run src/services/shellExecutionService.test.ts 2>&1`,
  java: `cd ${W} && ${MVN} -o -f packages/sdk-java/managed-agent-server/pom.xml test -Dtest=ToolPublicationStoreTest,ToolPublicationControllerTest,ToolPublicationContractTest -Dsurefire.failIfNoSpecifiedTests=false -Dcheckstyle.skip 2>&1`,
};
const P = {
  pub: 'packages/cli/src/serve/remote-shell-result-publication.ts',
  turn: 'packages/cli/src/serve/hosted-workspace-tool-turn.ts',
  broker: 'packages/cli/src/serve/hosted-workspace-broker.ts',
  store: 'packages/core/src/managed-runtime/http-managed-session-store.ts',
  shell: 'packages/core/src/services/shellExecutionService.ts',
  tps: 'packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/store/ToolPublicationStore.java',
  tpds: 'packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/store/ToolPublicationDataStore.java',
  ctl: 'packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/api/ToolPublicationController.java',
};
const mutants = [
  ['M10 ingress client never retries', 'pub', P.pub, `const retryable = (failure: unknown): boolean =>\n      failure instanceof PublicationRejection`, `const retryable = (failure: unknown): boolean => false &&\n      failure instanceof PublicationRejection`],
  ['M11 no fence of expired OPEN grants', 'java', P.tps, `" WHERE tenant_key = ? AND state = 'OPEN' AND expires_at <= ?", tenantKey, writer.now());`, `" WHERE 1 = 0 AND tenant_key = ? AND state = 'OPEN' AND expires_at <= ?", tenantKey, writer.now());`],
  ['M12 finish digests the re-serialised JSON', 'java', P.tpds, `"Only a started pending capture can finish");\n        String digest = ToolPublicationContract.sha256(bytes);`, `"Only a started pending capture can finish");\n        bytes = result.toString().getBytes(StandardCharsets.UTF_8);\n        String digest = ToolPublicationContract.sha256(bytes);`],
  ['M13 range bounds not checked as integers', 'java', P.ctl, `if (!offset.isIntegralNumber() || !offset.canConvertToLong()\n                    || !length.isIntegralNumber() || !length.canConvertToInt()) {`, `if (false) {`],
  ['M14 capture preview head-only again', 'shell', P.shell, `rawCapture &&\n            isStreamingRawContent &&\n            totalOutputBytes > previewHeadBytes`, `false &&\n            isStreamingRawContent &&\n            totalOutputBytes > previewHeadBytes`],
  ['M15 worker spill path kept in Hosted preview', 'turn', P.turn, `if (!text.startsWith(TOOL_OUTPUT_TRUNCATED_PREFIX)) return text;`, `return text;`],
  ['M16 admission prepare not retried', 'turn', P.turn, `if (!uncertain || attempt === 2) throw error;`, `throw error;`],
  ['M17 history id random again', 'turn', P.turn, `messageId = shellHistoryId(executionCallId);`, `messageId = randomUUID();`],
  ['M18 receipt commit not retried', 'store', P.store, `if (!uncertain || attempt === 2) throw error;`, `throw error;`],
  ['M19 uncertain v3 start never re-sent', 'broker', P.broker, `if (preparedObservations >= 10) {`, `if (false) {`],
];
const run = (kind) => {
  let out = '', ok = true;
  try { out = execSync(T[kind], { encoding: 'utf8', maxBuffer: 64 << 20, shell: '/bin/bash' }); } catch (e) { ok = false; out = (e.stdout ?? '') + (e.stderr ?? ''); }
  const line = kind === 'java' ? (out.match(/Tests run: \d+, Failures: \d+, Errors: \d+, Skipped: \d+(?![\s\S]*Tests run:)/) ?? ['? ' + out.slice(-200)])[0] : (out.match(/Tests\s+\d+[^\n]*/g) ?? ['? ' + out.slice(-200)]).at(-1);
  return { ok, line };
};
for (const k of Object.keys(T)) { const r = run(k); console.log(`baseline ${k}: ${r.ok ? 'PASS' : 'FAIL'} ${r.line}`); }
for (const [label, kind, file, from, to] of mutants) {
  const p = `${W}/${file}`; const src = fs.readFileSync(p, 'utf8');
  if (!src.includes(from)) { console.log(`${label}: anchor not found`); continue; }
  fs.writeFileSync(p, src.replace(from, to)); const r = run(kind); fs.writeFileSync(p, src);
  console.log(`${label}: ${r.ok ? 'SURVIVED' : 'KILLED'} (${kind}: ${r.line})`);
}
execSync(`cd ${W} && git status --short`, { stdio: 'inherit' });
