## Maintainer verification — PR #12438 @ `054159f` (JDK 21, real MySQL 8.4, several Broker JVMs)

This complements the triage review and the `/review` round posted at 04:30 (R1-1…R1-24). I ran their claims plus my own probes, on Linux against a real database. Below I only list what those two reviews don't already cover, and which of their items I reproduced by running them.

**Verdict:** one new defect that neither review has (finding 1). It's a concurrency bug in the binding path, and I'd fix it before merge: 16 production lines plus two deterministic tests. For R1-2 I have a tested patch. Everything else is follow-up work.

On the positive side, the fencing the design relies on held up in a real multi-process MySQL setup:
- a stale provisioning owner is fenced;
- a crashed owner is taken over;
- a restart fails closed.

Environment and gates (the head sits on current `main`; its merge-base is the main tip):

| | |
|---|---|
| Module gates | `mvn verify` **43/43**, `mvn checkstyle:check` **0 violations** in `eclipse-temurin:21-jdk` (21.0.12). Checkstyle isn't bound to `verify`, so I ran it separately. |
| Root gates (from the PR's test plan) | `pnpm install` 32 s, `npm run build` 204 s, `npm run typecheck` 76 s; all exit 0 |
| CI on `054159f` | 18/18 green |
| Real DB | `mysql:8.4` (8.4.11) with `JdbcRuntimeBinding/SessionRepository` from #12390, 2–6 Broker JVMs |
| Probes | External probes compiled into the module package; the PR tree is untouched |

### Finding 1 (new) — concurrent acquire across the `PROVISIONING → READY` edge

![finding 1](fig1-binding-race.png)

R1-9 says the `putIfAbsent` single-flight has no test. What I found is that even *with* the single-flight in place, the edge still leaks. There are two gaps in [`ensureBinding` / `provisionBinding`](https://github.com/QwenLM/qwen-code/blob/054159f8d8f5eee79d37d9d661fef1d1b19e749c/packages/sdk-java/runtime-broker/src/main/java/com/alibaba/qwen/code/runtimebroker/RuntimeBrokerService.java#L459-L534).

**1a — a published binding is provisioned again and its lease is replaced.** The sequence:
1. A caller's `findOrCreate` returns `PROVISIONING`.
2. The first operation finishes and leaves `bindingOperations`.
3. That caller only now reaches `putIfAbsent`, so it runs `provisionBinding` again.
4. `claimOperation` is re-entrant for the same owner, so it hands back the row, which is now `READY`.
5. `provisioner.provision()` runs a second time, and `compareAndSet(READY → READY, lease-2)` succeeds.

The result: one binding generation is provisioned twice, and its durable lease is silently swapped. Sessions acquired before the swap keep routing with `lease-1`, because their `SessionContext` holds it; later ones use `lease-2` (S1-d).

This is harmless only if the provisioner returns an identical `RuntimeLease`, or if the Runtime keeps honouring the replaced one. The `RuntimeProvisioner` contract only promises convergence on one live *resource*.

There is also a cross-process variant. If the same stale read happens in another Broker, and that Broker stalls for longer than the operation lease, it takes a fresh claim on the `READY` row and overwrites the owner's lease.

**1b — the owning process reports its own binding as unattested.** `READY` becomes durable ([L521](https://github.com/QwenLM/qwen-code/blob/054159f8d8f5eee79d37d9d661fef1d1b19e749c/packages/sdk-java/runtime-broker/src/main/java/com/alibaba/qwen/code/runtimebroker/RuntimeBrokerService.java#L521-L531)) before `liveBindings.put` runs. A concurrent caller that reads `READY` in that gap gets `runtime_reconciliation_required`, a retryable 503, from the very process that owns the binding.

Unhooked stress results (real threads only):

| Backend | 1a: double-provisioned rounds | 1b: false `runtime_reconciliation_required` |
|---|---|---|
| In-memory | 0/3000 | 41 of 48,000 acquires |
| H2 JDBC | 74/3000 | 48 (some of these come from the 1a swap) |
| MySQL 8.4 | 0/1400 | 0 |

On MySQL, the `SELECT … FOR UPDATE` in `findOrCreate` serialises the read with the `READY` write. That narrows the window but doesn't close it: when a caller pauses for 5 ms after its read (modelling a GC safepoint or preemption), MySQL shows 76/200 double-provisioned rounds.

**Fix:**
- In `ensureBinding`, a `READY` row whose provisioning is still finishing in this process joins the in-flight future.
- In `provisionBinding`, a claimed record that is no longer `PROVISIONING` returns `requireLiveBinding(claimed)` and is never provisioned again. This also makes the cross-process variant fail closed.

With both changes, every row in the table goes to 0.

### R1-2 reproduced, one more path, and a tested patch

![finding 2](fig2-dispatch-stuck.png)

I reproduced R1-2's first two symptoms, and found two more ways to reach the same stuck state:
- **No fault needed.** With the shipped in-memory repository, a stall longer than the dispatch lease between `claimDispatch` and the `EXECUTING` write makes every CAS return `null`, including the one in `markUnknown`. `createExecution` returns **ok** while the record stays `DISPATCHING`, and nothing was ever sent.
- **Cancel instead of retry.** A client that cancels instead of retrying also stays stuck, because cancel only sets the sticky flag.

The patch below changes two things:
- `createExecution` drives any record that is neither settled nor `UNKNOWN`. `beginDispatch` already skips a dispatch that is in flight in this process. `claimDispatch` either re-grants an unsent `DISPATCHING` claim or fences an expired `EXECUTING` claim as `UNKNOWN`.
- `cancelExecution` drives a `DISPATCHING` record, so the sticky cancel settles as `cancelled` without calling `execute`.

With the patch, all six S2/S2b rows end settled or `UNKNOWN`. It fences on the next call rather than in `DispatchRenewal`, and it does **not** cover R1-2's third symptom (a settled cancel ack after a lapse → 409).

### What holds on real MySQL (neither review ran a database or more than one process)

![multi-JVM](fig3-mysql-multijvm.png)

- **M1:** six JVMs warm the same workspace at once. There is exactly one physical provision, and its claim is renewed against MySQL time across twice the lease.
- **M2:** zombie provisioner. The owner is `SIGSTOP`ped past its lease, another broker takes over and publishes, and when the owner resumes it gets `runtime_provision_fenced`; its lease is never written.
- **M3:** after `kill -9`, another broker takes over once the lease expires.
- **M4:** a restart with the *same* owner id fails closed on `warm`, `acquire` and `release`, and provisions nothing.
- **S12:** a stale dispatch owner's late `success` cannot settle the record, which stays `UNKNOWN`.

These are executed witnesses for the two acceptance criteria the triage review marked as untested (its item 2). M1–M4 behave identically with the patch applied.

One point on M1 and M4 that neither review makes: the non-owner processes answer `503 runtime_reconciliation_required` with `retryable=true` indefinitely. M1 shows five JVMs × 75 retries, and M4 shows the same after the owner itself restarts. Adoption is a documented non-goal, but until it exists, callers should either route by owner affinity or not see this error flagged as retryable.

### Gates, negative control, guard-deletion sweep

![gates](fig4-gates-mutation.png)

**Patched tree** (a fresh `git apply` onto the head tree):
- 49/49 tests, Checkstyle 0.
- The only probe differences from head are S1, S2 and S2b.
- `RaceStress` 1b errors drop to 0.
- Negative control: 5 of the 6 proposed tests fail on head. The sixth pins a guard that is already correct.

**Guard-deletion sweep:** I deleted 38 guards in `RuntimeBrokerService` one at a time. The 17 service tests kill **10**; the patched suite kills 12. This quantifies R1-9…R1-24.

One survivor that isn't in R1: **M11**, `requireSession`'s Harness check. With it deleted, Harness Session B can call `control`, `createExecution`, `getExecution` and `cancelExecution` on A's Runtime Session, and the cancel reaches the Runtime. R1-15 covers `requireExecution`, which is a different guard.

### Reproduced by execution (no new claim)

![observations](fig5-observations.png)

- **R1-18:** in my probe the cancel waited 2000 ms behind a blocking `execute`, then saw `SETTLED/success` and never sent a physical cancel. The same monitor also blocks `release` and `acquire` for that Session.
- **R1-4…R1-7 and triage item 4:** the error-surface table is in fig. 5.
- **R1-1, extended:** besides persisting the token, `warm()` returns it to the embedding caller via `getLease().getToken()`. The HTTP adapter must not serialise that record.

On triage item 3: the review suggests `volatile`, but it also says the sibling `BindingRenewal` already avoids the race. It doesn't. `BindingRenewal.start()` also assigns `task` outside the monitor. Assigning `task` under the monitor covers both classes.

<details>
<summary>Suggested patch — production part (+32/−1). The 6 tests are in <code>suggested-fix.patch</code>.</summary>

```diff
@@ cancelExecution(...)
                         ToolExecutionRecord requested =
                                 requestCancel(current);
+                        if (requested.getState()
+                                == ToolExecutionRecord.State.DISPATCHING) {
+                            // Nothing was sent yet; settle the sticky
+                            // cancellation now instead of waiting for a
+                            // dispatcher that may no longer exist.
+                            beginDispatch(context, requested);
+                            ToolExecutionRecord latest = executionRepository
+                                    .findByExecutionCallId(executionId);
+                            return CompletableFuture.completedFuture(
+                                    latest == null ? requested : latest);
+                        }
@@ createExecution(SessionContext, ...)
-        if (record.getState() == ToolExecutionRecord.State.PREPARED) {
+        if (!record.isSettled()
+                && record.getState() != ToolExecutionRecord.State.UNKNOWN) {
+            // Drive any claim no dispatcher in this process is serving:
+            // DISPATCHING was never sent, and claimDispatch fences an
+            // expired EXECUTING claim as UNKNOWN instead of re-sending it.
             beginDispatch(context, record);
         }
@@ ensureBinding(...)
         if (record.getState() == RuntimeBindingRecord.State.READY) {
+            // READY becomes durable before this process records the lease;
+            // join a provisioning that is still finishing here.
+            CompletableFuture<BindingContext> finishing =
+                    bindingOperations.get(record.getBindingId());
+            if (finishing != null) {
+                return finishing;
+            }
             return CompletableFuture.completedFuture(
                     requireLiveBinding(record));
         }
@@ provisionBinding(...)
         if (claimed == null) { ... }
+        if (claimed.getState() != RuntimeBindingRecord.State.PROVISIONING) {
+            // The caller read PROVISIONING before an earlier operation
+            // published the binding; never provision a published binding.
+            return claimed.getState() == RuntimeBindingRecord.State.READY
+                    ? CompletableFuture.completedFuture(
+                            requireLiveBinding(claimed))
+                    : failed(unavailable("runtime_binding_unavailable",
+                            "Runtime binding is not available"));
+        }
```

Tests, all in `RuntimeBrokerServiceRaceTest`, deterministic and without sleeps:
- `staleProvisioningReadDoesNotProvisionAPublishedBinding`
- `readyBindingStillFinishingInThisProcessIsJoined`
- `interruptedDispatchIsDrivenAgainOnRetry`
- `cancellationSettlesAnInterruptedDispatch`
- `resultAfterTheDispatchLeaseLapsedIsFencedAsUnknown`
- `anotherHarnessSessionCannotDriveARuntimeSession`

</details>

Evidence (figures, probe sources, MySQL multi-JVM scripts, mutation runner, full logs, `suggested-fix.patch`): this directory.


Harness: `harness/` (probe sources in package `com.alibaba.qwen.code.runtimebroker`, `run-probe.sh`, `mjvm.sh`, `mutants/`, `figs/`); logs: `data/`.
