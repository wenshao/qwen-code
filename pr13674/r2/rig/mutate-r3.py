#!/usr/bin/env python3
"""Mutation spot-check of #13674 @767ef183: does the PR's own test set (six classes) kill each mutant?
Each mutant is a single anchored replacement in production code; the file is restored afterwards."""
import os, re, subprocess, sys, time, json

W = '/Users/wenshao/pr13674-rig/src-mut'
SJ = f'{W}/packages/sdk-java/managed-agent-server'
P = f'{SJ}/src/main/java/com/alibaba/qwen/code/managedagent'
OUT = '/Users/wenshao/pr13674-rig/out/mut-r3'
os.makedirs(OUT, exist_ok=True)
TESTS = 'ManagedActionsTest,ManagedCwdChangeOperationTest,ManagedWorkspaceAdmissionTest,WorkspaceSessionRetentionTest,QwenHostedHarnessConnectorTest,ManagedAgentPropertiesTest'
CONN = f'{P}/harness/QwenHostedHarnessConnector.java'
SVC = f'{P}/service/ManagedAgentService.java'
STORE = f'{P}/store/ManagedAgentStore.java'
PROF = f'{P}/store/WorkspaceToolProfiles.java'
PROPS = f'{P}/config/ManagedAgentProperties.java'

MUTANTS = [
    ('M1 attachment() Shell approval guard removed (R3-4)', CONN,
     '    private HarnessSessionRef attachment(String tenantId, String sessionId, boolean newWork) {\n        requireShellApproval(sessions.requireSession(tenantId, sessionId));',
     '    private HarnessSessionRef attachment(String tenantId, String sessionId, boolean newWork) {'),
    ('M2 cancellationAttachment() Shell approval guard removed', CONN,
     '    private HarnessSessionRef cancellationAttachment(String tenantId, String sessionId) {\n        requireShellApproval(sessions.requireSession(tenantId, sessionId));',
     '    private HarnessSessionRef cancellationAttachment(String tenantId, String sessionId) {'),
    ('M3 foregroundShell drops workspaceFilesEnabled (R3-5)', SVC,
     'return store.workspaceFilesEnabled() && store.workspaceShellEnabled()\n                && WorkspaceToolProfiles.requiresApproval(session.approvalMode());',
     'return store.workspaceShellEnabled()\n                && WorkspaceToolProfiles.requiresApproval(session.approvalMode());'),
    ('M4 foregroundShell ignores persisted approval (R3-5)', SVC,
     'return store.workspaceFilesEnabled() && store.workspaceShellEnabled()\n                && WorkspaceToolProfiles.requiresApproval(session.approvalMode());',
     'return store.workspaceFilesEnabled() && store.workspaceShellEnabled();'),
    ('M5 isShell narrowed to /1 (R3-6)', PROF,
     'return SHELL.equals(profile) || "hosted-workspace-shell/2".equals(profile);',
     'return SHELL.equals(profile);'),
    ('M6 supportsClose admits Shell when flag on (R3-7)', SVC,
     'return session.workspace() == null || !WorkspaceToolProfiles.isShell(session.toolProfile())\n                && store.workspaceFilesEnabled()',
     'return session.workspace() == null || (!WorkspaceToolProfiles.isShell(session.toolProfile()) || store.workspaceShellEnabled())\n                && store.workspaceFilesEnabled()'),
    ('M7 supportsDelete admits Shell when flag on (R3-7)', SVC,
     'return retention || session.workspace() != null && !WorkspaceToolProfiles.isShell(session.toolProfile())',
     'return retention || session.workspace() != null && (!WorkspaceToolProfiles.isShell(session.toolProfile()) || store.workspaceShellEnabled())'),
    ('M8 beginLifecycle Shell refusal removed', STORE,
     '            return new OperationAdmission(existing.get(), true);\n        }\n        if (WorkspaceToolProfiles.isShell(session.toolProfile())) {\n            throw workspaceExecutionUnavailable();\n        }',
     '            return new OperationAdmission(existing.get(), true);\n        }'),
    ('M9 unarchive Shell refusal removed', STORE,
     '            return new SessionMutation(session, true);\n        }\n        if (WorkspaceToolProfiles.isShell(session.toolProfile())) {\n            throw workspaceExecutionUnavailable();\n        }',
     '            return new SessionMutation(session, true);\n        }'),
    ('M10 fresh-Turn Shell gate removed', STORE,
     '        if (WorkspaceToolProfiles.isShell(session.toolProfile()) && !workspaceShellEnabled) {\n            throw workspaceExecutionUnavailable();\n        }',
     ''),
    ('M11 creation always files/1', STORE,
     '? WorkspaceToolProfiles.SHELL : WorkspaceToolProfiles.FILES,',
     '? WorkspaceToolProfiles.FILES : WorkspaceToolProfiles.FILES,'),
    ('M12 startup accepts yolo with Shell', PROPS,
     '|| !Set.of("default", "auto-edit").contains(mode.toLowerCase(Locale.ROOT)))) {\n            throw new IllegalStateException("Hosted Workspace Shell requires',
     '|| !Set.of("yolo", "default", "auto-edit").contains(mode.toLowerCase(Locale.ROOT)))) {\n            throw new IllegalStateException("Hosted Workspace Shell requires'),
    ('M13 connector requireShellApproval accepts any mode', CONN,
     '&& (actions == null || !WorkspaceToolProfiles.requiresApproval(\n                        actions.approvalMode(session.tenantId(), session.sessionId())))) {',
     '&& (actions == null)) {'),
]

