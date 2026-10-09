"""Create probe arms from the head tree: each arm is a full APFS clone with one production edit."""
import os, subprocess, sys
R = '/Users/wenshao/pr13554-rig'
SRC = R + '/wt-h4'
STORE = 'packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/store/'
COL = STORE + 'SessionResourceCollectionCollector.java'
WRS = STORE + 'WorkspaceRecoveryStore.java'
MIG = 'packages/sdk-java/managed-agent-server/src/main/resources/db/migration/V56__managed_stream_capture_collection.sql'
ARMS = {
    'head': [],
    # the page() of 722680590a: no session lock, no page-time recovery re-check
    'nofence': [(COL, '        // Session locks precede the ledger row lock, matching claim()\'s order.\n'
                      '        ToolPublicationRetentionStore.lockSession(jdbc, claim.tenant(), claim.session());\n', ''),
                (COL, '        if (recoveryInFlight(claim.session(), true)) {\n            return false;\n        }\n', '')],
    # keep the session lock, re-check with a plain (snapshot) read
    'plain': [(COL, 'if (recoveryInFlight(claim.session(), true)) {', 'if (recoveryInFlight(claim.session(), false)) {')],
    # resource_collected no longer invalidates the capture
    'noinval': [(WRS, 'if ("source_drift".equals(error.code) || "resource_collected".equals(error.code)) {',
                 'if ("source_drift".equals(error.code)) {')],
    # without the (session_id, operation_id) index
    'noindex': [(MIG, 'CREATE INDEX idx_workspace_recovery_session_session\n    ON managed_workspace_recovery_session (session_id, operation_id);\n', '')],
}
for arm in sys.argv[1:] or ARMS:
    dst = f'{R}/arm-{arm}'
    if not os.path.exists(dst):
        subprocess.check_call(['cp', '-Rc', SRC, dst])
    for path, old, new in ARMS[arm]:
        p = f'{dst}/{path}'
        s = open(p).read()
        n = s.count(old)
        if n != 1:
            raise SystemExit(f'{arm}: anchor matched {n} times in {path}')
        open(p, 'w').write(s.replace(old, new))
    t = f'{dst}/packages/sdk-java/managed-agent-server/src/test/java/com/alibaba/qwen/code/managedagent/store/'
    subprocess.check_call(['cp', f'{R}/probe4/RecoveryRaceProbe.java', t])
    diff = subprocess.run(['git', '-C', dst, 'diff', '--stat', '--', 'packages/sdk-java/managed-agent-server/src/main'],
                          capture_output=True, text=True).stdout.strip().splitlines()
    print(arm, diff[-1] if diff else 'no production diff')
