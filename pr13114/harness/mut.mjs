// PR #13114 mutation driver. usage: node mut.mjs <ts|java> [ids...]
import fs from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
const W = '/Users/wenshao/git/qwen-code-pr13114-mut';
const SP = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/e298c115-72d4-4be7-89e8-481e9f912a53/scratchpad';
const TS = 'packages/cli/src/serve/remote-shell-result-publication.ts';
const DS = 'packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/store/ToolPublicationDataStore.java';
const CF = 'packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/config/ToolPublicationConfiguration.java';
const ts = [
  ['T1', 'claim_expired not resumable', TS, "        'managed_tool_publication_claim_expired',\n", ''],
  ['T2', 'claim_lost not resumable', TS, "        'managed_tool_publication_claim_lost',\n", ''],
  ['T3', 'operation_expired not resumable', TS, "        'managed_tool_publication_operation_expired',\n        'managed_tool_publication_claim_expired',", "        'managed_tool_publication_claim_expired',"],
  ['T4', '409 busy not retryable', TS, "          failure.status >= 500 ||\n          (failure.status === 409 &&\n            failure.code === 'managed_tool_publication_busy')", "          failure.status >= 500"],
  ['T5', 'busy /recover consumes an attempt (drop recoveries--)', TS, "              recoveries--;", "              void 0;"],
  ['T6', 'no wait after a failed /recover', TS, "              recoveries--;\n            await new Promise((resolve) => setTimeout(resolve, 250));", "              recoveries--;"],
  ['T7', 'any 409 is resumable (code ignored)', TS, "      failure.status === 409 &&\n      [", "      failure.status === 409 ||\n      ["],
  ['T8', '429 busy /recover consumes an attempt', TS, "[409, 429].includes(failure.status) &&", "[409].includes(failure.status) &&"],
];
const java = [
  ['J1', 'claim_expired back to 400 invalid_request', DS, 'requireContract(row.claimUntil() != null && row.claimUntil().after(current), HttpStatus.CONFLICT,\n                "managed_tool_publication_claim_expired", "Publication operation claim expired");', 'require(row.claimUntil() != null && row.claimUntil().after(current), "Publication operation claim expired");'],
  ['J2', 'in-flight deadline check dropped (claim_expired reported instead)', DS, '        Operation row = rows.get(0);\n        requireUnexpired(row.deadline(), current);', '        Operation row = rows.get(0);'],
  ['J3', 'no byte-aware window (base timeout only)', DS, '        if (!"terminal".equals(slot) && !slot.startsWith("seal:") && !slot.startsWith("prefix:")) {\n            return operationTimeout;', '        if (true) {\n            return operationTimeout;'],
  ['J4', 'recovery_deadline uses base timeout', DS, 'new Timestamp(current.getTime() + verificationWindow(scope, publicationId,\n                            row.slot()).toMillis())', 'new Timestamp(current.getTime() + operationTimeout.toMillis())'],
  ['J5', 'no heartbeat in page traversal', DS, '        for (JsonNode pageReference : body.path("pages")) {\n            heartbeat.run();', '        for (JsonNode pageReference : body.path("pages")) {'],
  ['J6', 'no heartbeat in segment traversal', DS, '            for (JsonNode segment : page.path("segments")) {\n                heartbeat.run();', '            for (JsonNode segment : page.path("segments")) {'],
  ['J7', 'no startup capacity check', CF, '        budget.timeout(settings.getOperationTimeout(), Math.addExact(', '        if (false) budget.timeout(settings.getOperationTimeout(), Math.addExact('],
  ['J8', 'no 25-minute cap', DS, '                    && !maximumTimeout.isZero() && maximumTimeout.compareTo(Duration.ofMinutes(25)) <= 0,', '                    && !maximumTimeout.isZero(),'],
  ['J9', 'installFinish without claim re-check', DS, '        List<Operation> current = operation(scope, publicationId, operationId, true);\n        requireOperationClaim(current, claim.epoch(), now());\n        Map<String, Object> publication', '        List<Operation> current = operation(scope, publicationId, operationId, true);\n        Map<String, Object> publication'],
  ['J10', 'install() without active-operation fence', DS, '        requireOperationClaim(rows, candidate.epoch(), now());\n        requireContract(operationId.equals(active), HttpStatus.CONFLICT,\n                "managed_tool_publication_claim_lost", "Publication operation lost its claim");', '        requireOperationClaim(rows, candidate.epoch(), now());'],
  ['J11', 'window rounds down', DS, 'long seconds = bytes / bytesPerSecond + (bytes % bytesPerSecond == 0 ? 0 : 1);', 'long seconds = bytes / bytesPerSecond;'],
  ['J12', 'terminal window counts segments only', DS, '+ " WHERE scope_key = ? AND publication_id = ? AND slot_key <> \'admission\'",', '+ " WHERE scope_key = ? AND publication_id = ? AND slot_key LIKE \'segment:%\'",'],
  ['J13', 'recover busy back to 400', DS, '            requireContract(active == null || operationId.equals(active), HttpStatus.CONFLICT,\n                    "managed_tool_publication_busy", "Publication is busy");\n            jdbc.update("UPDATE qwen_tool_publication_operation SET recovery_deadline', '            require(active == null || operationId.equals(active), "Publication is busy");\n            jdbc.update("UPDATE qwen_tool_publication_operation SET recovery_deadline'],
  ['J14', 'finish replay busy back to 400', DS, '            requireContract(prior.get(0).claimUntil() == null || !prior.get(0).claimUntil().after(now),\n                    HttpStatus.CONFLICT, "managed_tool_publication_busy", "Finish operation is busy");', '            require(prior.get(0).claimUntil() == null || !prior.get(0).claimUntil().after(now), "Finish operation is busy");'],
];
const [kind, ...only] = process.argv.slice(2);
const list = (kind === 'ts' ? ts : java).filter((m) => !only.length || only.includes(m[0]));
const out = `${SP}/logs/mut-${kind}.log`;
for (const [id, label, file, from, to] of list) {
  const path = `${W}/${file}`;
  const src = fs.readFileSync(path, 'utf8');
  const n = src.split(from).length - 1;
  if (n !== 1) { fs.appendFileSync(out, `${id} ${label}: PATTERN MATCHES ${n} TIMES — skipped\n`); console.log(id, 'pattern', n); continue; }
  if (process.env.DRY) { console.log(id, "ok"); continue; }
  fs.writeFileSync(path, src.replace(from, to));
  const t0 = Date.now();
  let r;
  if (kind === 'ts') {
    r = spawnSync('npx', ['vitest', 'run', 'src/serve/remote-shell-result-publication.test.ts', '--coverage.enabled=false'], { cwd: `${W}/packages/cli`, encoding: 'utf8' });
  } else {
    r = spawnSync(`${SP}/rig/mvn.sh`, ['-o', '-Pmysql-integration', '-Dmysql.url=jdbc:mysql://127.0.0.1:13894/mysql?allowPublicKeyRetrieval=true&useSSL=false', '-Dmysql.user=root', '-Dmysql.password=rig12894', '-Dtest=ToolPublicationStoreTest,ToolPublicationConfigurationTest,ToolPublicationContractTest,ToolPublicationControllerTest', '-Dit.test=ToolPublicationRecoveryMySqlIT', '-Dsurefire.failIfNoSpecifiedTests=false', '-DargLine=-Xmx256m', 'verify'], { cwd: `${W}/packages/sdk-java/managed-agent-server`, encoding: 'utf8', maxBuffer: 256 << 20 });
  }
  execFileSync('git', ['-C', W, 'checkout', '--', file]);
  const text = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, '');
  fs.writeFileSync(`${SP}/logs/mut-${id}.log`, text);
  let failed;
  if (kind === 'ts') failed = [...new Set([...text.matchAll(/ FAIL .*? > (.*)$/gm)].map((m) => m[1].trim()))];
  else failed = [...new Set([...text.matchAll(/\[ERROR\]\s+(?:Failures|Errors)?:?\s*([A-Za-z]+(?:MySqlIT|Test)\.[A-Za-z0-9_]+)/g)].map((m) => m[1]))];
  const compile = /COMPILATION ERROR/.test(text);
  const verdict = r.status === 0 ? 'SURVIVED' : compile ? 'COMPILE-ERROR' : 'KILLED';
  const line = `${id} ${label}: ${verdict} (${Math.round((Date.now() - t0) / 1000)} s)${failed.length ? ' by ' + failed.slice(0, 6).join('; ') + (failed.length > 6 ? ` (+${failed.length - 6})` : '') : ''}`;
  fs.appendFileSync(out, line + '\n');
  console.log(line);
}
execFileSync('git', ['-C', W, 'diff', '--exit-code', '--stat']);
console.log('clean');
