#!/usr/bin/env python3
# Round-2 single-site mutants on head 621d2c08 (src-mut2). Each mutant runs the
# PR's 14 touched test classes; killed = a test fails (not a compile error).
import json, os, re, subprocess, sys, time, glob
W = '/Users/wenshao/pr13325-rig/src-mut2'
MOD = f'{W}/packages/sdk-java/managed-agent-server'
J = f'{MOD}/src/main/java/com/alibaba/qwen/code/managedagent'
STORE = f'{J}/store/ManagedAgentStore.java'
SVC = f'{J}/service/ManagedAgentService.java'
HANDLER = f'{J}/api/ApiExceptionHandler.java'
CHAN = f'{J}/service/ManagedChannelService.java'
MODELS = f'{J}/store/StoreModels.java'
OUT = '/Users/wenshao/pr13325-rig/out/mut2'
os.makedirs(OUT, exist_ok=True)
TESTS = 'SessionRowLockOrderTest,ManagedAgentWorkspaceReplayTest,ManagedWorkspaceAdmissionTest,ManagedAgentReplayOutageTest,ManagedAgentStoreLocaleTest,ApiExceptionHandlerTest,HarnessCoordinatorTest,ManagedChannelServiceTest,StoreModelsTest,ManagedSessionStoreIntegrationTest,ManagedAgentTurnDeferralTest,WorkspaceSessionRetentionTest,ManagedSessionLifecycleTest,ManagedAgentServerIntegrationTest'.split(',')

def sub(path, old, new, count=1):
    s = open(path).read()
    assert s.count(old) >= 1, f'anchor not found in {path}: {old[:90]!r}'
    open(path, 'w').write(s.replace(old, new, count))

RA = """        requireSessionForUpdate(tenantId, sessionId);
        long now = clock.millis();
        int updated = jdbc.update("UPDATE managed_agent_turn SET status ="
                        + " CASE WHEN status = 'CANCELLING' THEN status ELSE"
                        + " 'RUNNING' END, harness_event_epoch = ?,"
                        + " harness_last_event_id = ?, updated_at = ?,"
                        + " version = version + 1 WHERE tenant_id = ? AND"
                        + " session_id = ? AND turn_id = ? AND"
                        + " dispatch_owner = ? AND dispatch_lease_until"
                        + " >= ?",
                eventEpoch, lastEventId, now, tenantId, sessionId, turnId,
                owner, now);
        if (updated != 1) {
            throw new IllegalStateException("Turn dispatch lease was lost");
        }
"""
RA_MOVED = RA.replace("        requireSessionForUpdate(tenantId, sessionId);\n", "", 1) + "        requireSessionForUpdate(tenantId, sessionId);\n"

