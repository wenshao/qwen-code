#!/usr/bin/env python3
"""Mutation spot-check of #13674 @4b2bb453 (round 4: reserved internal profile, definition pins, Shell approval guards, carry-overs): does the PR's own test set (14 classes) kill each mutant?
Each mutant is a single anchored replacement in production code; the file is restored afterwards."""
import os, re, subprocess, sys, time, json

W = '/Users/wenshao/pr13674-rig/src-mut5'
SJ = f'{W}/packages/sdk-java/managed-agent-server'
P = f'{SJ}/src/main/java/com/alibaba/qwen/code/managedagent'
OUT = '/Users/wenshao/pr13674-rig/out/mut-r5'
os.makedirs(OUT, exist_ok=True)
TESTS = 'SurfaceAdmissionAcceptanceTest,ManagedCwdChangeOperationTest,ManagedWorkspaceAdmissionTest,ManagedAgentPropertiesTest,Issue13180HardenedVerificationTest,ManagedAgentApiContractTest,WorkspaceSessionRetentionTest,QwenHostedHarnessConnectorTest,ManagedActionsTest,SessionLifecycleCoordinatorTest,ChildResultRelayTest,ManagedTaskCancelOperationTest,ManagedAgentDefinitionAdmissionTest,AgentDefinitionCompilerTest'
COMP = f'{P}/store/AgentDefinitionCompiler.java'
CONN = f'{P}/harness/QwenHostedHarnessConnector.java'
SVC = f'{P}/service/ManagedAgentService.java'
STORE = f'{P}/store/ManagedAgentStore.java'
PROF = f'{P}/store/WorkspaceToolProfiles.java'
PROPS = f'{P}/config/ManagedAgentProperties.java'
ACT = f'{P}/store/ManagedActionStore.java'

MUTANTS = [
    ('T1 compiler accepts the reserved profile when allowlisted', COMP,
     'WorkspaceToolProfiles.INTERNAL_TEAM_LEAD.equals(profile)\n                        || !toolProfiles',
     '!toolProfiles'),
    ('T2 replay ignores the policy kind in both directions', STORE,
     '                || internalTeamLead != WorkspaceToolProfiles.INTERNAL_TEAM_LEAD.equals(session.toolProfile())\n',
     ''),
    ('T2b public replay may resolve to an internal record (internal direction kept)', STORE,
     '|| internalTeamLead != WorkspaceToolProfiles.INTERNAL_TEAM_LEAD.equals(session.toolProfile())',
     '|| internalTeamLead && !WorkspaceToolProfiles.INTERNAL_TEAM_LEAD.equals(session.toolProfile())'),
    ('P1 the reserved profile joins the public Shell family', PROF,
     'return SHELL.equals(profile) || "hosted-workspace-shell/2".equals(profile);',
     'return SHELL.equals(profile) || "hosted-workspace-shell/2".equals(profile) || INTERNAL_TEAM_LEAD.equals(profile);'),
    ('D1 definition Shell initial input skips the flag gate', STORE,
     '        if (!input.isEmpty() && WorkspaceToolProfiles.isPublicShell(pin.toolProfile())\n                && !workspaceShellEnabled) {\n            throw workspaceExecutionUnavailable();\n        }\n',
     ''),
    ('D2 bound creation ignores the definition pin (pre-merge resolution)', STORE,
     'workspace == null ? null : pin.toolProfile(),',
     'workspace == null ? null : workspaceShellEnabled ? WorkspaceToolProfiles.SHELL : WorkspaceToolProfiles.FILES,'),
    ('A1 lifecycle settle skips the Shell approval check', CONN,
     'operation.sessionId());\n        requireShellApproval(session);\n        AttachmentKey key = new AttachmentKey(operation.tenantId()',
     'operation.sessionId());\n        AttachmentKey key = new AttachmentKey(operation.tenantId()'),
    ('A2 message-stop load skips the Shell approval check', CONN,
     'SessionRecord session = sessions.requireSession(tenantId, sessionId);\n        requireShellApproval(session);\n        AttachmentKey key = new AttachmentKey(tenantId, sessionId);',
     'SessionRecord session = sessions.requireSession(tenantId, sessionId);\n        AttachmentKey key = new AttachmentKey(tenantId, sessionId);'),
    ('N1a Shell answers fall back to the Workspace-operator arm', ACT,
     'if (!admitted && (shell || !workspaceOperatorAdmits(tenantId, ownerRow,',
     'if (!admitted && (!workspaceOperatorAdmits(tenantId, ownerRow,'),
    ('F2a create path stops sending suppressChildAgents', CONN,
     '            if (WorkspaceToolProfiles.isPublicShell(toolProfile(session))) {\n                builder.suppressChildAgents();\n            }\n',
     ''),
]

def run(tag):
    log = f'{OUT}/{tag}.log'
    env = dict(os.environ, JAVA_HOME='/Users/wenshao/Install/jdk21', PATH='/Users/wenshao/Install/jdk21/bin:' + os.environ['PATH'])
    cmd = ['/Users/wenshao/Install/maven/bin/mvn', '-B', '-ntp', '-Dmaven.repo.local=/Users/wenshao/pr13674-rig/m2-h5',
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
