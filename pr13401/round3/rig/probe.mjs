// Round-3 test-side probes and extra production mutants for PR #13401.
// Usage: node probe.mjs <worktree> <PROBE[,PROBE...]|NONE>
//   RW3  renewal witness: first 3 findOrCreate calls wedge before the guarded write (R1-1)
//   SW3  session witness: first 3 armed findById calls wedge (never counted as arrived) (R1-1)
//   OBS  renewal witness: count warm() successes/failures and print them (R2-2 observer)
//   AFN  renewal witness: assert firstFailure == null after the try/finally (R2-2 acceptance test)
//   ATT  renewal witness: NoopTransport.attest returns a valid attestation (R2-2 fixture fix)
//   SEH  production: SessionEventHub back to the pre-#13402 monitor + Object.wait shape
//   SEB  SessionEventHubPinningTest: carriers read back to getCommonPoolParallelism() (base line 62)
//   CL   production: QwenHostedHarnessConnector.createOrLoad back to computeIfAbsent (pre-#13403)
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const [wt, list] = process.argv.slice(2);
const RT = 'packages/sdk-java/runtime-broker/src/test/java/com/alibaba/qwen/code/runtimebroker';
const RENEW = `${RT}/BrokerRenewalPinningTest.java`;
const SESS = `${RT}/BrokerVirtualThreadPinningTest.java`;
const MA = 'packages/sdk-java/managed-agent-server/src';
const HUB = `${MA}/main/java/com/alibaba/qwen/code/managedagent/service/SessionEventHub.java`;
const HUBT = `${MA}/test/java/com/alibaba/qwen/code/managedagent/service/SessionEventHubPinningTest.java`;
const CONN = `${MA}/main/java/com/alibaba/qwen/code/managedagent/harness/QwenHostedHarnessConnector.java`;

