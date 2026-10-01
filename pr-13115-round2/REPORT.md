## Maintainer verification, round 2 — PR #13115 @ `b9be066b0f` (delta over round 1, 5920689267)

**Verdict: hold the merge while the body says `Fixes #13017`. About 15 lines would make it mergeable.**

The reclaim-path work is solid, and the `renewingStep` redesign closes my round-1 B. But the adopt path, raised as R3-1 by `/review` and by triage stage 3 and still unanswered at this head, is what fails under slow JDBC. In the real multi-process rig at +25 ms:
- This head fails the **same 9 of 18** fault-gate cases on **every** run. All 27 failures across 3 runs are `503 runtime_provision_fenced`, raised at `adoptObservation`'s attestation CAS (`RuntimeBrokerService.java:1982`).
- With an adopt-path fix plus my round-1 finding A, the same rig passes **18/18 on every run, and no fence is raised at all**.

The 9 cases include `closingAnObserverCannotKillTheSharedWorker`, the gate of #13017's most recent recorded CI failure. Merging as-is would therefore close #13017 while the path of its latest occurrence stays open. Either fold in the patch below, which I verified (module 553 + checkstyle, fault gates 44/44), or drop the closing keyword.

### What changed since round 1 (verified at this head)
- **Round-1 B / R1-2 is closed for the provisioner steps.** Each step now runs under its own `BindingRenewal`, with a never-answering backstop of 2× lease (60 s at production), so the 30 s callee waits fit. The maintenance attestation leg keeps the lease-relative 20 s bound; that's recorded in 5924867667.
- **Round-1 m14 and m16 are now pinned by the PR's own tests** (`recoverBindingOutlivesOneLease…`, `stoppedFlagRetractsATickQueuedBehindClose`).
- **CI-parity lanes all pass** with a fresh `dist/cli.js` (figure 3). CI is also green at this head.

![ci parity](./r2-fig3-ci-parity.png)

### 1. R3-1 confirmed: the adopt path is the slow-JDBC flake (blocking for `Fixes #13017`)

`reconcileLoop`'s `default:` branch (`:1903`) calls `adoptObservation` while the loop's background renewal keeps ticking. `adoptObservation` then does `findById` (`:1970`) followed by the attestation CAS (`:1978`) with no inline renewal. A tick that lands in between bumps the row's version or lease, the CAS returns null, and the caller is told `runtime_provision_fenced`. The LOST branch already avoids exactly this with `renewal.close()` + inline renew.

- **Deterministic witness.** [`probeAdoptCasSurvivesARenewalTickInItsWindow`](./harness/probes-adopt-and-handoff-DurableRuntimeRecoveryTest.diff) holds the attestation CAS until a *real* renewal-thread tick lands (bounded 1.5 s on a 3 s lease). A stopped renewal never arrives, so the probe only fails while ticks are live. It fails on head with `Runtime recovery claim expired` and passes with the fix (figure 1).
- **Real rig.** I ran 3 ABBA iterations of all 18 cases at +25 ms per JDBC response (figure 2):
  - head: 27/54 failed, the same 9 cases each time, all at `:1982`;
  - head + fix: 0/54 failed and 0 fences.

  At round 1 I filed these adoption-gate failures under "the second mechanism". The fence-site hook now shows they are this CAS.
- **Fix** ([`suggested-fix-adopt-and-handoff.diff`](./harness/suggested-fix-adopt-and-handoff.diff), +15/−2):
  - pass the loop's `BindingRenewal` into `adoptObservation`;
  - after the attestation returns, `close()` it (it's `synchronized`, so it waits out an in-flight tick);
  - then `renewRecoveryClaim` and CAS on the renewed snapshot.

  The attestation itself still runs under the ticks, so a slow attest can't lapse the claim. The `recoverBinding` caller passes `null`: it has no loop renewal to stop, and the extra inline renew before its CAS is harmless.

![real rig](./r2-fig2-real-rig-ab.png)

### 2. Round-1 finding A is still open (same patch, one line)

The LOST branch renews at `:1882`. That one renewal then has to cover the evidence CAS (`:1884`), `reclaimLostBindingNow`'s `claimOperation` (`:2022`, a same-owner no-op that does not extend the lease) and `cleanupLost`'s first `recoverLost` (`:2043-2044`, still on the un-renewed `claimed`). The real rig caught it again at this head (`cleanupLost:2058/:2066` in figure 2). The ported probe is red on head and green with `renewRecoveryClaim(claimed)` at `:2044`. Each fix turns exactly its own probe green, and both together give 173/173 (figure 1).

### 3. Non-blocking suggestions on the redesign

- **The new SPI promise depends on the calling thread.** `RuntimeProvisioner.java:56` now says the broker "keeps the recovery claim renewed for the duration of the call". `renewingStep`'s ticks run on the single-threaded `qwen-runtime-broker-lease-renewal` scheduler (`:3305`), which is also where `reconcileLoop` schedules its retries (`:1846`). So a *synchronous* provisioner whose slow step is reached from a retry iteration blocks its own renewal.
  - Probe: the same 2.4 s observation on a 1.5 s lease gives `runtime_lost` on the caller thread or with an async provisioner, but **`runtime_provision_fenced`** when it runs on the renewal thread (figure 1; [patch](./harness/probes-sync-step-on-renewal-scheduler.diff)).
  - No shipped provisioner is exposed: LocalProcess is async, and `WorkspaceRuntimeProvisioner.recoverResources` is a short synchronous JDBC transaction.
  - So either qualify the javadoc ("implementations must not block the calling thread"), or dispatch steps off the scheduler. This is related to R3-4.
- **Two redesign guards are unpinned.** Two mutants survive all 171 PR tests:
  - n01: `renewingStep` never starts its renewal (the `recoverResources` and `recoverBinding`-reconcile legs);
  - n03: the renewal keeps ticking after the step.

  `probeSlowResourceRecoveryKeepsTheClaim` and `probeSettledStepStopsItsRenewal` each kill exactly one of them and are green on head. Round-1 m08 and m15 are still killed only by my round-1 probes, now ported ([patch](./harness/probes-guards-RuntimeBrokerServiceTest.diff)).
- **C and D are unchanged.**
  - The retry predicates still absorb `runtime_provision_fenced` on the reclaim gates.
  - The 9 adopt-path failures go through `requireOk()`, so they carry no broker logs. 16 sites raise `runtime_provision_fenced`, 11 of them with the identical message. My fence-site stack hook is what located `:1982`.

![deterministic](./r2-fig1-deterministic.png)

### Not verified
- macOS / Windows.
- The production lease (30 s) under real load. The A/B uses the rig's 2 s lease plus injected JDBC latency.
- Whether the adopt fix also clears the CPU-only flakes reported in #13017. CPU contention alone didn't reproduce them here in round 1.

Evidence (figures, probe/fix patches, census and fence-site TSVs, mutation matrix): [`wenshao/qwen-code@asserts/pr-13115-round2`](./)

中文版见 [REPORT.zh-CN.md](./REPORT.zh-CN.md)。

---
🤖 Generated with [Claude Code](https://claude.com/claude-code) — Claude Opus 5.5
