#!/usr/bin/env python3
# Single-site mutants of the PR's fixes, applied to a clean head worktree one at
# a time; each runs the witness tests named for it. usage: mut.py [ids...]
import json, os, re, subprocess, sys, time, glob

W = '/Users/wenshao/pr13325-rig/src-mut'
MOD = f'{W}/packages/sdk-java/managed-agent-server'
J = f'{MOD}/src/main/java/com/alibaba/qwen/code/managedagent'
STORE = f'{J}/store/ManagedAgentStore.java'
SVC = f'{J}/service/ManagedAgentService.java'
HANDLER = f'{J}/api/ApiExceptionHandler.java'
MODELS = f'{J}/store/ManagedSessionStoreModels.java'
OUT = '/Users/wenshao/pr13325-rig/out/mut'
os.makedirs(OUT, exist_ok=True)
SIT = 'ManagedAgentServerIntegrationTest'

def sub(path, old, new, count=1):
    s = open(path).read()
    assert s.count(old) >= 1, f'anchor not found in {path}: {old[:80]!r}'
    open(path, 'w').write(s.replace(old, new, count))

RA_LOCK = """        requireSessionForUpdate(tenantId, sessionId);
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
RA_MOVED = RA_LOCK.replace("        requireSessionForUpdate(tenantId, sessionId);\n", "", 1) + "        requireSessionForUpdate(tenantId, sessionId);\n"

MUTANTS = {
  'M01-recordAdmission-drop-lock': (lambda: sub(STORE, RA_LOCK, RA_LOCK.replace("        requireSessionForUpdate(tenantId, sessionId);\n", "", 1)), ['SessionRowLockOrderTest']),
  'M02-recordAdmission-lock-after-turn-update': (lambda: sub(STORE, RA_LOCK, RA_MOVED), ['SessionRowLockOrderTest']),
  'M03-failTurn-drop-lock': (lambda: sub(STORE, """        // Session-row lock first; see recordAdmission.
        requireSessionForUpdate(tenantId, sessionId);
        TurnRecord turn = requireTurn(tenantId, sessionId, turnId);
        if (!owner.equals(turn.dispatchOwner())
                || !ACTIVE_TURN_STATES""", """        TurnRecord turn = requireTurn(tenantId, sessionId, turnId);
        if (!owner.equals(turn.dispatchOwner())
                || !ACTIVE_TURN_STATES"""), ['SessionRowLockOrderTest']),
  'M04-list-keyset-updated_at': (lambda: (sub(STORE, '" AND (created_at < ? OR (created_at = ?"', '" AND (updated_at < ? OR (updated_at = ?"'), sub(STORE, '" ORDER BY created_at DESC, session_id DESC LIMIT ?"', '" ORDER BY updated_at DESC, session_id DESC LIMIT ?"'), sub(SVC, 'String raw = last.createdAt() + ":" + last.sessionId();', 'String raw = last.updatedAt() + ":" + last.sessionId();')), [f'{SIT}#keepsPagingSessionsAcrossRowsWhoseUpdatedAtMoved']),
  'M05-recovery-size-4096': (lambda: sub(MODELS, '@NotBlank @Size(max = 128) String recoveryDetailCode', '@NotBlank @Size(max = 4096) String recoveryDetailCode'), ['ManagedSessionStoreIntegrationTest#rejectsAnOverlongRecoveryDetailCodeBeforeTheColumnDoes']),
  'M06-no-405-handler': (lambda: sub(HANDLER, '    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)\n', '    // @ExceptionHandler(HttpRequestMethodNotSupportedException.class)\n'), ['ApiExceptionHandlerTest', f'{SIT}#mapsMethodAndMediaTypeErrorsThroughTheAdviceDispatch']),
  'M07-no-415-handler': (lambda: sub(HANDLER, '    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)\n', '    // @ExceptionHandler(HttpMediaTypeNotSupportedException.class)\n'), ['ApiExceptionHandlerTest', f'{SIT}#mapsMethodAndMediaTypeErrorsThroughTheAdviceDispatch']),
  'M08-session-status-default-locale': (lambda: sub(SVC, 'session.status().toLowerCase(Locale.ROOT),', 'session.status().toLowerCase(),', 2), [f'{SIT}#foldsSessionStatusesWithTheRootLocaleUnderATurkishDefault']),
  'M09-turn-status-default-locale': (lambda: sub(SVC, 'turn.status().toLowerCase(Locale.ROOT),', 'turn.status().toLowerCase(),', 2), [f'{SIT}#foldsTurnStatusesAndConflictMessagesWithTheRootLocaleUnderATurkishDefault']),
  'M10-tool-status-default-locale': (lambda: sub(STORE, ': sourceStatus.toLowerCase(Locale.ROOT)) {', ': sourceStatus.toLowerCase()) {'), ['ManagedAgentStoreLocaleTest']),
  'M11-submit-harness-gate-before-replay': (lambda: (sub(SVC, """        requireSubmitter(tenantId, actorId, sessionId);
        // Replay before the harness gate""", """        requireSubmitter(tenantId, actorId, sessionId);
        requireHarness();
        // Replay before the harness gate""")), [f'{SIT}#replaysASubmittedTurnWhileTheHarnessIsUnavailable']),
  'M12-create-harness-gate-before-replay': (lambda: sub(SVC, """        String requestDigest = digests.digest(semantic);
        // Replay before the harness gate: re-serving""", """        String requestDigest = digests.digest(semantic);
        if (!input.isEmpty()) {
            requireHarness();
        }
        // Replay before the harness gate: re-serving"""), [f'{SIT}#replaysACreationWithInputWhileTheHarnessIsUnavailable']),
  'M13-rename-no-pre-delete-probe': (lambda: sub(SVC, """        if (recorded != null && "COMPLETED".equals(recorded.status())) {
            SessionRecord session = store.requireSession(tenantId,""", """        if (false && recorded != null && "COMPLETED".equals(recorded.status())) {
            SessionRecord session = store.requireSession(tenantId,"""), [f'{SIT}#replaysACompletedRenameAfterTheSessionWasDeleted', 'ManagedWorkspaceAdmissionTest#aBoundRenameReplaysItsRecordedOutcomeAfterTheSessionWasDeleted']),
  'M14-title-cap-512': (lambda: sub(SVC, """        if (title.length() > 256) {""", """        if (title.length() > 512) {"""), [f'{SIT}#enforcesOneTitlePolicyAcrossCreateAndRename']),
  'M15-no-control-char-rule': (lambda: sub(SVC, """        if (title.chars().anyMatch(character -> character <= 31""", """        if (false && title.chars().anyMatch(character -> character <= 31"""), [f'{SIT}#enforcesOneTitlePolicyAcrossCreateAndRename']),
  'M16-replay-shows-deleted-status': (lambda: sub(SVC, """        if (!"DELETED".equals(session.status())) {
            return session;
        }""", """        if (true) {
            return session;
        }"""), [f'{SIT}#replaysACompletedRenameAfterTheSessionWasDeleted', 'ManagedWorkspaceAdmissionTest#aBoundRenameReplaysItsRecordedOutcomeAfterTheSessionWasDeleted', f'{SIT}#replaysACompletedUnarchiveAfterTheSessionWasDeleted']),
}

def restore():
    subprocess.run(['git', '-C', W, 'checkout', '--', 'packages/sdk-java'], check=True)

def run_tests(tests, tag):
    env = dict(os.environ, JAVA_HOME='/Users/wenshao/Install/jdk21', PATH='/Users/wenshao/Install/jdk21/bin:' + os.environ['PATH'])
    log = f'{OUT}/{tag}.log'
    for f in glob.glob(f'{MOD}/target/surefire-reports/*'):
        os.remove(f)
    cmd = ['/Users/wenshao/Install/maven/bin/mvn', '-B', '-ntp', '-o', '-Dmaven.repo.local=/Users/wenshao/pr13325-rig/m2-head',
           '-Dcheckstyle.skip=true', '-Dspotbugs.skip=true', '-Djacoco.skip=true', '-Dsurefire.failIfNoSpecifiedTests=false',
           f'-Dtest={",".join(tests)}', 'test']
    t = time.time()
    p = subprocess.run(cmd, cwd=MOD, env=env, stdout=open(log, 'w'), stderr=subprocess.STDOUT)
    txt = open(log).read()
    m = re.findall(r'Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)\s*$', txt, re.M)
    failed = sorted(set(re.findall(r'\[ERROR\]\s+([\w.]+(?:\.\w+)?[:#]?\w*)\s+(?:--|»|Time)', txt)))
    fails = sorted(set(re.findall(r'\[ERROR\] (?:Failures|Errors):\s*\n((?:\[ERROR\]\s+\S+.*\n)+)', txt)))
    names = sorted(set(re.findall(r'\[ERROR\]\s+(\w+Test\.\w+)', txt)))
    compile_err = 'COMPILATION ERROR' in txt
    return {'exit': p.returncode, 'totals': m[-1] if m else None, 'failing': names, 'compileError': compile_err, 'secs': round(time.time() - t)}

ids = sys.argv[1:] or ['BASELINE'] + list(MUTANTS)
res_path = f'{OUT}/results.json'
results = json.load(open(res_path)) if os.path.exists(res_path) else {}
all_tests = sorted({t for _, ts in MUTANTS.values() for t in ts})
for mid in ids:
    restore()
    if mid == 'BASELINE':
        r = run_tests(all_tests, mid)
    else:
        fn, tests = MUTANTS[mid]
        fn()
        diff = subprocess.run(['git', '-C', W, 'diff', '--stat'], capture_output=True, text=True).stdout.strip().splitlines()
        r = run_tests(tests, mid)
        r['diff'] = diff[-1] if diff else 'NO DIFF'
        r['killed'] = r['exit'] != 0 and not r['compileError']
    results[mid] = r
    json.dump(results, open(res_path, 'w'), indent=1)
    print(mid, json.dumps(r), flush=True)
restore()
print('MUT-DONE')
