// VERIFICATION RIG ONLY (PR #13163): mutation matrix over the PR's new production code.
// Refuses to run without MUT_TREE (a worktree at head + the 3-line test compile fix, committed).
// Each mutant: apply one replace (anchor must occur exactly once), run the full managed-agent-server fast lane
// offline, collect failing testcases from the surefire XML, compare with the unmutated baseline set, restore.
// usage: MUT_TREE=<worktree> MUT_M2=<m2> MUT_LEDGER=<file> node mutate13163.mjs [id ...]
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const TREE = process.env.MUT_TREE;
const M2 = process.env.MUT_M2;
const LEDGER = process.env.MUT_LEDGER;
const NOISE = process.env.MUT_NOISE ? new RegExp(process.env.MUT_NOISE) : null;
if (!TREE || !M2 || !LEDGER) { console.error('MUT_TREE, MUT_M2 and MUT_LEDGER are required'); process.exit(2); }
const MOD = `${TREE}/packages/sdk-java/managed-agent-server`;
const SRC = `${MOD}/src/main/java/com/alibaba/qwen/code/managedagent`;
const RES = `${MOD}/src/main/resources`;
const C = `${SRC}/service/HarnessCoordinator.java`;
const S = `${SRC}/service/ManagedAgentService.java`;
const ST = `${SRC}/store/ManagedAgentStore.java`;
const R = `${SRC}/store/ManagedWorkspaceRegistry.java`;
const CN = `${SRC}/harness/QwenHostedHarnessConnector.java`;
const WX = `${SRC}/store/WorkspaceExecutionStore.java`;

