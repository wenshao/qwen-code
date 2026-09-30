## Maintainer verification — PR #13115 @ `567737c2c0` (local, real environment)

**Verdict: mergeable.** The fix is real.
- On the pre-fix service, the PR's new tests reproduce the exact #13017 signature.
- In the real multi-process fault-gate rig with slow JDBC, the pre-fix code fenced on the first answer of **50/50** recovery-fencing awaits and once failed a strict assertion with the CI signature. The PR head fenced on **8/50** and failed nothing.
- Every CI-parity lane passes locally, and the new real-time tests stay green on a starved CPU.

I found one residual un-renewed window on the exact path of the flaky gates (A). I reproduced it deterministically and in the real rig, and a one-line fix closes it. I'd fold that fix in here, but it isn't a blocker: head already strictly improves on main. B–D are non-blocking.

This round builds on the earlier ones: my first verification comment (5913393343), the triage gate (5367981013), the `/review` R1 round (R1-1…R1-10) and the replies in `567737c2c0` (5919302020). I don't repeat what they covered. Everything below was executed at head `567737c2c0`.

### What I ran

| Check | Result |
|---|---|
| runtime-broker module, `clean verify checkstyle:check`, JDK 21 | ✅ 548/548 (2 opt-in skips) + checkstyle |
| **Negative control**: PR tests + pre-fix `RuntimeBrokerService.java` | ✅ 8 of the 10 new tests fail with the #13017 signature (`expected: <runtime_broker_runtime_lost> but was: <runtime_provision_fenced>` / `Runtime recovery claim expired`). The other 2 are designed to pass on both (`reclaimStillFences…`, `…InsideTheStepBand`) |
| **Mutation**: 20 single-guard mutants of the service | 15/20 killed by the PR's tests, each by its intended test. 4 of the 5 survivors are killed by verification probes (§2). m16 is a narrow monitor race |
| New timing-based tests under CPU starvation (2 cores + 4 busy-loop hogs, ×6) | ✅ 171/171 every run (the PR's 167 + my 4 probes) |
| `-Pmysql-integration` vs real **MySQL 8.4.11** and **MariaDB 10.11.18** (CI image) | ✅ 548 unit + `JdbcRuntimeBrokerMySqlIT` 3/3 on both |
| managed-agent-server `-Pmysql-integration` (MariaDB, TZ=UTC like CI) | ✅ 242 unit + 18 IT + checkstyle |
| managed-agent-server `-Phosted-harness-mysql` vs MySQL 8.4 + fresh `dist/cli.js` | ✅ 242 unit + 13 Hosted*IT |
| `-Pfault-gates` with a freshly bundled CLI (CI command) | ✅ 44/44 |
| **Real multi-process A/B census** (bundled worker, Broker JVM subprocesses, H2-over-TCP, 2 s rig lease) | CPU contention alone never triggers the bug here; slow JDBC does. First-answer fences: 50/50 pre-fix → 8/50 head → 0/20 with A (§3) |
| Suggested fix A applied on top of head | ✅ module 548 + checkstyle, fault gates 44/44, the two service test classes 168/168 |
| CI on the current merge commit `f0e1985` (head + main `57e720bc97`) | ✅ all SDK Java jobs green, incl. `Hosted process fault gates` (Hosted 16 IT, fault gates 44/44) |

### 1. Negative control

![negative control](./fig1-negative-control.png)

### 2. Which guard does each test pin?

Each mutant deletes or weakens exactly one guard the PR adds. The PR's own tests kill 15/20. The five survivors:

- **m08**: `finishLostRecovery` gets a plain re-read instead of the renewed claim.
- **m14**: `recoverBinding`'s outer backstop goes back to 1 lease. The widening to 4× is described in 5919302020 but no test pins it.
- **m15**: `recoverBinding`'s post-observation renew becomes a re-read.
- **m18**: the `recoverResources` step bound is dropped.
- **m16**: the per-instance `stopped` flag from the R1-3 fix is removed.

I wrote four probe tests. Each is green on head, red on the pre-fix service, and red on exactly its target mutant, so together they close m08/m14/m15/m18. The patch is [`harness/probes-RuntimeBrokerServiceTest.diff`](./harness/probes-RuntimeBrokerServiceTest.diff). m16 needs a renewal tick parked on the `renew()` monitor while `close()` holds it. I didn't find a deterministic way to build that without a production hook.

![mutation matrix](./fig2-mutation-matrix.png)

### 3. Real multi-process fault gates under load (A/B)

The two arms differ **only** in `RuntimeBrokerService.java`. The test code is byte-identical, plus two hooks used only for this verification:
- a census in `FaultGateRig.await` that records every reply the retry predicate swallows;
- an optional delay in the rig's own `TcpRelay`, so each Broker subprocess's JDBC responses arrive N ms later. This models the slow recovery transactions of a loaded runner.

Runs alternate ABBA.

![stress census](./fig4-stress-census.png)

What the census shows:

- **CPU contention alone does not trigger the bug on this host.** I ran 4 cores + 4 hogs and 2 cores + 4 hogs, ×5 each. Neither arm had a fenced first answer. At +10 ms of JDBC latency the result was the same: 0/30 on both arms.
- **Slow JDBC does trigger it.** At +25 ms per response, the pre-fix service fenced on the first answer of **50/50** recovery-fencing awaits; head fenced on 8/50.
  - Almost all of those gates still went green, because the `await` predicate retries through `runtime_provision_fenced` (C).
  - The one exception was on the pre-fix arm. `ProcessCrashFaultGateTest.aLostJournalEndsPollingWithoutReleasingTheWriterDomain:250` is the un-retried `second.warm(HARNESS)` after the retried `acquire`, and it failed with the exact CI signature. That is the flake shape from #13017, reproduced in the real rig.
- **Head's residual fences all come from one place**, which is finding A. I added a stack hook on `unavailable("runtime_provision_fenced")` inside the Broker subprocess. All 11 captured fences run `reconcileLoop:1900 → reclaimLostBindingNow:2022 → cleanupLost:2034 → renewRecoveryClaim` at `:2050` and `:2070`. On the pre-fix arm, every fence is at `cleanupLost:2029`, where `recoverLost` runs on a lapsed, never-renewed claim. That is the #13017 mechanism itself.
- **With A applied, no fences remain.** In the same interleaved run, the first-answer fence count was 0/20 against 6/20 for unpatched head, and the hook captured no fence at all.

### 4. CI-parity lanes

![ci parity](./fig3-ci-parity-lanes.png)

### Findings

**A. Residual un-renewed window at the reconcile → reclaim handoff (recommended; one line).**

The LOST branch renews at `RuntimeBrokerService.java:1888`. That single lease then has to cover three JDBC transactions before the next renewal at `:2050`:
- the evidence CAS at `:1890`;
- `reclaimLostBindingNow`'s `claimOperation` at `:2014`;
- `cleanupLost`'s first `recoverLost` at `:2035`.

For a live claim with the same owner, `claimOperation` returns the row **without extending the lease** (`InMemoryRuntimeBindingRepository.java:263-265`, `JdbcRuntimeBindingRepository.java:443-445`). The fence-site capture in §3 shows this is exactly where head still fences under slow JDBC.

Deterministic witness: [`probeLostHandoffRenewsBeforeTheFirstRecoverLost`](./harness/probe-handoff-DurableRuntimeRecoveryTest.diff) spends 0.8 s in each of those three steps on a 2 s lease. It fails on head with `Runtime recovery claim expired`, and on the pre-fix code too.

The fix is to renew before the first transaction of the cleanup ([`suggested-fix-handoff-renew.diff`](./harness/suggested-fix-handoff-renew.diff)). It covers all three entry paths: the reconcile handoff, the `ensureBinding` shortcut, and `recoverBinding`. With the fix applied:
- the witness passes;
- the module suite is 548 + checkstyle, fault gates 44/44, and the two service test classes 168/168;
- in the real rig at 25 ms, first-answer fences are 0/20 against 6/20.

```java
RuntimeBindingRecord recovered = bindingRepository.recoverLost(
        sessionRepository, executionRepository, renewRecoveryClaim(claimed));
```

**B. R1-2 is narrowed, not closed (non-blocking; wording or a constant).**

At the production lease (`EmbeddedRuntimeBroker.LEASE = 30s`), `cleanupStepTimeoutMillis()` is 30 000 − 10 000 = **20 000 ms**. The shipped `LocalProcessRuntimeProvisioner.observe()` still calls `attest(...)`, which waits up to `READY_TIMEOUT = 30s` (`LocalProcessRuntimeProvisioner.java:36/596/645`; `HttpRuntimeTransport.REQUEST_TIMEOUT` is also 30 s).

So the built-in provisioner doesn't meet the new javadoc contract ("a provisioner's internal waits must fit inside it"). An attestation that answers in 20–30 s is now discarded as a retryable `runtime_broker_reconcile_timeout`; before the fix it was admitted. This fails safe: the timeout is named and retryable, and the binding stays LOST. I'd either state these numbers in the Risk section, or bound `observe()`'s attest below the step budget.

**C. The fault gates can't detect a regression of this fix (for maintainers to decide).**

In §3 the pre-fix service fenced first on 50/50 awaits, and only one gate failed. That failure was the single un-retried `warm`; every retried site absorbed its fences. The `await` predicates retry through `runtime_provision_fenced`: that tolerance was kept from #12946 and is now widened to `runtime_broker_reconcile_timeout`. So after this PR, the deterministic unit tests are effectively the only regression guard for #13017, which was the triage bot's concern in 5367981013.

With A folded in, head's first-answer fence count at 25 ms is 0/20. That supports tightening the predicates, or at least failing when more than one fenced reply is swallowed. I'd leave that choice to whoever owns the gates.

**D. The added diagnostics don't name the call site (non-blocking).**

The PR says the new `message + rig.logs()` suppliers let "the next failure name its call site". In the real failure above, the supplier fired, but the report shows only `Runtime recovery claim expired` followed by **empty** `--- broker <pid> ---` sections ([report](./data/L25-target/reports-base-4/com.alibaba.qwen.code.runtimebroker.ProcessCrashFaultGateTest.txt)). The Broker subprocess doesn't log failed replies, and `RuntimeBrokerService.java` raises `runtime_provision_fenced` with that same message at 16 sites.

A per-site message suffix, or having `FaultGateBroker` print the exception on error replies to stderr (which `rig.logs()` already tails), would make the next CI failure self-locating. The stack hook I used ([`harness/fence-site-instrumentation.diff`](./harness/fence-site-instrumentation.diff)) shows the information is cheap to get.

**Out of scope, seen along the way (pre-existing, not this PR):**
- On a +08:00 host, `ToolPublicationRecoveryMySqlIT` fails 3/3 (`expected: "EXPIRED" but was: "RETRYABLE"/"PENDING"`). The same tree passes with `TZ=UTC` and fails with `TZ=Asia/Shanghai`, which points to a JVM-vs-DB clock-zone dependency in managed-agent-server.
- `ManagedAgentServerIntegrationTest.ignoresLateEnvironmentResultFromAnOlderTurn` failed once in three runs. It's a store event-ordering test with no runtime-broker reference.
- In a one-run smoke of all 18 cases at +25 ms JDBC latency, the adoption-path gates failed identically on both arms: 9 cases across `aRestartedBrokerAdoptsTheWorker…`, `adoptedWorkerCanCancel…`, `brokerCrashAdopts…` and `closingAnObserver…`. That matches the second mechanism my first comment mentions, on a path this PR doesn't touch.

### Not verified
- macOS / Windows. The gates need POSIX signals; CI's macOS/Windows Java 21 unit jobs are green.
- m16 (the `stopped` flag): no deterministic witness.
- Production-scale leases (30 s) under real load. My A/B uses the rig's 2 s lease plus injected latency, which models a loaded runner rather than measuring one.

Evidence (figures, raw census TSVs, probe/fix patches, mutation and stress scripts): [`wenshao/qwen-code@asserts/pr-13115`](./)

中文版见 [REPORT.zh-CN.md](./REPORT.zh-CN.md)。

---
🤖 Generated with [Claude Code](https://claude.com/claude-code) — Claude Opus 5.5
