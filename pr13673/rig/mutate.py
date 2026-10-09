#!/usr/bin/env python3
# VERIFICATION RIG ONLY (PR #13673): targeted mutation sampling on a disposable worktree at the PR head.
# usage: mutate.py [ids...]   -> results appended to out/mutants.jsonl
import json, os, re, subprocess, sys, time

W = '/Users/wenshao/git/qwen-code-pr13673-mut/packages/sdk-java'
M2 = '/Users/wenshao/pr13673-rig/m2-mut'
OUT = '/Users/wenshao/pr13673-rig/out/mutants' + ('-p2' if os.environ.get('PHASE2') == '1' else '-full' if os.environ.get('FULL') == '1' else '') + '.jsonl'
B = 'runtime-broker/src/main/java/com/alibaba/qwen/code/runtimebroker/'
S = 'managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/'
BT = 'RuntimeHarnessDrainTest,InMemoryRepositoryTest,JdbcRepositoryTest'
ST = 'WorkspaceRuntimeTest,RuntimeBrokerFlywaySchemaTest,SessionLifecycleCoordinatorTest'
# phase 2: server unit tests that drive the broker's stopped release / drain through real JDBC repositories
ST2 = ST + ',ManagedSessionLifecycleTest,EmbeddedRuntimeBrokerTest,WorkspaceRuntimeTransportTest,WorkspaceSessionCloseTest,WorkspaceLifecycleStoreTest,WorkspaceStorageGuardTest,RuntimeRecoveryCoordinatorTest,ManagedWorkspaceAdmissionTest,WorkspaceSessionRetentionTest'
PHASE2 = os.environ.get('PHASE2') == '1'
ENV = dict(os.environ, JAVA_HOME='/Users/wenshao/Install/jdk21', PATH='/Users/wenshao/Install/jdk21/bin:' + os.environ['PATH'])

