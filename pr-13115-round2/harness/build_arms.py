import os, shutil
SRC='/root/verify/pr13115/head/packages/sdk-java/runtime-broker'
OUT='/root/verify/pr13115/r2'
T='src/test/java/com/alibaba/qwen/code/runtimebroker/DurableRuntimeRecoveryTest.java'
M='src/main/java/com/alibaba/qwen/code/runtimebroker/RuntimeBrokerService.java'

def patch_test(s):
    i=s.index('    private static final class ReclaimWatchRepository')
    j=s.index('\n    private static final class', i+10)
    cls=s[i:j]
    def one(a,b):
        nonlocal cls
        assert cls.count(a)==1, a[:70]
        cls=cls.replace(a,b)
    one('        volatile long holdResourceHandleCasMillis;\n','''        volatile long holdResourceHandleCasMillis;
        volatile long handoffSleepMillis;
        final AtomicBoolean casSlept = new AtomicBoolean();
        final AtomicBoolean claimSlept = new AtomicBoolean();
        final AtomicBoolean recoverSlept = new AtomicBoolean();
        volatile boolean tickInAdoptWindow;
        final AtomicBoolean adoptTickFired = new AtomicBoolean();
        final AtomicBoolean adoptTickLanded = new AtomicBoolean();

        private void handoffSleep(AtomicBoolean once) {
            if (handoffSleepMillis > 0 && once.compareAndSet(false, true)) {
                try {
                    Thread.sleep(handoffSleepMillis);
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                }
            }
        }

        @Override
        public RuntimeBindingRecord claimOperation(String bindingId,
                String owner, Duration leaseDuration) {
            handoffSleep(claimSlept);
            return delegate.claimOperation(bindingId, owner, leaseDuration);
        }

        @Override
        public RuntimeBindingRecord recoverLost(
                RuntimeSessionRepository sessions,
                ToolExecutionRepository executions,
                RuntimeBindingRecord expected) {
            handoffSleep(recoverSlept);
            return delegate.recoverLost(sessions, executions, expected);
        }
''')
    one('''            if (holdResourceHandleCasMillis > 0''','''            if (tickInAdoptWindow
                    && replacement.getAttestationGeneration()
                            > expected.getAttestationGeneration()
                    && adoptTickFired.compareAndSet(false, true)) {
                // A slow attestation CAS: give a live background renewal
                // one tick to land between findById and this write; a
                // stopped renewal never arrives (bounded wait, 3s lease).
                int baseline = ticks.get();
                long deadline = System.nanoTime()
                        + Duration.ofMillis(1500).toNanos();
                try {
                    while (ticks.get() == baseline
                            && System.nanoTime() < deadline) {
                        Thread.sleep(10);
                    }
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                }
                adoptTickLanded.set(ticks.get() != baseline);
            }
            if (expected.getLossEvidence() == null
                    && replacement.getLossEvidence() != null) {
                handoffSleep(casSlept);
            }
            if (holdResourceHandleCasMillis > 0''')
    probes=open('/root/verify/pr13115/r2/probes_r2.java.txt').read()
    return s[:i]+probes+'\n'+cls+s[j:]

FIX_A=('''            RuntimeBindingRecord recovered = bindingRepository.recoverLost(
                    sessionRepository, executionRepository, claimed);''','''            RuntimeBindingRecord recovered = bindingRepository.recoverLost(
                    sessionRepository, executionRepository, renewRecoveryClaim(claimed));''')
def fix_r31(s):
    reps=[
     ('''                            return adoptObservation(bindingId,
                                    operationGeneration, step.observation(), 0);''',
      '''                            return adoptObservation(bindingId,
                                    operationGeneration, step.observation(), 0,
                                    renewal);'''),
     ('''    private CompletionStage<BindingContext> adoptObservation(String bindingId,
            long operationGeneration, RuntimeObservation observation,
            long attestBoundMillis) {''','''    private CompletionStage<BindingContext> adoptObservation(String bindingId,
            long operationGeneration, RuntimeObservation observation,
            long attestBoundMillis) {
        return adoptObservation(bindingId, operationGeneration, observation,
                attestBoundMillis, null);
    }

    private CompletionStage<BindingContext> adoptObservation(String bindingId,
            long operationGeneration, RuntimeObservation observation,
            long attestBoundMillis, BindingRenewal loopRenewal) {'''),
     ('''                    Instant now = clock.instant();
                    RuntimeBindingRecord latest =
                            bindingRepository.findById(bindingId);
                    if (latest == null
                            || !ownsOperation(latest, operationGeneration)
                            || !canReconcile(latest)) {
                        return failed(unavailable("runtime_provision_fenced",
                                "Runtime recovery claim expired"));
                    }
                    RuntimeBindingRecord ready =''','''                    if (loopRenewal != null) {
                        // stop the loop's ticks (close() waits out one in
                        // flight) so the snapshot below CASes deterministically
                        loopRenewal.close();
                    }
                    Instant now = clock.instant();
                    RuntimeBindingRecord latest =
                            bindingRepository.findById(bindingId);
                    if (latest == null
                            || !ownsOperation(latest, operationGeneration)
                            || !canReconcile(latest)) {
                        return failed(unavailable("runtime_provision_fenced",
                                "Runtime recovery claim expired"));
                    }
                    latest = renewRecoveryClaim(latest);
                    RuntimeBindingRecord ready ='''),
    ]
    for a,b in reps:
        assert s.count(a)==1, a[:80]
        s=s.replace(a,b)
    return s

arms={'r2-head':[], 'r2-fixA':['A'], 'r2-fixR31':['R31'], 'r2-fixBoth':['A','R31'], 'r2-base':['BASE']}
for arm,fixes in arms.items():
    d=f'{OUT}/{arm}/runtime-broker'
    if os.path.exists(os.path.dirname(d)): shutil.rmtree(os.path.dirname(d))
    shutil.copytree(SRC, d, ignore=shutil.ignore_patterns('target'))
    t=os.path.join(d,T); src=open(t).read(); patched=patch_test(src)
    with open(t,'w') as f: f.write(patched)
    m=os.path.join(d,M); s=open(m).read()
    if 'BASE' in fixes:
        s=open('/root/verify/pr13115/base/packages/sdk-java/runtime-broker/'+M).read()
    if 'A' in fixes:
        assert s.count(FIX_A[0])==1; s=s.replace(*FIX_A)
    if 'R31' in fixes:
        s=fix_r31(s)
    with open(m,'w') as f: f.write(s)
    print(arm,'ok')
