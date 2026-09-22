#!/usr/bin/env python3
"""Delete/neutralise one guard in RuntimeBrokerService per mutant; run the PR's RuntimeBrokerServiceTest (17 tests)."""
import os, sys, shutil, subprocess, concurrent.futures as cf
SRC = sys.argv[1] if len(sys.argv) > 1 else '/root/verify/pr12438-harness/sdk-java'
TEST = sys.argv[2] if len(sys.argv) > 2 else 'RuntimeBrokerServiceTest'
WORK = '/root/verify/pr12438-harness/mutants/work-' + os.path.basename(os.path.dirname(SRC)) + '-' + TEST.replace(',', '_')[:20]
S = 'runtime-broker/src/main/java/com/alibaba/qwen/code/runtimebroker/RuntimeBrokerService.java'
M = [
 ('M01', 'binding', 'requireLiveBinding: generation must match', "|| live.generation() != record.getGeneration()\n                ", "", 1),
 ('M02', 'binding', 'requireLiveBinding: lease must match', "\n                || !sameLease(live.lease(), record.getLease())", "", 1),
 ('M03', 'binding', 'provision: expired claim never publishes (fenced)', "                    if (currentClaim == null) {\n                        throw unavailable(\"runtime_provision_fenced\",", "                    if (false) {\n                        throw unavailable(\"runtime_provision_fenced\",", 1),
 ('M04', 'binding', 'provision failure writes FAILED', "                            failBinding(currentClaim);", "", 1),
 ('M05', 'binding', 'provision: READY CAS failure is fenced', "                    if (ready == null) {\n                        throw unavailable(\"runtime_provision_fenced\",", "                    if (false) {\n                        throw unavailable(\"runtime_provision_fenced\",", 1),
 ('M06', 'binding', 'ensureBinding: FAILED/DRAINING binding refused', "        if (record.getState()\n                != RuntimeBindingRecord.State.PROVISIONING) {\n            return failed(", "        if (false) {\n            return failed(", 1),
 ('M07', 'binding', 'provision: renewal of operation claim', "        renewal.start();\n        return safeStage(() -> provisioner", "        return safeStage(() -> provisioner", 1),
 ('M08', 'session', 'acquire: stored READY skips Runtime acquire', "            if (stored.getState() == RuntimeSessionRecord.State.READY) {\n                return CompletableFuture.completedFuture(context);\n            }\n", "", 1),
 ('M09', 'session', 'acquire: non-ACQUIRING refused', "            if (stored.getState()\n                    != RuntimeSessionRecord.State.ACQUIRING) {", "            if (false) {", 1),
 ('M10', 'session', 'acquire: same Harness/turnKind/scope', "                requireSameSession(context.session(), session);\n", "", 1),
 ('M11', 'session', 'requireSession: Harness Session must match', "            if (!value.session().getHarnessSessionId().equals(harnessId)) {", "            if (false) {", 1),
 ('M12', 'session', 'control: re-check READY under lock', "                        requireReadySessionRecord(context);\n                        context.beginControl();", "                        context.beginControl();", 1),
 ('M13', 'session', 'control: count in-flight control', "                        context.beginControl();\n", "", 1),
 ('M14', 'session', 'control: operation allowlist', "\n                || !CONTROL_OPERATIONS.contains(kind)", "", 1),
 ('M15', 'release', 'release: in-flight control blocks', "            if (context.hasActiveControl()\n                    || executionRepository", "            if (executionRepository", 1),
 ('M16', 'release', 'release: unsettled execution blocks', "\n                    || executionRepository.hasActiveByRuntimeSession(\n                            context.session().getRuntimeSessionId())) {", ") {", 1),
 ('M17', 'release', 'release: negative ack is not success', "                    } else if (!Boolean.TRUE.equals(released)) {", "                    } else if (false) {", 1),
 ('M18', 'release', 'release: persist RELEASED', "                            finishSessionRelease(releasing);\n", "", 1),
 ('M19', 'release', 'release: only READY/RELEASING may release', "            if (current.getState() != RuntimeSessionRecord.State.READY) {\n                throw conflict(\"runtime_session_not_ready\",\n                        \"Runtime Session is not ready for release\");", "            if (false) {\n                throw conflict(\"runtime_session_not_ready\",\n                        \"Runtime Session is not ready for release\");", 1),
 ('M20', 'release', 'releasedSession: Harness Session must match', "            if (!record.getSession().getHarnessSessionId().equals(\n                    harnessSessionId)) {", "            if (false) {", 1),
 ('M21', 'exec', 'create: reference sessionId must match', "        if (!context.session().getRuntimeSessionId().equals(\n                referenceSessionId)) {", "        if (false) {", 1),
 ('M22', 'exec', 'create: same idempotency request', "        if (!record.sameRequest(candidate)) {", "        if (false) {", 1),
 ('M23', 'exec', 'create: dispatch only PREPARED', "        if (record.getState() == ToolExecutionRecord.State.PREPARED) {\n            beginDispatch", "        if (true) {\n            beginDispatch", 1),
 ('M24', 'exec', 'dispatch: missing result is ambiguous', "                    if (error != null || result == null) {", "                    if (error != null) {", 1),
 ('M25', 'exec', 'dispatch: invalid result -> UNKNOWN', "                    } catch (RuntimeException exception) {\n                        markUnknown(executing.getExecutionCallId(),\n                                executing.getDispatchGeneration());\n                    }", "                    } catch (RuntimeException exception) {\n                    }", 1),
 ('M26', 'exec', 'dispatch: renew dispatch lease', "        try {\n            renewal.start();", "        try {\n            ", 1),
 ('M27', 'exec', 'enterExecuting: sticky cancel settles', "            if (current.isCancelRequested()) {\n                replacement = current.withResult(", "            if (false) {\n                replacement = current.withResult(", 1),
 ('M28', 'exec', 'settle: this dispatch must still own it', "                    || !ownsDispatch(current, dispatchGeneration)) {\n                return;\n            }\n            ToolExecutionRecord replacement", "                    ) {\n                return;\n            }\n            ToolExecutionRecord replacement", 1),
 ('M29', 'exec', 'requestCancel: already-requested short-circuit', "            if (current.isSettled() || current.isCancelRequested()) {", "            if (current.isSettled()) {", 1),
 ('M30', 'cancel', 'cancel: physical cancel only for CANCEL_REQUESTED', "\n                                || requested.getState()\n                                        != ToolExecutionRecord.State\n                                                .CANCEL_REQUESTED) {", ") {", 1),
 ('M31', 'cancel', 'cancel: only settled evidence settles', "        if (!\"settled\".equals(state)) {\n            return;\n        }", "", 1),
 ('M32', 'cancel', 'cancel: status must be a known Runtime state', "\n                || !RUNTIME_EXECUTION_STATES.contains(state)) {", ") {", 1),
 ('M33', 'exec', 'requireExecution: Runtime Session must match', "\n                || !record.getRuntimeSessionId().equals(\n                        context.session().getRuntimeSessionId())", "", 1),
 ('M34', 'exec', 'requireExecution: Harness Session must match', "        if (!record.getHarnessSessionId().equals(\n                context.session().getHarnessSessionId())\n                || ", "        if (", 1),
 ('M35', 'exec', 'requireExecution: binding generation must match', "\n                || record.getRuntimeGeneration()\n                        != context.binding().getGeneration()) {", ") {", 1),
 ('M36', 'misc', 'renewal cadence is one third of the lease', "        return Math.max(1, duration.toMillis() / 3);", "        return Math.max(1, duration.toMillis() * 3);", 1),
 ('M37', 'misc', 'close() stops the renewal scheduler', "        scheduler.shutdownNow();\n", "", 1),
 ('M38', 'misc', 'closed service rejects new work', "        if (closed.get()) {\n            throw new IllegalStateException(\"Runtime Broker is closed\");", "        if (false) {\n            throw new IllegalStateException(\"Runtime Broker is closed\");", 1),
]
ENV = dict(os.environ, JAVA_HOME='/root/Install/jdk21', PATH='/root/Install/jdk21/bin:/root/Install/maven/bin:' + os.environ['PATH'])
def run(m):
    mid, area, desc, old, new, _ = m
    d = os.path.join(WORK, mid); shutil.rmtree(d, ignore_errors=True)
    shutil.copytree(SRC, d, ignore=shutil.ignore_patterns('target'))
    p = os.path.join(d, S); s = open(p).read(); n = s.count(old)
    if n != 1:
        return (mid, area, desc, f'BAD_PATTERN({n})', '')
    open(p, 'w').write(s.replace(old, new))
    r = subprocess.run(['mvn', '-o', '-q', '-B', '-Djacoco.skip=true', '-Dtest=' + TEST, '-Dsurefire.failIfNoSpecifiedTests=false', 'test'], cwd=os.path.join(d, 'runtime-broker'), env=ENV, capture_output=True, text=True, timeout=600)
    out = r.stdout + r.stderr
    v = 'COMPILE_ERROR' if 'COMPILATION ERROR' in out else 'SURVIVED' if r.returncode == 0 else 'KILLED' if 'Tests run:' in out else f'INFRA({r.returncode})'
    ks = sorted({l.split('Test.')[1].split(':')[0].split(' ')[0] for l in out.splitlines() if l.startswith('[ERROR]   ') and 'Test.' in l})
    shutil.rmtree(d, ignore_errors=True)
    return (mid, area, desc, v, ','.join(ks))
if __name__ == '__main__':
    os.makedirs(WORK, exist_ok=True)
    only = set(os.environ.get('ONLY', '').split(',')) - {''}
    todo = [m for m in M if not only or m[0] in only]
    with cf.ThreadPoolExecutor(6) as ex:
        res = list(ex.map(run, todo))
    for mid, area, desc, v, k in res:
        print(f"{mid}\t{area}\t{v}\t{desc}\t{k}")
    print(f"# killed {sum(r[3]=='KILLED' for r in res)}/{len(res)}")
