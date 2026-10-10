#!/usr/bin/env python3
"""Mutation spot-check of #13674 @77463e01 (round 3: N1 owner-only Shell answers, F1 split, F2 suppression): does the PR's own test set (six classes) kill each mutant?
Each mutant is a single anchored replacement in production code; the file is restored afterwards."""
import os, re, subprocess, sys, time, json

W = '/Users/wenshao/pr13674-rig/src-mut4'
SJ = f'{W}/packages/sdk-java/managed-agent-server'
P = f'{SJ}/src/main/java/com/alibaba/qwen/code/managedagent'
OUT = '/Users/wenshao/pr13674-rig/out/mut-r4'
os.makedirs(OUT, exist_ok=True)
TESTS = 'ManagedActionsTest,SurfaceAdmissionAcceptanceTest,ManagedWorkspaceAdmissionTest,Issue13180HardenedVerificationTest,WorkspaceSessionRetentionTest,QwenHostedHarnessConnectorTest,ManagedAgentApiContractTest'
CONN = f'{P}/harness/QwenHostedHarnessConnector.java'
SVC = f'{P}/service/ManagedAgentService.java'
STORE = f'{P}/store/ManagedAgentStore.java'
PROF = f'{P}/store/WorkspaceToolProfiles.java'
PROPS = f'{P}/config/ManagedAgentProperties.java'
ACT = f'{P}/store/ManagedActionStore.java'

MUTANTS = [
    ('N1a Shell answers fall back to the Workspace-operator arm', ACT,
     'if (!admitted && (shell || !workspaceOperatorAdmits(tenantId, ownerRow,',
     'if (!admitted && (!workspaceOperatorAdmits(tenantId, ownerRow,'),
    ('N1b owner-only applied to every bound Session (files lose operator handoff)', ACT,
     'boolean shell = ownerRow != null && WorkspaceToolProfiles.isShell(ownerRow.toolProfile());',
     'boolean shell = ownerRow != null && ownerRow.workspaceId() != null;'),
    ('F2a create path stops sending suppressChildAgents', CONN,
     '            if (WorkspaceToolProfiles.isShell(toolProfile(session))) {\n                builder.suppressChildAgents();\n            }\n',
     ''),
    ('F2b load path stops sending suppressChildAgents', CONN,
     '                driveRuntimeRecovery, cancellationTakeover,\n                WorkspaceToolProfiles.isShell(profile)));',
     '                driveRuntimeRecovery, cancellationTakeover,\n                false));'),
    ('F1a internal child close refuses Shell again', STORE,
     'return beginLifecycle(tenantId, sessionId, kind, actorDigest, key, digest, actorId, closeSupported, 0, false);',
     'return beginLifecycle(tenantId, sessionId, kind, actorDigest, key, digest, actorId, closeSupported, 0, true);'),
    ('F1b public lifecycle stops refusing Shell', STORE,
     'boolean supported, int protocolVersion) {\n        return beginLifecycle(tenantId, sessionId, kind, actorDigest, key, digest, actorId, supported, protocolVersion, true);',
     'boolean supported, int protocolVersion) {\n        return beginLifecycle(tenantId, sessionId, kind, actorDigest, key, digest, actorId, supported, protocolVersion, false);'),
]

def run(tag):
    log = f'{OUT}/{tag}.log'
    env = dict(os.environ, JAVA_HOME='/Users/wenshao/Install/jdk21', PATH='/Users/wenshao/Install/jdk21/bin:' + os.environ['PATH'])
    cmd = ['/Users/wenshao/Install/maven/bin/mvn', '-B', '-ntp', '-Dmaven.repo.local=/Users/wenshao/pr13674-rig/m2-h4',
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
