#!/usr/bin/env python3
"""Delete/neutralise one guard in RuntimeBrokerService per mutant; run the PR's RuntimeBrokerServiceTest."""
import os, sys, shutil, subprocess, concurrent.futures as cf
SRC = sys.argv[1] if len(sys.argv) > 1 else '/root/verify/pr12438-r2-harness/sdk-java'
TEST = sys.argv[2] if len(sys.argv) > 2 else 'RuntimeBrokerServiceTest'
WORK = '/root/verify/pr12438-r2-harness/mutants/work-' + os.path.basename(os.path.dirname(SRC)) + '-' + TEST.replace(',', '_')[:20]
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
 ('M22', 'exec', 'create: same idempotency request', "        if (!record.sameRequest(candidate)) {", "        if (false) {", 1),
 ('M24', 'exec', 'dispatch: missing result is ambiguous', "                    if (error != null || result == null) {", "                    if (error != null) {", 1),
 ('M25', 'exec', 'dispatch: invalid result -> UNKNOWN', "                    } catch (RuntimeException exception) {\n                        markUnknown(executing.getExecutionCallId(),\n                                executing.getDispatchGeneration());\n                    }", "                    } catch (RuntimeException exception) {\n                    }", 1),
 ('M26', 'exec', 'dispatch: renew dispatch lease', "        try {\n            renewal.start();", "        try {\n            ", 1),
 ('M27', 'exec', 'enterExecuting: sticky cancel settles', "            if (current.isCancelRequested()) {\n                replacement = current.withResult(", "            if (false) {\n                replacement = current.withResult(", 1),
 ('M28', 'exec', 'settle: this dispatch must still own it', "                    || !ownsDispatch(current, dispatchGeneration)) {\n                return;\n            }\n            ToolExecutionRecord replacement", "                    ) {\n                return;\n            }\n            ToolExecutionRecord replacement", 1),
 ('M29', 'exec', 'requestCancel: already-requested short-circuit', "            if (current.isSettled() || current.isCancelRequested()) {", "            if (current.isSettled()) {", 1),
 ('M31', 'cancel', 'cancel: only settled evidence settles', "        if (!\"settled\".equals(state)) {\n            return;\n        }", "", 1),
 ('M32', 'cancel', 'cancel: status must be a known Runtime state', "\n                || !RUNTIME_EXECUTION_STATES.contains(state)) {", ") {", 1),
 ('M33', 'exec', 'requireExecution: Runtime Session must match', "\n                || !record.getRuntimeSessionId().equals(\n                        context.session().getRuntimeSessionId())", "", 1),
 ('M34', 'exec', 'requireExecution: Harness Session must match', "        if (!record.getHarnessSessionId().equals(\n                context.session().getHarnessSessionId())\n                || ", "        if (", 1),
 ('M35', 'exec', 'requireExecution: binding generation must match', "\n                || record.getRuntimeGeneration()\n                        != context.binding().getGeneration()) {", ") {", 1),
 ('M36', 'misc', 'renewal cadence is one third of the lease', "        return Math.max(1, duration.toMillis() / 3);", "        return Math.max(1, duration.toMillis() * 3);", 1),
 ('M37', 'misc', 'close() stops the renewal scheduler', "        scheduler.shutdownNow();\n", "", 1),
 ('M38', 'misc', 'closed service rejects new work', "        if (closed.get()) {\n            throw new IllegalStateException(\"Runtime Broker is closed\");", "        if (false) {\n            throw new IllegalStateException(\"Runtime Broker is closed\");", 1),
 ('M21', 'exec', 'create: reference sessionId must match', "            if (!context.session().getRuntimeSessionId().equals(\n                    referenceSessionId)) {", "            if (false) {", 1),
 ('M23', 'exec', 'create: live EXECUTING claim is not re-driven', "\n                        || !record.hasLiveDispatchAt(clock.instant()));", "\n                        || true);", 1),
 ('M30', 'cancel', 'cancel: physical cancel only for CANCEL_REQUESTED', "                    if (requested.getState()\n                            != ToolExecutionRecord.State.CANCEL_REQUESTED) {\n                        return CompletableFuture.completedFuture(requested);\n                    }\n", "", 1),
 ('N01', 'r2-binding', 'ensureBinding: READY still finishing here is joined (finding 1b)', "            CompletableFuture<BindingContext> finishing =\n                    bindingOperations.get(record.getBindingId());\n            if (finishing != null) {\n                return finishing;\n            }\n", "", 1),
 ('N02', 'r2-binding', 'provisionBinding: published binding never re-provisioned (finding 1a)', "        if (claimed.getState()\n                != RuntimeBindingRecord.State.PROVISIONING) {\n            return claimed.getState()", "        if (false) {\n            return claimed.getState()", 1),
 ('N03', 'r2-binding', 'stopAndGet: shutdown is a lost claim (R1-8)', "            return !closed.get() && valid.get() ? current.get() : null;", "            return valid.get() ? current.get() : null;", 1),
 ('N04', 'r2-exec', 'renewal: lapsed claim fenced via claimDispatch (R1-2)', "                    executionRepository.claimDispatch(executionCallId,\n                            brokerOwnerId, dispatchLeaseDuration);\n", "", 1),
 ('N05', 'r2-exec', 'renewal: transient exception keeps renewing (R1-2)', "                // A transient repository failure does not prove claim loss.", "                close();", 1),
 ('N06', 'r2-exec', 'create: unsent DISPATCHING is re-driven (R1-2)', "\n                        || record.getState()\n                                == ToolExecutionRecord.State.DISPATCHING", "", 1),
 ('N07', 'r2-exec', 'create: expired EXECUTING is fenced on retry (R1-2)', "\n                        || !record.hasLiveDispatchAt(clock.instant()));", ");", 1),
 ('N08', 'r2-cancel', 'cancel: DISPATCHING is driven to settle (R1-2)', "                    if (requested.getState()\n                                    == ToolExecutionRecord.State.DISPATCHING\n                            || (", "                    if (false\n                            || (", 1),
 ('N09', 'r2-cancel', 'cancel: expired CANCEL_REQUESTED is fenced (R1-2)', "                                    && !requested.hasLiveDispatchAt(\n                                            clock.instant()))) {", "                                    && false)) {", 1),
 ('N10', 'r2-control', 'control: sync transport throw releases the slot (R1-3)', "                        context.endControl();\n                        throw failure;", "                        throw failure;", 1),
 ('N11', 'r2-errors', 'cancel: invalid settled result is coded (R1-6)', "        } catch (IllegalArgumentException exception) {\n            throw unavailable(\"runtime_execution_cancel_failed\",\n                    \"Runtime cancellation returned an invalid result\",\n                    exception);\n        }", "        } catch (IllegalStateException exception) {\n            throw exception;\n        }", 1),
 ('N12', 'r2-errors', 'referenceString: invalid id is coded (R1-4)', "        } catch (IllegalArgumentException exception) {\n            throw invalid(\"runtime_reference_invalid\",\n                    \"reference \" + field + \" is invalid\");", "        } catch (IllegalStateException exception) {\n            throw invalid(\"runtime_reference_invalid\",\n                    \"reference \" + field + \" is invalid\");", 1),
 ('N13', 'r2-errors', 'create: reference normalised before use (R1-5)', "            Map<String, Object> safeReference = immutableMap(reference,\n                    \"reference\");", "            Map<String, Object> safeReference = reference;", 1),
 ('N14', 'r2-errors', 'safeStage: Error becomes a failed stage (R1-3)', "        } catch (RuntimeException | Error exception) {\n            return failed(exception);", "        } catch (RuntimeException exception) {\n            return failed(exception);", 1),
 ('N15', 'r2-exec', 'dispatch: only a DISPATCHING claim is executed', "        if (claimed == null\n                || claimed.getState()\n                        != ToolExecutionRecord.State.DISPATCHING) {", "        if (claimed == null) {", 1),
 ('N16', 'r2-exec', 'create: READY re-checked under the Session lock', "            requireReadySessionRecord(context);\n            Map<String, Object> safeReference", "            Map<String, Object> safeReference", 1),
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