const MUTANTS = [
  ['N1', C, 'drop the lease-renewal cancel dispatch', `} else if (!leaseLost.get()) {
                            executor.execute(() -> cancelAdmittedTurn(
                                    tenantId, sessionId, turnId));
                        }`, `}`],
  ['N2', C, '`!leaseLost.get()` -> true (bot R1-9: unreachable)', `} else if (!leaseLost.get()) {`, `} else if (true) {`],
  ['N3', C, 'cancel attaches again (createOrLoad re-runs authorization)', `if (session.harnessBootId() != null && store.bindHarness(tenantId,
                    sessionId, turnId, owner, session.harnessBootId())) {`, `if (store.bindHarness(tenantId,
                    sessionId, turnId, owner, harness.createOrLoad(session.tenantId(), session.sessionId(), session.harnessBootId() != null).bootId())) {`],
  ['N4', C, 'drop the harnessBootId != null guard', `if (session.harnessBootId() != null && store.bindHarness(tenantId,`, `if (store.bindHarness(tenantId,`],
  ['N5', S, 'requireCanceller: drop the opt-in clause', `        if (session.workspace() == null
                || !harness.isWorkspaceFilesAvailable()
                || !workspaces.canRead(`, `        if (session.workspace() == null
                || !workspaces.canRead(`],
  ['N6', S, 'requireCanceller: drop the canRead clause', `                || !workspaces.canRead(session.tenantId(), actorId,
                        session.workspace().getWorkspaceId())
                || !workspaces.createdSession(session.tenantId(), actorId,
                        session.sessionId())) {
            requireLegacyWorkspace(session, actorId);`, `                || !workspaces.createdSession(session.tenantId(), actorId,
                        session.sessionId())) {
            requireLegacyWorkspace(session, actorId);`],
  ['N7', S, 'requireCanceller: drop the creator clause', `                        session.workspace().getWorkspaceId())
                || !workspaces.createdSession(session.tenantId(), actorId,
                        session.sessionId())) {
            requireLegacyWorkspace(session, actorId);
        }
    }

    private boolean maySubmitWorkspaceTurn(`, `                        session.workspace().getWorkspaceId())) {
            requireLegacyWorkspace(session, actorId);
        }
    }

    private boolean maySubmitWorkspaceTurn(`],
  ['N8', S, 'cancel uses the submit gate again', `        requireCanceller(tenantId, actorId, sessionId);`, `        requireSubmitter(tenantId, actorId, sessionId);`],
  ['N9', S, 'admission drops bindingCurrent', `        return summary != null && summary.canCreateSession()
                && workspaces.bindingCurrent(session.tenantId(),
                        session.workspace().getWorkspaceId(),
                        session.workspace().getWorkspaceGeneration(),
                        session.workspace().getStorageId());`, `        return summary != null && summary.canCreateSession();`],
  ['N10', R, 'bindingCurrent ignores storage_id (bot R1-2)', `                + " AND workspace_generation = ? AND storage_id = ?",
                Integer.class, tenantId, workspaceId, generation, storageId)`, `                + " AND workspace_generation = ?",
                Integer.class, tenantId, workspaceId, generation)`],
  ['N11', R, 'bindingCurrent ignores the generation', `                + " AND workspace_generation = ? AND storage_id = ?",
                Integer.class, tenantId, workspaceId, generation, storageId)`, `                + " AND storage_id = ?",
                Integer.class, tenantId, workspaceId, storageId)`],
  ['N12', S, 'submit: admission gate before replay again', `        Admission replay = replay(tenantId, SUBMIT, idempotencyKey,
                requestDigest);
        if (replay != null) {
            dispatch(tenantId, replay);
            return response(replay);
        }
        requireSubmitter(tenantId, actorId, sessionId);`, `        requireSubmitter(tenantId, actorId, sessionId);
        Admission replay = replay(tenantId, SUBMIT, idempotencyKey,
                requestDigest);
        if (replay != null) {
            dispatch(tenantId, replay);
            return response(replay);
        }`],
  ['N12b', S, 'submit: admission gate before replay again (C0 layout)', `        Admission replay = replay(tenantId, SUBMIT, idempotencyKey,
                requestDigest);
        if (replay != null) {
            requireHarness();
            dispatch(tenantId, replay);
            return response(replay);
        }
        requireSubmitter(tenantId, actorId, sessionId);`, `        requireSubmitter(tenantId, actorId, sessionId);
        Admission replay = replay(tenantId, SUBMIT, idempotencyKey,
                requestDigest);
        if (replay != null) {
            requireHarness();
            dispatch(tenantId, replay);
            return response(replay);
        }`],
  ['N17', S, 'submit: drop the read check before replay', `        validateIdempotencyKey(idempotencyKey);
        requireReadableSession(tenantId, actorId, sessionId);
        List<Map<String, Object>> input = input(blocks, true);`, `        validateIdempotencyKey(idempotencyKey);
        List<Map<String, Object>> input = input(blocks, true);`],
  ['N18', S, 'rename: drop the read check before replay', `        validateIdempotencyKey(idempotencyKey);
        requireReadableSession(tenantId, actorId, sessionId);
        String effectiveTitle = validRenameTitle(title);`, `        validateIdempotencyKey(idempotencyKey);
        String effectiveTitle = validRenameTitle(title);`],
  ['N17b', S, 'submit: drop the read check (requireBoundCreator layout)', `        requireReadableSession(tenantId, actorId, sessionId);
        requireBoundCreator(tenantId, actorId, sessionId);
        List<Map<String, Object>> input = input(blocks, true);`, `        requireBoundCreator(tenantId, actorId, sessionId);
        List<Map<String, Object>> input = input(blocks, true);`],
  ['N18b', S, 'rename: drop the read check (requireBoundCreator layout)', `        requireReadableSession(tenantId, actorId, sessionId);
        requireBoundCreator(tenantId, actorId, sessionId);
        String effectiveTitle = validRenameTitle(title);`, `        requireBoundCreator(tenantId, actorId, sessionId);
        String effectiveTitle = validRenameTitle(title);`],
  ['N19', S, 'submit: drop requireBoundCreator (bot R3-1)', `        requireBoundCreator(tenantId, actorId, sessionId);
        List<Map<String, Object>> input = input(blocks, true);`, `        List<Map<String, Object>> input = input(blocks, true);`],
  ['N20', S, 'rename: drop requireBoundCreator', `        requireBoundCreator(tenantId, actorId, sessionId);
        String effectiveTitle = validRenameTitle(title);`, `        String effectiveTitle = validRenameTitle(title);`],
  ['N21', ST, 'store: disable the late-rename supersession guard', `if ("FAILED".equals(command.status()) && supersededByLaterMutation(`, `if (false && supersededByLaterMutation(`],
  ['N22', CN, 'cold-cache cancel uses the passive (grant-checking) authority again', `workspaceExecution.authorizeCancellation(session);`, `workspaceExecution.authorizePassiveAttachment(session);`],
  ['N23', WX, 'cancellation authority drops the CANCELLING Turn condition', `AND t.session_id = s.session_id AND t.status = 'CANCELLING'"`, `AND t.session_id = s.session_id"`],
  ['N24', WX, 'cancellation authority drops the submitted-Turn condition', `+ " AND (t.submission_attempted = TRUE OR t.harness_event_epoch IS NOT NULL)"`, `+ ""`],
  ['N25', CN, 'cancel goes back through the new-work attachment', `client().cancelTurn(cancellationAttachment(tenantId, sessionId));`, `client().cancelTurn(attachment(tenantId, sessionId, false));`],
  ['N13', S, 'rename: drop the COMPLETED-record answer before the gate', `            if ("COMPLETED".equals(existing.status())) {
                return new SessionMutationResult<>(getPublicSession(tenantId,
                        sessionId), true);
            }`, `            if (false) {
                return null;
            }`],
  ['N14', S, 'rename: IllegalStateException / 4xx no longer retire the row', `                if (error instanceof IllegalStateException
                        || (error instanceof DaemonHttpException http
                                && http.getStatusCode() < 500)) {`, `                if (false && (error instanceof IllegalStateException
                        || (error instanceof DaemonHttpException http
                                && http.getStatusCode() < 500))) {`],
  ['N15', ST, 'store refuses every bound cancel again', `        if (requireSessionForUpdate(tenantId, sessionId).workspace() != null
                && !workspaceFilesEnabled) {`, `        if (requireSessionForUpdate(tenantId, sessionId).workspace() != null) {`],
  ['N16', ST, 'abandonSessionMutation is a no-op', `        jdbc.update("DELETE FROM managed_agent_command WHERE tenant_id = ?"
                        + " AND operation = ? AND idempotency_key = ?"
                        + " AND session_id = ? AND command_status = 'PENDING'",
                tenantId, operation, idempotencyKey, sessionId);`, `        if (tenantId == null) { jdbc.update("SELECT 1"); }`],
  ['N26', S, 'page twin ignores the registry generation (30f092d0)', `        return grant.workspaceGeneration() == binding.getWorkspaceGeneration()
                && grant.storageId().equals(binding.getStorageId());`, `        return true
                && grant.storageId().equals(binding.getStorageId());`],
  ['N27', S, 'page twin ignores the registry storage (30f092d0)', `        return grant.workspaceGeneration() == binding.getWorkspaceGeneration()
                && grant.storageId().equals(binding.getStorageId());`, `        return grant.workspaceGeneration() == binding.getWorkspaceGeneration()
                && true;`],
  ['N28', S, 'page twin back to the 288e7feb rule (no binding check)', `        return grant.workspaceGeneration() == binding.getWorkspaceGeneration()
                && grant.storageId().equals(binding.getStorageId());`, `        return true;`],
  ['N29', S, 'requireCanceller back to the pre-F4 terms (drops the lifecycle shape)', `        if (!maySubmitShape(session)
                || !workspaces.canRead(`, `        if (session.workspace() == null
                || !harness.isWorkspaceFilesAvailable()
                || !workspaces.canRead(`],
  ['N30', S, 'requireCanceller drops the shape and the opt-in (F4 layout of N5)', `        if (!maySubmitShape(session)
                || !workspaces.canRead(`, `        if (session.workspace() == null
                || !workspaces.canRead(`],
];

