#!/usr/bin/env python3
# VERIFICATION ONLY (PR #13163 R9): one-at-a-time mutants of the Java fixes landed since round 8
# (a9f7fec1, 234037eb, 00be8ed0, and the R3-4 guard pinned by 39267a90), each run against the
# focused Managed Agent test classes on JDK 21 / H2; sources are restored byte-for-byte afterwards.
import pathlib, subprocess, sys, json, re, os
W = pathlib.Path('/root/verify/pr13163-r9/h9')
MOD = W / 'packages/sdk-java/managed-agent-server'
D = MOD / 'src/main/java/com/alibaba/qwen/code/managedagent'
OUT = pathlib.Path('/root/verify/pr13163-r9/out/javamut'); OUT.mkdir(parents=True, exist_ok=True)
TESTS = 'WorkspaceStorageGuardTest,QwenHostedHarnessConnectorTest,ManagedActionsTest,ManagedSessionLifecycleTest,QwenHostedHarnessColdCancelRegressionTest,ManagedWorkspaceAdmissionTest'
CONN = D / 'harness/QwenHostedHarnessConnector.java'
WES = D / 'store/WorkspaceExecutionStore.java'
MAS = D / 'store/ManagedAgentStore.java'
M = [
  ('J1 grant-only refusal retryable on the action-response path (234037eb)', WES,
   'throw actionResponse ? unavailablePendingGrant() : unavailable();', 'throw unavailable();'),
  ('J2 cold attachment keeps the action-response classification (00be8ed0)', CONN,
   'doCreateOrLoad(tenantId, sessionId, true,\n                    workspaceExecution.verifiedRecoveryEnabled(), true);',
   'doCreateOrLoad(tenantId, sessionId, true,\n                    workspaceExecution.verifiedRecoveryEnabled(), false);'),
  ('J3 warm action-response check uses the action-response authority (234037eb)', CONN,
   '                workspaceExecution.authorizeActionResponse(session);\n                workspaceExecution.verifyMountForProbe(session.workspace());\n            } else {\n                workspaceExecution.authorize(session);',
   '                workspaceExecution.authorizePassiveAttachment(session);\n                workspaceExecution.verifyMountForProbe(session.workspace());\n            } else {\n                workspaceExecution.authorize(session);'),
  ('J4 action response uses delivery-time mount verification (a9f7fec1)', CONN,
   '                workspaceExecution.authorizeActionResponse(session);\n                workspaceExecution.verifyMountForProbe(session.workspace());\n            } else {\n                workspaceExecution.authorize(session);',
   '                workspaceExecution.authorize(session);\n            } else {\n                workspaceExecution.authorize(session);'),
  ('J5 only a retired (FAILED) receipt is superseded (R3-4 guard)', MAS,
   'if ("FAILED".equals(command.status()) && supersededByLaterMutation(', 'if (supersededByLaterMutation('),
]
env = {**os.environ, 'JAVA_HOME': '/root/Install/jdk21', 'PATH': '/root/Install/jdk21/bin:/root/Install/apache-maven-3.9.9/bin:' + os.environ['PATH']}
R = ['-Dmaven.repo.local=/root/verify/pr13163-r9/m2', '-Dmaven.repo.local.tail=/root/.m2/repository']
def run(tag):
    log = OUT / (re.sub(r'[^A-Za-z0-9]+', '_', tag)[:60] + '.log')
    p = subprocess.run(['mvn', '-B', '-ntp', '-o', *R, '-Dcheckstyle.skip=true', '-Dspotbugs.skip=true', f'-Dtest={TESTS}',
                        '-Dsurefire.failIfNoSpecifiedTests=false', 'test'], cwd=MOD, capture_output=True, text=True, env=env)
    text = p.stdout + p.stderr; log.write_text(text)
    totals = re.findall(r'Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)\s*$', text, re.M)
    failed = sorted(set(re.findall(r'\[ERROR\]\s+([A-Za-z0-9_]+\.[A-Za-z0-9_\[\]\(\), "=.-]+?)(?: -- Time| »|:\d)', text)))
    return p.returncode, (totals[-1] if totals else None), failed[:12]
only = sys.argv[1:]
results = []
if not only or 'control' in only:
    rc, tot, failed = run('control')
    results.append({'mutant': 'control (unmutated head)', 'rc': rc, 'totals': tot, 'failed': failed}); print(json.dumps(results[-1]), flush=True)
for tag, f, a, b in M:
    if only and not any(o in tag for o in only):
        continue
    orig = f.read_text(); n = orig.count(a)
    if n != 1:
        results.append({'mutant': tag, 'error': f'anchor matched {n} times'}); print(json.dumps(results[-1]), flush=True); continue
    try:
        f.write_text(orig.replace(a, b, 1))
        rc, tot, failed = run(tag)
    finally:
        f.write_text(orig)
    assert f.read_text() == orig
    results.append({'mutant': tag, 'rc': rc, 'totals': tot, 'killed': rc != 0, 'failed': failed}); print(json.dumps(results[-1]), flush=True)
(OUT / 'results.json').write_text(json.dumps(results, indent=2))