const rd = (p) => fs.readFileSync(`${wt}/${p}`, 'utf8');
const wr = (p, t) => fs.writeFileSync(`${wt}/${p}`, t);
const once = (t, from, to, what) => {
  const n = t.split(from).length - 1;
  if (n !== 1) throw new Error(`${what}: anchor matched ${n} times`);
  return t.replace(from, to);
};
const notes = [];
for (const p of (list || 'NONE').split(',')) {
  if (p === 'NONE') continue;
  if (p === 'RW3') {
    let t = rd(RENEW);
    t = once(t, `        @Override
        public RuntimeBindingRecord compareAndSet(`, `        // R1-1 probe: the first three callers wedge before the guarded write.
        private final AtomicInteger wedgeBudget = new AtomicInteger(3);
        private final CountDownLatch never = new CountDownLatch(1);

        @Override
        public RuntimeBindingRecord findOrCreate(RuntimeProvisionRequest request) {
            if (wedgeBudget.getAndDecrement() > 0) {
                try {
                    never.await();
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                }
            }
            return delegate.findOrCreate(request);
        }

        @Override
        public RuntimeBindingRecord compareAndSet(`, p);
    wr(RENEW, t);
  } else if (p === 'SW3') {
    let t = rd(SESS);
    t = once(t, `            if (!armed.get()) {
                return delegate.findById(scope, runtimeSessionId);
            }
`, `            if (!armed.get()) {
                return delegate.findById(scope, runtimeSessionId);
            }
            // R1-1 probe: the first three armed callers wedge and never arrive.
            if (wedgeBudget.getAndDecrement() > 0) {
                try {
                    never.await();
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                }
                return delegate.findById(scope, runtimeSessionId);
            }
`, p);
    t = once(t, `        private final AtomicInteger waiting = new AtomicInteger();

        LatchedSessionRepository(`, `        private final AtomicInteger waiting = new AtomicInteger();
        private final AtomicInteger wedgeBudget = new AtomicInteger(3);
        private final CountDownLatch never = new CountDownLatch(1);

        LatchedSessionRepository(`, p);
    wr(SESS, t);
  } else if (p === 'OBS') {
    let t = rd(RENEW);
    t = once(t, `class BrokerRenewalPinningTest {
`, `class BrokerRenewalPinningTest {
    static final AtomicInteger OBS_OK = new AtomicInteger();
    static final AtomicInteger OBS_FAIL = new AtomicInteger();
`, p);
    t = once(t, `                                .get(60, TimeUnit.SECONDS);
                    } catch (Exception failure) {
`, `                                .get(60, TimeUnit.SECONDS);
                        OBS_OK.incrementAndGet();
                    } catch (Exception failure) {
                        OBS_FAIL.incrementAndGet();
`, p);
    t = once(t, `                primary.addSuppressed(wedged);
            }
        }
`, `                primary.addSuppressed(wedged);
            }
        }
        System.err.println("OBSERVE carriers=" + carriers + " callerCount="
                + callerCount + " callerSuccesses=" + OBS_OK.get()
                + " callerFailures=" + OBS_FAIL.get() + " firstFailure="
                + firstFailure.get());
`, p);
    wr(RENEW, t);
  } else if (p === 'AFN') {
    let t = rd(RENEW);
    // after OBS (if present) or right after the try/finally
    const anchor = t.includes('System.err.println("OBSERVE') ? `                + firstFailure.get());
` : `                primary.addSuppressed(wedged);
            }
        }
`;
    t = once(t, anchor, `${anchor}        assertTrue(firstFailure.get() == null,
                "warm() callers failed after the latch opened: "
                        + firstFailure.get());
`, p);
    wr(RENEW, t);
  } else if (p === 'ATT') {
    let t = rd(RENEW);
    t = once(t, `    private static final class NoopTransport implements RuntimeTransport {
`, `    private static final class NoopTransport implements RuntimeTransport {
        @Override
        public CompletionStage<RuntimeAttestation> attest(RuntimeLease lease,
                RuntimeProvisionRequest request, RuntimeProvisionSeed seed) {
            // same shape as Issue13183RegressionTest.AttestingTransport.attest
            return CompletableFuture.completedFuture(new RuntimeAttestation(
                    lease.getRuntimeInstanceId(), seed.getGatewayIncarnation(),
                    lease.getLeaseId(), lease.getEpoch(), request.getScope(),
                    seed.getProvisionRequestId()));
        }

`, p);
    wr(RENEW, t);
  } else if (p === 'SEH') {
    const old = execFileSync('git', ['-C', wt, 'show', `4839611623^:${HUB}`], { encoding: 'utf8' });
    wr(HUB, old);
  } else if (p === 'SEB') {
    let t = rd(HUBT);
    t = once(t, `        int carriers = Integer.getInteger("jdk.virtualThreadScheduler.parallelism",
                Runtime.getRuntime().availableProcessors());`, `        int carriers = ForkJoinPool.getCommonPoolParallelism();`, p);
    wr(HUBT, t);
  } else if (p === 'CL') {
    let t = rd(CONN);
    const s = t.indexOf(`                ? load(session, true) : attachments.get(key);
        if (attached == null) {`);
    const e = t.indexOf(`        if (session.workspace() != null`, s);
    if (s < 0 || e < 0) throw new Error('CL: anchors not found');
    t = t.slice(0, s) + `                ? load(session, true)
                : attachments.computeIfAbsent(key, ignored -> loadExisting
                        ? load(session, false)
                        : create(session));
` + t.slice(e);
    wr(CONN, t);
  } else if (p === 'HHR') {
    // HostedHarnessCreateOrLoadPinningTest.carrierCount() -> the base-10 read CarrierCount models
    const HHT = `${MA}/test/java/com/alibaba/qwen/code/managedagent/harness/HostedHarnessCreateOrLoadPinningTest.java`;
    let t = rd(HHT);
    t = once(t, `        return Integer.getInteger("jdk.virtualThreadScheduler.parallelism",
                Runtime.getRuntime().availableProcessors());`, `        String configured =
                System.getProperty("jdk.virtualThreadScheduler.parallelism");
        return configured == null
                ? Runtime.getRuntime().availableProcessors()
                : Integer.parseInt(configured);`, p);
    wr(HHT, t);
  } else {
    throw new Error(`unknown probe ${p}`);
  }
  notes.push(p);
}
console.log(`probes=${notes.join(',') || 'NONE'}`);