MUTANTS = {
 'M02-recordAdmission-lock-after-turn-update': lambda: sub(STORE, RA, RA_MOVED),
 'M07-no-415-handler': lambda: sub(HANDLER, '    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)\n', '    // @ExceptionHandler(HttpMediaTypeNotSupportedException.class)\n'),
 'N01-store-rename-discovery-gate-removed (=prev)': lambda: sub(STORE, '            requireRenameReplayOwner(session, previous.get(), actorId);\n', '            // requireRenameReplayOwner(session, previous.get(), actorId);\n'),
 'N02-rename-preread-creator-gate-removed': lambda: sub(SVC, """            if (!recordedByCaller(recorded, actorId)) {
                requireReplayCreator(session, actorId);
            }""", """            if (false) {
                requireReplayCreator(session, actorId);
            }"""),
 'N03-replayForCreator-gate-removed': lambda: sub(SVC, """        if (!recordedByCaller(command, actorId)) {
            requireReplayCreator(session, actorId);
        }
        return store.replayCommand(""", """        if (false) {
            requireReplayCreator(session, actorId);
        }
        return store.replayCommand("""),
 'N04-submit-answer-side-gate-removed': lambda: sub(SVC, """        requireReplayedAdmission(tenantId, SUBMIT, idempotencyKey, admission,""", """        if (false) requireReplayedAdmission(tenantId, SUBMIT, idempotencyKey, admission,"""),
 'N05-recordedByCaller-always-false (V69 ignored)': lambda: sub(SVC, """        byte[] recorded = command.actorKey();
        if (recorded == null || actorId == null) {""", """        byte[] recorded = command.actorKey();
        if (true || recorded == null || actorId == null) {"""),
 'N06-submit-fresh-key-tombstone-404-removed': lambda: sub(SVC, """        // retire it.
        requireVisibleSession(session);
        requireSubmitterFacts(session, actorId);""", """        // retire it.
        requireSubmitterFacts(session, actorId);"""),
 'N07-replay-dispatch-ignores-harness-availability': lambda: sub(SVC, 'if (admission.turnId() != null && harness.isAvailable()', 'if (admission.turnId() != null'),
 'N08-legacy-over-256-echo-not-noop': lambda: sub(SVC, '&& title.equals(current.title())) {', '&& false) {'),
 'N09-channel-platform-fold-removed': lambda: sub(CHAN, 'String title = instance.platform().replaceAll("[\\\\p{Cntrl}]", " ")', 'String title = instance.platform()'),
 'N10-withStatus-drops-digest': lambda: sub(MODELS, """                    version, workspace, approvalMode, toolProfile,
                    agentDefinitionDigest);""", """                    version, workspace, approvalMode, toolProfile,
                    null);"""),
 'N11-tombstone-capabilities-not-gated': lambda: sub(SVC, 'boolean visible = session.deletedAt() == null;', 'boolean visible = true;', 1),
 'N12-list-keyset-back-to-updated_at': lambda: (sub(STORE, '" AND (created_at < ? OR (created_at = ?"', '" AND (updated_at < ? OR (updated_at = ?"'), sub(STORE, '" ORDER BY created_at DESC, session_id DESC LIMIT ?"', '" ORDER BY updated_at DESC, session_id DESC LIMIT ?"')),
}

def restore():
    subprocess.run(['git', '-C', W, 'checkout', '--', 'packages/sdk-java'], check=True)

def run_tests(tag):
    env = dict(os.environ, JAVA_HOME='/Users/wenshao/Install/jdk21', PATH='/Users/wenshao/Install/jdk21/bin:' + os.environ['PATH'])
    log = f'{OUT}/{tag.split(" ")[0]}.log'
    for f in glob.glob(f'{MOD}/target/surefire-reports/*'):
        os.remove(f)
    cmd = ['/Users/wenshao/Install/maven/bin/mvn', '-B', '-ntp', '-o', '-Dmaven.repo.local=/Users/wenshao/pr13325-rig/m2-h2',
           '-Dcheckstyle.skip=true', '-Dspotbugs.skip=true', '-Djacoco.skip=true', '-Dsurefire.failIfNoSpecifiedTests=false',
           f'-Dtest={",".join(TESTS)}', 'test']
    t = time.time()
    p = subprocess.run(cmd, cwd=MOD, env=env, stdout=open(log, 'w'), stderr=subprocess.STDOUT)
    txt = open(log).read()
    m = re.findall(r'Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)\s*$', txt, re.M)
    names = sorted(set(re.findall(r'\[ERROR\]\s+(\w+Test\.\w+)', txt)))
    return {'exit': p.returncode, 'totals': m[-1] if m else None, 'failing': names, 'compileError': 'COMPILATION ERROR' in txt, 'secs': round(time.time() - t)}

ids = sys.argv[1:] or ['BASELINE'] + list(MUTANTS)
res_path = f'{OUT}/results.json'
results = json.load(open(res_path)) if os.path.exists(res_path) else {}
for mid in ids:
    restore()
    if mid != 'BASELINE':
        MUTANTS[mid]()
    diff = subprocess.run(['git', '-C', W, 'diff', '--stat'], capture_output=True, text=True).stdout.strip().splitlines()
    r = run_tests(mid)
    r['diff'] = diff[-1] if diff else 'NO DIFF'
    if mid != 'BASELINE':
        r['killed'] = r['exit'] != 0 and not r['compileError']
    results[mid] = r
    json.dump(results, open(res_path, 'w'), indent=1)
    print(mid, json.dumps(r), flush=True)
restore()
print('MUT2-DONE')