def run(tag):
    log = f'{OUT}/{tag}.log'
    env = dict(os.environ, JAVA_HOME='/Users/wenshao/Install/jdk21', PATH='/Users/wenshao/Install/jdk21/bin:' + os.environ['PATH'])
    cmd = ['/Users/wenshao/Install/maven/bin/mvn', '-B', '-ntp', '-Dmaven.repo.local=/Users/wenshao/pr13674-rig/m2-head',
           '-Dcheckstyle.skip=true', '-Dspotbugs.skip=true', '-Dsurefire.failIfNoSpecifiedTests=false', f'-Dtest={TESTS}', 'test']
    t = time.time()
    with open(log, 'w') as f:
        rc = subprocess.call(cmd, cwd=SJ, stdout=f, stderr=subprocess.STDOUT, env=env)
    text = open(log).read()
    tot = re.findall(r'Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)\n', text)
    fails = sorted(set(re.findall(r'\[ERROR\]\s+(\w+)\.(\w+)', text)))
    compile_err = 'COMPILATION ERROR' in text
    return {'rc': rc, 'secs': round(time.time() - t), 'total': tot[-1] if tot else None, 'compile_error': compile_err,
            'failing': [f'{a}.{b}' for a, b in fails if a.endswith('Test')][:8]}

only = sys.argv[1:]
results = {}
if not only or 'BASE' in only:
    results['BASE'] = run('BASE')
    print('BASE', json.dumps(results['BASE']), flush=True)
for i, (name, path, old, new) in enumerate(MUTANTS, 1):
    tag = name.split()[0]
    if only and tag not in only:
        continue
    src = open(path).read()
    if src.count(old) != 1:
        results[tag] = {'error': f'anchor count {src.count(old)}'}
        print(tag, 'ANCHOR', src.count(old), flush=True)
        continue
    open(path, 'w').write(src.replace(old, new))
    try:
        r = run(tag)
    finally:
        open(path, 'w').write(src)
    r['killed'] = r['rc'] != 0
    r['name'] = name
    results[tag] = r
    print(tag, 'KILLED' if r['killed'] else 'SURVIVED', json.dumps(r), flush=True)
json.dump(results, open(f'{OUT}/summary.json', 'w'), indent=2)