# (id, review ref, module, file, regex, replacement, note)
MUTANTS = [
    ('B1', 'R1-7', 'broker', B + 'JdbcRuntimeBindingRepository.java',
     r'" SET holder_key = NULL, binding_id = NULL, runtime_generation = NULL, runtime_session_id = NULL"',
     '" SET holder_key = NULL"', 'stopped clear nulls holder_key only (torn lease row)'),
    ('B2', 'R1-6', 'broker', B + 'JdbcRuntimeBindingRepository.java',
     r'(&& row\.getObject\("runtime_generation"\) == null\) \{\s*)return;',
     r'\1throw new RuntimeBrokerException(409, "workspace_close_identity_unverified", "mutant", false);',
     'already-cleared (all-null) holder row refused instead of idempotent'),
    ('B3', 'design', 'broker', B + 'JdbcRuntimeBindingRepository.java',
     r'if \(!session\.getRuntimeSessionId\(\)\.equals\(holderSession\)\) \{\s*return;\s*\}',
     '', 'clears the holder of ANOTHER original Session of the same binding'),
    ('B4', 'design', 'broker', B + 'JdbcRuntimeBindingRepository.java',
     r'if \(JdbcToolExecutionRepository\.hasActiveByBinding\(connection, binding\.getBindingId\(\), binding\.getGeneration\(\)\)\) \{(\s*throw new RuntimeBrokerException\(409, "workspace_close_execution_unsettled",\s*"Original resources remain active", false\);\s*\}\s*RuntimeSessionRecord updated = JdbcRuntimeSessionRepository\.compareAndSet)',
     r'if (false) {\1', 'JDBC stopped release ignores active executions'),
    ('B5', 'R1-11', 'broker', B + 'RuntimeBrokerService.java',
     r'if \(executionRepository\.hasActiveByBinding\(binding\.getBindingId\(\), binding\.getGeneration\(\)\)\) \{(\s*throw conflict\("workspace_close_execution_unsettled", "Original resources are unsettled"\);\s*\}\s*finishSessionRelease\()',
     r'if (false) {\1', 'BindingRenewal.releaseStoppedSession ignores active executions'),
    ('B6', 'R1-12', 'broker', B + 'RuntimeBrokerService.java',
     r'\s*\|\| binding\.getOperationLeaseUntil\(\) == null\s*\|\| !binding\.getOperationLeaseUntil\(\)\.isAfter\(clock\.instant\(\)\)\) \{(\s*throw unavailable\("runtime_close_claim_pending", "Original drain claim expired"\);)',
     r') {\1', 'requireDrainClaim drops the lease-expiry arm'),
    ('B7', 'design', 'broker', B + 'RuntimeBrokerService.java',
     r'if \(executionRepository\.hasActiveByBinding\(binding\.getBindingId\(\), binding\.getGeneration\(\)\)\) \{(\s*throw conflict\("workspace_close_execution_unsettled", "Original resources are unsettled"\);\s*\}\s*// Absence cannot confirm)',
     r'if (false) {\1', 'NOT_FOUND branch stops the worker despite active executions'),
    ('B8', 'R1-10', 'broker', B + 'RuntimeBrokerService.java',
     r'if \(receipt == null \|\| !receipt\.matches\(expected\)\) \{', 'if (receipt == null) {',
     'persistDrainReceipt accepts a foreign stop receipt'),
    ('B9', 'R1-10', 'broker', B + 'RuntimeBrokerService.java',
     r'if \(!receipt\.matches\(binding\) \|\| !binding\.getBindingId\(\)', 'if (!binding.getBindingId()',
     'releaseStoppedSession skips the receipt identity check'),
    ('B10', 'triage #1', 'broker', B + 'RuntimeBrokerService.java',
     r'if \(existing == null && error != null\) \{', 'if (false) {',
     'failed READY adoption keeps its cache (6e2e151 fix reverted)'),
    ('B11', 'design', 'broker', B + 'RuntimeAdmission.java',
     r'\s*\|\| !binding\.hasLiveOperationAt\(now\)\) \{', ') {', 'requireStoppedRelease ignores the database claim lease'),
    ('B12', 'design', 'broker', B + 'RuntimeAdmission.java',
     r'\s*\|\| claim\.getOperationGeneration\(\) != binding\.getOperationGeneration\(\)', '',
     'requireStoppedRelease ignores a replaced claim generation'),
    ('B13', 'R1-8', 'broker', B + 'RuntimeBrokerService.java',
     r'&& bindingRepository\.isHarnessDraining\(record\.getSession\(\)\.getScope\(\)\.getTenantId\(\),\s*harnessSessionId\)\) \{',
     '&& true) {', 'unfenced ordinary release also re-observes the original worker'),
    ('B14', 'R1-9', 'broker', B + 'RuntimeBrokerService.java',
     r'&& observation\.getLossEvidence\(\)\.matches\(binding\.getProvisionSeed\(\),\s*binding\.getResourceHandle\(\), binding\.getLease\(\)\)\) \{',
     ') {', 'NOT_FOUND accepted without matching loss evidence'),
    ('S1', 'R1-4', 'server', S + 'store/WorkspaceExecutionStore.java',
     r'if \(holder == null\) \{\s*return binding == null && session == null && row\.getObject\("runtime_generation"\) == null;',
     'if (holder == null) {\n                        return false;', 'canStopDrained refuses a holder-free (released) lease row'),
    ('S2', 'design', 'server', S + 'store/WorkspaceExecutionStore.java',
     r'\s*\|\| jdbc\.queryForObject\("SELECT COUNT\(\*\) FROM qwen_tool_execution WHERE binding_id = \?"\s*\+ " AND runtime_generation = \? AND execution_state NOT IN \(\'SETTLED\', \'ABANDONED\'\)",\s*Long\.class, saved\.getBindingId\(\), saved\.getGeneration\(\)\) != 0\)',
     ')', 'canStopDrained ignores unsettled executions'),
    ('S3', 'design', 'server', S + 'store/WorkspaceExecutionStore.java',
     r'toInstant\(\)\.isAfter\(java\.time\.Instant\.ofEpochSecond\(\s*row\.getLong\("db_seconds"\), row\.getLong\("db_micros"\) \* 1000\)\)',
     'toInstant() != null', 'canStopDrained ignores an expired operation lease'),
    ('S4', 'design', 'server', S + 'service/WorkspaceRuntimeProvisioner.java',
     r'binding\.getRequest\(\)\.isManagedContext\(\) \? !executionStore\.canStopDrained\(binding\)\s*: executionStore\.hasHolder\(binding\)',
     'executionStore.hasHolder(binding)', 'provisioner reverts to base (any holder refuses stop)'),
    ('S5', 'design', 'server', S + 'store/WorkspaceExecutionStore.java',
     r'return holders\.isEmpty\(\) \|\| holders\.size\(\) == 1 && holders\.getFirst\(\);',
     'return true;', 'canStopDrained accepts foreign/malformed holders'),
    ('S6', 'design', 'server', S + 'store/WorkspaceExecutionStore.java',
     r'Long\.class, binding, generation, session, saved\.getRequest\(\)\.getIsolationKey\(\)\) == 1;',
     'Long.class, binding, generation, session, saved.getRequest().getIsolationKey()) >= 0;',
     'canStopDrained skips the holder Session ownership check'),
]