const count = (hay, needle) => hay.split(needle).length - 1;
function failing() {
  const dir = `${MOD}/target/surefire-reports`;
  const out = new Set();
  if (!fs.existsSync(dir)) return null;
  for (const f of fs.readdirSync(dir).filter((x) => /^TEST-.*\.xml$/.test(x))) {
    const x = fs.readFileSync(`${dir}/${f}`, 'utf8');
    for (const m of x.matchAll(/<testcase name="([^"]+)" classname="([^"]+)"[^>]*?(\/>|>([\s\S]*?)<\/testcase>)/g)) {
      if (m[4] && /<(failure|error)\b/.test(m[4])) out.add(`${m[2].split('.').pop()}.${m[1]}`);
    }
  }
  return out;
}
function suite(tag) {
  const t0 = Date.now();
  const r = spawnSync('mvn', ['--batch-mode', '--no-transfer-progress', '-o', `-Dmaven.repo.local=${M2}`, '-f', `${MOD}/pom.xml`, '-Dcheckstyle.skip=true', 'clean', 'test'], { encoding: 'utf8', env: { ...process.env, JAVA_HOME: '/Users/wenshao/Install/jdk21', PATH: `/Users/wenshao/Install/jdk21/bin:${process.env.PATH}` }, maxBuffer: 1 << 28 });
  fs.writeFileSync(`${LEDGER}.${tag}.log`, r.stdout + r.stderr);
  const totals = [...(r.stdout ?? '').matchAll(/Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)$/gm)].at(-1);
  const compileError = /COMPILATION ERROR/.test(r.stdout ?? '');
  return { exit: r.status, totals: totals ? totals.slice(1).join('/') : null, failing: failing(), compileError, secs: Math.round((Date.now() - t0) / 1000) };
}
const ids = process.argv.slice(2);
const todo = MUTANTS.filter((m) => !ids.length || ids.includes(m[0]) || (ids.includes('BASE') && false));
let base;
if (!ids.length || ids.includes('BASE')) {
  base = suite('BASE');
  fs.writeFileSync(`${LEDGER}.base.json`, JSON.stringify({ ...base, failing: [...(base.failing ?? [])] }));
  fs.appendFileSync(LEDGER, `BASE exit=${base.exit} totals=${base.totals} failing=${JSON.stringify([...(base.failing ?? [])])} secs=${base.secs}\n`);
} else {
  const b = JSON.parse(fs.readFileSync(`${LEDGER}.base.json`, 'utf8'));
  base = { ...b, failing: new Set(b.failing) };
}
for (const [id, file, label, find, repl] of todo) {
  const orig = fs.readFileSync(file, 'utf8');
  const n = count(orig, find);
  if (n !== 1) { fs.appendFileSync(LEDGER, `${id} ANCHOR-COUNT=${n} SKIPPED (${label})\n`); continue; }
  fs.writeFileSync(file, orig.replace(find, repl));
  let res;
  try { res = suite(id); } finally { fs.writeFileSync(file, orig); }
  const fresh = res.failing ? [...res.failing].filter((t) => !base.failing.has(t) && !(NOISE && NOISE.test(t))) : null;
  const verdict = res.compileError ? 'COMPILE-ERROR' : fresh === null ? 'NO-REPORTS' : fresh.length ? 'KILLED' : 'SURVIVED';
  fs.appendFileSync(LEDGER, `${id} ${verdict} totals=${res.totals} new=${JSON.stringify(fresh)} secs=${res.secs} :: ${label}\n`);
}
fs.appendFileSync(LEDGER, `DONE ${new Date().toISOString()}\n`);
