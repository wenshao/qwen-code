// VERIFICATION RIG ONLY (PR #13112): one mutant at a time in wt-mut; Java mutants run the unit lane, then the Hosted IT
// if the unit lane did not kill them; web-shell mutants run the two managed client test files.
// usage: node mutate.mjs [id ...]
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const RIG = '/Users/wenshao/pr13112-rig';
const W = `${RIG}/${process.env.MUT_TREE ?? "wt-mut"}`;
const P = 'packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent';
const SVC = `${P}/service/ManagedAgentService.java`;
const STORE = `${P}/store/ManagedAgentStore.java`;
const REG = `${P}/store/ManagedWorkspaceRegistry.java`;
const COORD = `${P}/service/HarnessCoordinator.java`;
const PROV = 'packages/web-shell/client/components/managed/java-managed-agent-provider.ts';
const PAGE = 'packages/web-shell/client/components/managed/ManagedSessionsPage.tsx';
const M = [
  { id: 'K1', what: "service: drop the creator check", file: SVC,
    from: "        if ((!readGranted && !workspaces.canRead(session.tenantId(), actorId,\n                session.workspace().getWorkspaceId()))\n                || !workspaces.createdSession(session.tenantId(), actorId,\n                        session.sessionId())) {",
    to: "        if ((!readGranted && !workspaces.canRead(session.tenantId(), actorId,\n                session.workspace().getWorkspaceId()))) {" },
  { id: 'K2', what: "service: drop the read-grant check", file: SVC,
    from: "        if ((!readGranted && !workspaces.canRead(session.tenantId(), actorId,\n                session.workspace().getWorkspaceId()))\n                || !workspaces.createdSession(",
    to: "        if (!workspaces.createdSession(" },
  { id: 'K3', what: "service: drop the opt-in check", file: SVC,
    from: "        if (session.workspace() == null || !harness.isWorkspaceFilesAvailable()) {",
    to: "        if (session.workspace() == null) {" },
  { id: 'K4', what: "service: drop can_create + ACTIVE registry (pre-26de98cd admission)", file: SVC,
    from: "        return summary != null && summary.canCreateSession();",
    to: "        return summary != null;" },
  { id: 'K5', what: "service: drop the fixed-at-creation predicates (status/agent/context ref)", file: SVC,
    from: "        if (!\"ACTIVE\".equals(session.status()) || session.deletedAt() != null\n                || !\"qwen-code\".equals(session.agentId())\n                || !WorkspaceExecutionProfile.CONTEXT_CONFIG_REF.equals(\n                        session.workspace().getContextConfigRef())) {",
    to: "        if (false) {" },
  { id: 'K6', what: "service: submit/cancel/rename path skips the read check", file: SVC,
    from: "        return maySubmitWorkspaceTurn(session, actorId, false);",
    to: "        return maySubmitWorkspaceTurn(session, actorId, true);" },
  { id: 'K7', what: "service: rename maps a non-retryable refusal to 503 again", file: SVC,
    from: "                if (error instanceof RuntimeBrokerException refusal\n                        && !refusal.isRetryable()) {",
    to: "                if (Boolean.FALSE && error instanceof RuntimeBrokerException refusal\n                        && !refusal.isRetryable()) {" },
  { id: 'K8', what: "WebShell capability true for every caller of a bound Session", file: SVC,
    from: "                        maySubmitWorkspaceTurn(session, actorId, true)));",
    to: "                        session.workspace() != null));" },
  { id: 'K9', what: "service: requireSubmitter back to the legacy gate (PR reverted)", file: SVC,
    from: "        if (!maySubmitWorkspaceTurn(session, actorId)) {\n            requireLegacyWorkspace(session, actorId);",
    to: "        if (true) {\n            requireLegacyWorkspace(session, actorId);" },
  { id: 'K10', what: "coordinator: bound cancel skipped again (pre-PR)", file: COORD,
    from: "            if (session.workspace() != null\n                    && !harness.isWorkspaceFilesAvailable()) {\n                return;\n            }\n            // A live cancel",
    to: "            if (session.workspace() != null) {\n                return;\n            }\n            // A live cancel" },
  { id: 'K11', what: "coordinator: bound cancel reaches the Harness without the opt-in", file: COORD,
    from: "            if (session.workspace() != null\n                    && !harness.isWorkspaceFilesAvailable()) {\n                return;\n            }\n            // A live cancel",
    to: "            if (false) {\n                return;\n            }\n            // A live cancel" },
  { id: 'K12', what: "coordinator: live cancel attaches passively (26de98cd, reverted by 66646a6c)", file: COORD,
    from: "                    session.harnessBootId() != null);\n            if (store.bindHarness(tenantId, sessionId,\n                    turnId, owner, attachment.bootId())) {\n                harness.cancel(session.tenantId(), session.sessionId());",
    to: "                    session.harnessBootId() != null, true);\n            if (store.bindHarness(tenantId, sessionId,\n                    turnId, owner, attachment.bootId())) {\n                harness.cancel(session.tenantId(), session.sessionId());" },
  { id: 'W5', what: "page: execution-unavailable line shown to the creator again (pre-af0373ca)", file: PAGE,
    from: "              {!summary.capabilities.workspaceTurns && (",
    to: "              {true && (" },
  { id: 'J4', what: 'store: submit gate removed (bound Turn admitted without the opt-in)', file: STORE,
    from: `        // its initial one; the service admits only the Session's creator.\n        if (session.workspace() != null && !workspaceFilesEnabled) {`,
    to: `        // its initial one; the service admits only the Session's creator.\n        if (false) {` },
  { id: 'J5', what: 'store: cancel gate removed', file: STORE,
    from: `        if (requireSessionForUpdate(tenantId, sessionId).workspace() != null\n                && !workspaceFilesEnabled) {`,
    to: `        if (requireSessionForUpdate(tenantId, sessionId).workspace() != null\n                && false) {` },
  { id: 'J6', what: 'store: boundRenameAllowed also admits UNARCHIVE', file: STORE,
    from: `        return kind == SessionMutationKind.RENAME && workspaceFilesEnabled;`,
    to: `        return workspaceFilesEnabled;` },
  { id: 'J7', what: 'store: boundRenameAllowed ignores the opt-in', file: STORE,
    from: `        return kind == SessionMutationKind.RENAME && workspaceFilesEnabled;`,
    to: `        return kind == SessionMutationKind.RENAME;` },
  { id: 'J10', what: 'registry: createdSession ignores the actor', file: REG,
    from: `                + " AND actor_id = ?",\n                Integer.class, tenantId, sessionId, tenantId, key)`,
    to: `                + " AND ? IS NOT NULL",\n                Integer.class, tenantId, sessionId, tenantId, key)` },
  { id: 'J11', what: 'registry: createdSession drops the binary tenant guard', file: REG,
    from: `                + " WHERE tenant_id = ? AND session_id = ?"\n                + " AND CAST(CONCAT(tenant_id, '!') AS BINARY(513))"\n                + " = CAST(CONCAT(?, '!') AS BINARY(513))"\n                + " AND actor_id = ?",`,
    to: `                + " WHERE tenant_id = ? AND session_id = ?"\n                + " AND ? IS NOT NULL"\n                + " AND actor_id = ?",` },
  { id: 'J14', what: 'registry: createdSession ignores the Session (any bound Session this actor created)', file: REG,
    from: `                + " WHERE tenant_id = ? AND session_id = ?"\n                + " AND CAST(CONCAT(tenant_id, '!') AS BINARY(513))"\n                + " = CAST(CONCAT(?, '!') AS BINARY(513))"\n                + " AND actor_id = ?",\n                Integer.class, tenantId, sessionId, tenantId, key)`,
    to: `                + " WHERE tenant_id = ? AND ? IS NOT NULL"\n                + " AND CAST(CONCAT(tenant_id, '!') AS BINARY(513))"\n                + " = CAST(CONCAT(?, '!') AS BINARY(513))"\n                + " AND actor_id = ?",\n                Integer.class, tenantId, sessionId, tenantId, key)` },
  { id: 'W1', what: 'provider: canSend ignores workspaceTurns', file: PROV,
    from: `        sessionActive && !active && (!session.workspace || workspaceTurns),`,
    to: `        sessionActive && !active && !session.workspace,` },
  { id: 'W2', what: 'provider: canCancel ignores workspaceTurns', file: PROV,
    from: `        turnStatus !== 'cancelling' &&\n        (!session.workspace || workspaceTurns),`,
    to: `        turnStatus !== 'cancelling' &&\n        !session.workspace,` },
  { id: 'W3', what: 'provider: every bound Session counts as workspaceTurns', file: PROV,
    from: `    Boolean(session.workspace) && session.capabilities?.workspaceTurns === true;`,
    to: `    Boolean(session.workspace);` },
  { id: 'W4', what: 'page: composer hidden for bound Sessions again', file: PAGE,
    from: `          {(!summary?.workspace || summary.capabilities.workspaceTurns) &&`,
    to: `          {!summary?.workspace &&` },
];

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 28, ...opts });
const env = { ...process.env, JAVA_HOME: '/Users/wenshao/Install/jdk21', PATH: `/Users/wenshao/Install/jdk21/bin:${process.env.PATH}` };
if (!process.env.MUT_TREE) { console.error('set MUT_TREE'); process.exit(2); }
const want = process.argv.slice(2);
const out = `${RIG}/out/mut`;
fs.mkdirSync(out, { recursive: true });
const ledger = `${out}/${process.env.MUT_LEDGER ?? 'LEDGER.txt'}`;
for (const m of M) {
  if (want.length && !want.includes(m.id)) continue;
  const f = `${W}/${m.file}`;
  const orig = fs.readFileSync(f, 'utf8');
  const n = orig.split(m.from).length - 1;
  if (n !== 1) { fs.appendFileSync(ledger, `${m.id} NOT-APPLIED matches=${n} ${m.what}\n`); console.log(`${m.id} NOT-APPLIED matches=${n}`); continue; }
  fs.writeFileSync(f, orig.replace(m.from, m.to));
  const start = Date.now();
  let verdict = 'SURVIVED', by = '';
  try {
    if (m.file.endsWith('.java')) {
      const u = run('mvn', ['-B', '-ntp', '-o', `-Dmaven.repo.local=${RIG}/${process.env.MUT_M2 ?? "m2-mut"}`, '-f', `${W}/packages/sdk-java/managed-agent-server/pom.xml`, 'test'], { env });
      fs.writeFileSync(`${out}/${m.id}-unit.log`, u.stdout + u.stderr);
      const failed = [...new Set((u.stdout.match(/^\[ERROR\]   [A-Za-z]+\.[A-Za-z]+(:\d+)?/gm) ?? []).map((s) => s.replace('[ERROR]   ', '')))];
      if (u.status !== 0) { verdict = 'KILLED'; by = `unit: ${failed.slice(0, 4).join(', ') || 'build/compile failure'}`; }
      else {
        const it = run(`${RIG}/it.sh`, [process.env.MUT_TREE ?? 'wt-mut', `${process.env.MUT_TAG ?? 'mut'}-${m.id}`, process.env.MUT_M2 ?? 'm2-mut', 'HostedPublicWorkspaceIT'], { env });
        const line = it.stdout.trim();
        if (!/exit=0 /.test(line)) {
          const log = fs.readFileSync(`${RIG}/out/it/${process.env.MUT_TAG ?? 'mut'}-${m.id}.log`, 'utf8');
          const where = (log.match(/HostedPublicWorkspaceIT\.java:\d+/g) ?? []).slice(0, 2).join(' ');
          verdict = 'KILLED'; by = `Hosted IT (${where || line.slice(0, 80)})`;
        } else by = 'unit 0 failures; Hosted IT green';
      }
    } else {
      const t = run(`${W}/node_modules/.bin/vitest`, ['run', '--config', 'vitest.config.ts', 'client/components/managed/java-managed-agent-provider.test.ts', 'client/components/managed/ManagedSessionsPage.test.tsx'], { cwd: `${W}/packages/web-shell`, env });
      fs.writeFileSync(`${out}/${m.id}-vitest.log`, t.stdout + t.stderr);
      const failedNames = [...new Set((t.stdout.match(/FAIL .*? > .*$/gm) ?? []).map((s) => s.slice(0, 140)))];
      if (t.status !== 0) { verdict = 'KILLED'; by = `vitest: ${failedNames.slice(0, 2).join(' | ') || 'exit ' + t.status}`; }
      else by = 'vitest green';
    }
  } finally {
    fs.writeFileSync(f, orig);
  }
  const line = `${m.id} ${verdict} ${Math.round((Date.now() - start) / 1000)}s  ${m.what}  -- ${by}`;
  fs.appendFileSync(ledger, line + '\n');
  console.log(line);
}
