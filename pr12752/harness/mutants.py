#!/usr/bin/env python3
"""Mutation matrix for PR #12752 fault gates.

Each mutant copies the pristine module (mut/base), applies exact-once string
replacements, and runs the named gate(s) under -Pfault-gates. Worker mutants
patch a copy of dist/ instead and leave the Java module untouched.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

SP = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/ee3d6caa-6091-40f9-ade7-5e9a755f3096/scratchpad'
BASE = f'{SP}/mut/base'
WORK = f'{SP}/mut/work'
WT = f'{SP}/wt'
PKG = 'src/main/java/com/alibaba/qwen/code/runtimebroker/'
TPKG = 'src/test/java/com/alibaba/qwen/code/runtimebroker/'
SVC = PKG + 'RuntimeBrokerService.java'
REPO = PKG + 'JdbcToolExecutionRepository.java'
LOCAL = PKG + 'LocalProcessRuntimeProvisioner.java'
CHUNK = 'chunks/managed-runtime-attestation-worker-6JOZKKYI.js'

LR = 'LostResponseFaultGateTest'
PC = 'ProcessCrashFaultGateTest'
CS = 'ConcurrencyStorageFaultGateTest'

ERR = ('java.util.Map.of("executionStatus", "error", "responseParts", '
       'java.util.List.of())')

MUTANTS = {
    'M01': dict(
        desc='failed execute settles as error instead of UNKNOWN',
        gates=f'{LR}#aLostExecute*+{PC}#aWorkerKilled*',
        edits=[(SVC,
                """                    if (error != null || result == null) {
                        markUnknown(executing.getExecutionCallId(),
                                executing.getDispatchGeneration());
                        return null;
                    }""",
                f"""                    if (error != null || result == null) {{
                        settleExecution(executing.getExecutionCallId(),
                                executing.getDispatchGeneration(), {ERR});
                        return null;
                    }}""")]),
    'M01b': dict(
        desc='failed execute settles as error instead of UNKNOWN (FG3 worker killed)',
        gates=f'{PC}#aWorkerKilled*',
        edits=None),
    'M02': dict(
        desc='failed execute is sent once more',
        gates=f'{LR}#aLostExecute*',
        edits=[(SVC,
                """                context.session(), executing.getReference()))
                .<Void>handle((result, error) -> {""",
                """                context.session(), executing.getReference()))
                .exceptionallyCompose(retry -> transport.execute(
                        context.lease(), context.session(),
                        executing.getReference()))
                .<Void>handle((result, error) -> {""")]),
    'M03': dict(
        desc='failed status lookup counts as not_started',
        gates=f'{LR}#aLostStatus*',
        edits=[(SVC,
                """                        } else {
                            lookup.completeExceptionally(error);
                        }""",
                """                        } else {
                            lookup.complete(java.util.Map.of("state",
                                    "settled", "result", java.util.Map.of(
                                            "executionStatus", "not_started",
                                            "responseParts",
                                            java.util.List.of())));
                        }""")]),
    'M04': dict(
        desc='failed cancel counts as cancelled',
        gates=f'{LR}#aLostCancel*',
        edits=[(SVC,
                """                    return mapFailure(safeStage(() -> transport.cancel(
                            context.lease(), context.session(),
                            requested.getReference())),""",
                """                    return mapFailure(safeStage(() -> transport.cancel(
                            context.lease(), context.session(),
                            requested.getReference()))
                            .exceptionally(lost -> java.util.Map.of(
                                    "state", "settled", "result",
                                    java.util.Map.of("executionStatus",
                                            "cancelled", "responseParts",
                                            java.util.List.of()))),""")]),
    'M05': dict(
        desc='service ignores a failed attestation',
        gates=f'{LR}#aLostAttestation*',
        edits=[(SVC,
                """                    return mapFailure(safeStage(() -> transport.attest(lease,
                            request, seed)), "runtime_provision_failed",
                            "Runtime attestation failed")
                            .thenApply(attestation -> {
                                if (!validAttestation(attestation, lease,""",
                """                    return mapFailure(safeStage(() -> transport.attest(lease,
                            request, seed)).exceptionally(lost -> null),
                            "runtime_provision_failed",
                            "Runtime attestation failed")
                            .thenApply(attestation -> {
                                if (attestation != null
                                        && !validAttestation(attestation, lease,""")]),
    'M06': dict(
        desc='provisioner ignores a failed attestation',
        gates=f'{LR}#aLostAttestation*',
        edits=[(LOCAL,
                """        } catch (ExecutionException exception) {
            if (exception
                    .getCause() instanceof RuntimeBrokerException failure) {
                throw failure;
            }
            throw failed("Managed Runtime attestation failed.", exception);
        } catch (Exception exception) {
            throw failed("Managed Runtime attestation failed.", exception);
        }""",
                """        } catch (Exception ignored) {
            // mutant: attestation failure ignored
        }""")]),
    'M07': dict(
        desc='claimDispatch re-grants a lapsed EXECUTING claim',
        gates=f'{PC}#aRestartedBroker*',
        edits=[(REPO,
                """            if (current.getState() == ToolExecutionRecord.State.EXECUTING
                    || current.getState()
                            == ToolExecutionRecord.State.CANCEL_REQUESTED) {
                ToolExecutionRecord unknown = current.withUnknown()""",
                """            if (false && (current.getState() == ToolExecutionRecord.State.EXECUTING
                    || current.getState()
                            == ToolExecutionRecord.State.CANCEL_REQUESTED)) {
                ToolExecutionRecord unknown = current.withUnknown()""")]),
    'M08': dict(
        desc='Runtime unknown counts as not_started',
        gates=f'{PC}#aRestartedBroker*',
        edits=[(SVC,
                """        String runtimeState = (String) state;
        if (!"settled".equals(runtimeState)) {""",
                """        if ("unknown".equals(state)) {
            status = java.util.Map.of("state", "settled", "result",
                    java.util.Map.of("executionStatus", "not_started",
                            "responseParts", java.util.List.of()));
            state = "settled";
        }
        String runtimeState = (String) state;
        if (!"settled".equals(runtimeState)) {""")]),
    'M09': dict(
        desc='fenced dispatcher commits its late answer',
        gates=f'{CS}#aStaleBroker*',
        edits=[(SVC,
                """        for (int attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
            if (current == null || current.isSettled()
                    || current.getState()
                            == ToolExecutionRecord.State.UNKNOWN
                    || !ownsDispatch(current, dispatchGeneration)) {
                return;
            }
            ToolExecutionRecord replacement = current.withResult(result,""",
                """        for (int attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
            if (current != null && current.getState()
                    == ToolExecutionRecord.State.UNKNOWN) {
                executionRepository.resolveUnknown(current, result,
                        clock.instant());
                return;
            }
            if (current == null || current.isSettled()
                    || current.getState()
                            == ToolExecutionRecord.State.UNKNOWN
                    || !ownsDispatch(current, dispatchGeneration)) {
                return;
            }
            ToolExecutionRecord replacement = current.withResult(result,""")]),
    'M10': dict(
        desc='failed commit retried in a loop',
        gates=f'{CS}#aDatabaseOutage*',
        edits=[(SVC,
                """                    try {
                        settleExecution(executing.getExecutionCallId(),
                                executing.getDispatchGeneration(), result);
                    } catch (RuntimeException exception) {
                        markUnknown(executing.getExecutionCallId(),
                                executing.getDispatchGeneration());
                    }""",
                """                    while (true) {
                        try {
                            settleExecution(executing.getExecutionCallId(),
                                    executing.getDispatchGeneration(), result);
                            break;
                        } catch (RuntimeException exception) {
                            try {
                                Thread.sleep(200);
                            } catch (InterruptedException stop) {
                                break;
                            }
                        }
                    }""")]),
    'M11': dict(
        desc="dead worker's UNKNOWN call settled as error",
        gates=f'{PC}#aWorkerKilled*',
        edits=[(SVC,
                """        return mapFailure(safeStage(() -> reconcile(harnessId, runtimeId,
                executionId)), "runtime_execution_reconcile_failed",""",
                f"""        return mapFailure(safeStage(() -> {{
            try {{
                return reconcile(harnessId, runtimeId, executionId);
            }} catch (RuntimeBrokerException dead) {{
                if (!"runtime_execution_evidence_unavailable".equals(
                        dead.getCode())) {{
                    throw dead;
                }}
                ToolExecutionRecord errored = executionRepository
                        .resolveUnknown(executionRepository
                                .findByExecutionCallId(executionId),
                                {ERR}, clock.instant());
                return CompletableFuture.completedFuture(
                        new ExecutionReconciliation(errored,
                                ExecutionReconciliation.Outcome.RESOLVED,
                                null));
            }}
        }}), "runtime_execution_reconcile_failed",""")]),
    'M12': dict(
        desc='reconcile also looks up settled rows',
        gates=f'{CS}#aStaleBroker*',
        edits=[(SVC,
                """        if (unknown.getState() != ToolExecutionRecord.State.UNKNOWN) {
            return CompletableFuture.completedFuture(notUnknown(unknown,
                    null));
        }""",
                """        if (unknown.getState() != ToolExecutionRecord.State.UNKNOWN
                && !unknown.isSettled()) {
            return CompletableFuture.completedFuture(notUnknown(unknown,
                    null));
        }""")]),
    # --- worker (TypeScript bundle) mutants: not in the PR's table ---
    'W1': dict(
        desc='worker re-runs a duplicate execute instead of joining it',
        gates=f'{LR}#aLostExecute*',
        dist=[(CHUNK,
               'if(existing){return join(existing,reference,toolName,inputJson)}',
               'if(false){return join(existing,reference,toolName,inputJson)}'),
              (CHUNK,
               'if(joined){return join(joined,reference,toolName,inputJson)}',
               'if(false){return join(joined,reference,toolName,inputJson)}')]),
    'W2': dict(
        desc='worker cancel marks cancel_requested but never aborts the tool',
        gates=f'{LR}#aLostCancel*',
        dist=[(CHUNK,
               'entry.state="cancel_requested";entry.lastSequence+=1;entry.controller.abort()}return view(entry)}',
               'entry.state="cancel_requested";entry.lastSequence+=1}return view(entry)}')]),
    'W3': dict(
        desc='worker answers settled/not_started for a call it never saw',
        gates=f'{PC}#aRestartedBroker*',
        dist=[(CHUNK,
               'const view2=executor.status(reference);if(!view2){res.status(200).json({protocolVersion:2,state:"unknown"});return}',
               'const view2=executor.status(reference);if(!view2){res.status(200).json({protocolVersion:2,state:"settled",result:{executionStatus:"not_started",responseParts:[]},lastSequence:1});return}')]),
}

MUTANTS['M01b']['edits'] = MUTANTS['M01']['edits']

# Timing experiment on the takeover gate: stall before thawing the stale
# Broker so the held execute answer arrives after its 10 s request timeout.
STALL = (TPKG + 'ConcurrencyStorageFaultGateTest.java',
         """        long thawed = System.nanoTime();
        stale.resume();""",
         """        Thread.sleep(Long.getLong("stall.ms", 0L));
        long thawed = System.nanoTime();
        stale.resume();""")
PROBE = (TPKG + 'ConcurrencyStorageFaultGateTest.java',
         """        answer.awaitHeld(FaultGateRig.WAIT);
        assertEquals(List.of("ran"), rig.marker("marker"));

        freezeBetweenDatabaseCalls(stale, staleDatabase);""",
         """        answer.awaitHeld(FaultGateRig.WAIT);
        long heldAt = System.nanoTime();
        assertEquals(List.of("ran"), rig.marker("marker"));

        freezeBetweenDatabaseCalls(stale, staleDatabase);""")
PROBE2 = (TPKG + 'ConcurrencyStorageFaultGateTest.java',
          """        answer.release(FaultProxy.Action.PASS);
        answer.awaitDelivered(FaultGateRig.WAIT);""",
          """        System.out.println("PROBE held->release ms="
                + (System.nanoTime() - heldAt) / 1_000_000);
        answer.release(FaultProxy.Action.PASS);
        answer.awaitDelivered(FaultGateRig.WAIT);""")
# Candidate: give the stale Broker a request timeout the scenario cannot
# outlast, so a slow host cannot turn "late answer delivered" into "request
# timed out" and let the gate pass without exercising the fenced commit.
CAND = [
    (TPKG + 'FaultGateRig.java',
     """    BrokerProcess broker(String name, FaultProxy proxy,
            Provisioner provisioner, TcpRelay relay) throws Exception {""",
     """    BrokerProcess broker(String name, FaultProxy proxy,
            Provisioner provisioner, TcpRelay relay) throws Exception {
        return broker(name, proxy, provisioner, relay, REQUEST_TIMEOUT);
    }

    BrokerProcess broker(String name, FaultProxy proxy,
            Provisioner provisioner, TcpRelay relay, Duration requestTimeout)
            throws Exception {"""),
    (TPKG + 'FaultGateRig.java',
     """        config.put("requestTimeoutMillis", REQUEST_TIMEOUT.toMillis());""",
     """        config.put("requestTimeoutMillis", requestTimeout.toMillis());"""),
    (TPKG + 'ConcurrencyStorageFaultGateTest.java',
     """        BrokerProcess stale = rig.broker("stale", staleProxy,
                FaultGateRig.Provisioner.RECOVERABLE, staleDatabase);""",
     """        // The held answer must reach the stale Broker as an answer, not
        // as a request timeout, however long the takeover takes.
        BrokerProcess stale = rig.broker("stale", staleProxy,
                FaultGateRig.Provisioner.RECOVERABLE, staleDatabase,
                FaultGateRig.WAIT.multipliedBy(2));"""),
]

SCENARIOS = {
    'P0': dict(desc='probe only (timing of held->release)', gates=f'{CS}#aStaleBroker*',
               edits=[PROBE, PROBE2]),
    'T0': dict(desc='unmutated gate, 9 s stall before thaw', gates=f'{CS}#aStaleBroker*',
               edits=[PROBE, PROBE2, STALL], props={'stall.ms': '9000'}),
    'T9': dict(desc='M09 + 9 s stall before thaw', gates=f'{CS}#aStaleBroker*',
               edits=[PROBE, PROBE2, STALL] + MUTANTS['M09']['edits'],
               props={'stall.ms': '9000'}),
    'C0': dict(desc='candidate, unmutated, 9 s stall', gates=f'{CS}#aStaleBroker*',
               edits=[PROBE, PROBE2, STALL] + CAND, props={'stall.ms': '9000'}),
    'C9': dict(desc='candidate + M09 + 9 s stall', gates=f'{CS}#aStaleBroker*',
               edits=[PROBE, PROBE2, STALL] + CAND + MUTANTS['M09']['edits'],
               props={'stall.ms': '9000'}),
    'CTRL': dict(desc='pristine copy (harness control)',
                 gates=f'{LR},{PC},{CS},FaultGateControlTest', edits=[]),
}

REC = TPKG + 'RecoverableProcessProvisioner.java'
A1 = (REC,
      """        try {
            attest(request, seed, lastLease);
        } catch (RuntimeBrokerException failure) {""",
      """        try {
            if (Boolean.getBoolean("never.attest")) {
                attest(request, seed, lastLease);
            }
        } catch (RuntimeBrokerException failure) {""")
A2a = (SVC,
       """        return mapFailure(safeStage(() -> transport.attest(lease, request,
                seed)), "runtime_broker_recovery_failed",""",
       """        return mapFailure(safeStage(() -> CompletableFuture
                .<RuntimeAttestation>completedFuture(null)),
                "runtime_broker_recovery_failed",""")
A2b = (SVC,
       """                .thenCompose(attestation -> {
                    if (!validAttestation(attestation, lease, seed,
                            request)) {
                        blockRecovery(bindingId, operationGeneration);""",
       """                .thenCompose(attestation -> {
                    if (attestation != null
                            && !validAttestation(attestation, lease, seed,
                            request)) {
                        blockRecovery(bindingId, operationGeneration);""")
A3 = (REC,
      """            attest(request, seed, lease);
        }, executor);""",
      """        }, executor);""")
PIN = (TPKG + 'ProcessCrashFaultGateTest.java',
       """        second.acquire(HARNESS, SESSION).requireOk();

        // Adopted, not replaced""",
       """        second.acquire(HARNESS, SESSION).requireOk();
        assertTrue(secondProxy.count("attest") >= 1,
                "the restarted Broker reused the worker without"
                        + " re-proving its identity");

        // Adopted, not replaced""")
G3 = f'{PC}#aRestartedBroker*'
SCENARIOS.update({
    'A1': dict(desc='adapter observeRecord skips re-attestation', gates=G3, edits=[A1]),
    'A2': dict(desc='service adoptObservation skips re-attestation (production)', gates=G3, edits=[A2a, A2b]),
    'A12': dict(desc='A1 + A2', gates=G3, edits=[A1, A2a, A2b]),
    'A123': dict(desc='A1 + A2 + adapter confirm skips attest: no attestation after restart', gates=G3, edits=[A1, A2a, A2b, A3]),
    'PA123': dict(desc='pin (secondProxy attest >= 1) + A123', gates=G3, edits=[PIN, A1, A2a, A2b, A3]),
    'P': dict(desc='pin alone (unmutated)', gates=G3, edits=[PIN]),
})

PIN3 = (TPKG + 'ProcessCrashFaultGateTest.java',
        """        second.acquire(HARNESS, SESSION).requireOk();

        // Adopted, not replaced""",
        """        second.acquire(HARNESS, SESSION).requireOk();
        // The restarted Broker re-proves the worker's identity before reuse:
        // the adapter's observation, the service's adoption, and confirm.
        assertEquals(3, secondProxy.count("attest"));

        // Adopted, not replaced""")
SCENARIOS.update({
    'P3': dict(desc='exact pin (== 3) unmutated', gates=G3, edits=[PIN3]),
    'P3A2': dict(desc='exact pin + A2 (service skips adoption attest)', gates=G3, edits=[PIN3, A2a, A2b]),
    'P3A1': dict(desc='exact pin + A1 (adapter observe skips attest)', gates=G3, edits=[PIN3, A1]),
})

PIN2 = (TPKG + 'ProcessCrashFaultGateTest.java',
        """        second.acquire(HARNESS, SESSION).requireOk();

        // Adopted, not replaced""",
        """        second.acquire(HARNESS, SESSION).requireOk();
        // Before reuse, the restarted Broker re-proves the worker's identity
        // twice: the provisioner's observation, then the service's adoption.
        assertEquals(2, secondProxy.count("attest"));

        // Adopted, not replaced""")
SCENARIOS.update({
    'Q0': dict(desc='pin ==2 unmutated', gates=G3, edits=[PIN2]),
    'QA1': dict(desc='pin ==2 + A1 (adapter observe skips attest)', gates=G3, edits=[PIN2, A1]),
    'QA2': dict(desc='pin ==2 + A2 (service adoption skips attest, production)', gates=G3, edits=[PIN2, A2a, A2b]),
    'QA123': dict(desc='pin ==2 + A123 (no attestation after restart)', gates=G3, edits=[PIN2, A1, A2a, A2b, A3]),
})


def apply(root, rel, old, new):
    path = os.path.join(root, rel)
    text = open(path, encoding='utf-8').read()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{rel}: anchor matched {count} times')
    open(path, 'w', encoding='utf-8').write(text.replace(old, new))


def run(name, spec):
    if os.path.exists(WORK):
        shutil.rmtree(WORK)
    shutil.copytree(BASE, WORK)
    entry = f'{WT}/dist/cli.js'
    for rel, old, new in spec.get('edits', []):
        apply(WORK, rel, old, new)
    if spec.get('dist'):
        dist = f'{WT}/dist-{name}'
        if os.path.exists(dist):
            shutil.rmtree(dist)
        subprocess.run(['cp', '-Rc', f'{WT}/dist', dist], check=True)
        for rel, old, new in spec['dist']:
            apply(dist, rel, old, new)
        entry = f'{dist}/cli.js'
    env = dict(os.environ)
    env['JAVA_HOME'] = '/Users/wenshao/Install/jdk21'
    env['PATH'] = '/Users/wenshao/Install/jdk21/bin:' + env['PATH']
    cmd = ['mvn', '-B', '-ntp', '-o', '-s', f'{SP}/settings.xml',
           f'-Dmaven.repo.local={SP}/m2repo', '-Pfault-gates',
           f'-Dqwen.cli.entry={entry}', f'-Dtest={spec["gates"]}',
           '-Dsurefire.failIfNoSpecifiedTests=false', 'test']
    for key, value in spec.get('props', {}).items():
        cmd.insert(-1, f'-D{key}={value}')
    # surefire forwards -D user properties to the forked JVM via argLine? No:
    # pass them through systemPropertyVariables-free route below.
    started = time.time()
    log = f'{SP}/mut/{name}.log'
    with open(log, 'w') as out:
        rc = subprocess.run(cmd, cwd=WORK, env=env, stdout=out,
                            stderr=subprocess.STDOUT).returncode
    secs = round(time.time() - started)
    failed, total = [], 0
    reports = os.path.join(WORK, 'target', 'surefire-reports')
    if os.path.isdir(reports):
        for f in sorted(os.listdir(reports)):
            if f.startswith('TEST-') and f.endswith('.xml'):
                tree = ET.parse(os.path.join(reports, f))
                for case in tree.getroot().iter('testcase'):
                    total += 1
                    bad = case.find('failure')
                    if bad is None:
                        bad = case.find('error')
                    if bad is not None:
                        msg = (bad.get('message') or '').split('\n')[0][:160]
                        failed.append(f"{case.get('name')}: {msg}")
    compile_error = 'COMPILATION ERROR' in open(log).read()
    probe = re.findall(r'PROBE held->release ms=(\d+)', open(log).read())
    result = dict(name=name, desc=spec['desc'], rc=rc, secs=secs,
                  total=total, failed=failed, compile_error=compile_error,
                  probe=probe)
    print(json.dumps(result, ensure_ascii=False), flush=True)
    with open(f'{SP}/mut/results.jsonl', 'a') as out:
        out.write(json.dumps(result, ensure_ascii=False) + '\n')
    return result


if __name__ == '__main__':
    table = {**MUTANTS, **SCENARIOS}
    for name in sys.argv[1:]:
        run(name, table[name])