def run(module, tests, full=False):
    d = W + ('/runtime-broker' if module == 'broker' else '/managed-agent-server')
    args = ['mvn', '-B', '-ntp', '-q' if False else '-B', f'-Dmaven.repo.local={M2}', '-Dcheckstyle.skip=true',
            '-Dspotbugs.skip=true', '-Dsurefire.failIfNoSpecifiedTests=false']
    if not full:
        args.append(f'-Dtest={tests}')
    args.append('test')
    t0 = time.time()
    p = subprocess.run(args, cwd=d, env=ENV, capture_output=True, text=True)
    out = p.stdout + p.stderr
    runs = re.findall(r'Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)\n', out)
    failed = re.findall(r'\[ERROR\]\s+(\S+\.\w+:\d+|\S+)\s.*?(?:Expected|expected|==>|Exception|AssertionFailed)', out)[:4]
    compile_err = 'COMPILATION ERROR' in out
    tot = runs[-1] if runs else None
    return {'exit': p.returncode, 'secs': round(time.time() - t0), 'total': tot, 'compileError': compile_err,
            'failing': sorted(set(re.findall(r'\[ERROR\]   (\w+\.\w+)', out)))[:6]}


ids = sys.argv[1:]
full = os.environ.get('FULL') == '1'
for mid, ref, module, f, rx, rep, note in MUTANTS:
    if ids and mid not in ids:
        continue
    path = W + '/' + f
    src = open(path).read()
    # S2/S3: the same text also appears in the pre-existing releaseLost below; mutate the first (canStopDrained) only.
    first_only = mid in ('S2', 'S3') and len(re.findall(rx, src)) == 2 and src.index('canStopDrained') < src.index('releaseLost')
    new, n = re.subn(rx, rep, src, count=1 if first_only else 0)
    if n != 1:
        res = {'id': mid, 'ref': ref, 'note': note, 'error': f'pattern matched {n} times'}
    else:
        open(path, 'w').write(new)
        try:
            if PHASE2 and module == 'broker':
                inst = subprocess.run(['mvn', '-B', '-ntp', '-q', f'-Dmaven.repo.local={M2}', '-DskipTests', '-Dcheckstyle.skip=true',
                                       '-Dspotbugs.skip=true', 'install'], cwd=W + '/runtime-broker', env=ENV, capture_output=True, text=True)
                r = run('server', ST2, False) if inst.returncode == 0 else {'exit': 0, 'compileError': True, 'secs': 0, 'total': None, 'failing': []}
            else:
                r = run(module, ST2 if PHASE2 else (BT if module == 'broker' else ST), full)
        finally:
            subprocess.run(['git', 'checkout', '--', f], cwd=W)
        verdict = 'invalid' if r['compileError'] else ('killed' if r['exit'] != 0 else 'SURVIVED')
        res = {'id': mid, 'ref': ref, 'module': module, 'note': note, 'verdict': verdict, 'full': full, 'phase2': PHASE2, **r}
    print(json.dumps(res), flush=True)
    open(OUT, 'a').write(json.dumps(res) + '\n')
assert subprocess.run(['git', 'status', '--porcelain'], cwd=W, capture_output=True, text=True).stdout.strip() == '', 'worktree dirty'

if PHASE2:  # restore the unmutated broker artifact in the isolated repository
    subprocess.run(['mvn', '-B', '-ntp', '-q', f'-Dmaven.repo.local={M2}', '-DskipTests', '-Dcheckstyle.skip=true', '-Dspotbugs.skip=true', 'install'],
                   cwd=W + '/runtime-broker', env=ENV, check=True)
