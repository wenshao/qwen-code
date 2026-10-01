## Maintainer verification, round 3 — PR #13115 @ `c85795812c` (delta over round 2, 5926436515)

**Verdict: mergeable.** The round-2 blocker is fixed exactly as proposed: `RuntimeBrokerService.java` at this head is byte-identical to the fix arm I verified last round. The fix also holds in the real rig. At +25 ms JDBC latency, over 3 ABBA iterations of all 18 fault-gate cases:
- **this head passed 54/54, and the stack hook saw no fence raised at all**;
- the previous head `b9be066b0f` failed 27/54 again, the same 9 adoption cases each run, with every failure at `adoptObservation:1982`.

`Fixes #13017` now covers both paths I could reproduce: the reclaim handoff and the adopt CAS.

![round 3](./r3-fig1-ab-and-mutants.png)

### What I ran at this head

| Check | Result |
|---|---|
| CI-parity lanes (only sdk-java changed since `b9be066b0f`, so that build's bundle is reused) | ✅ module 557 + checkstyle · `JdbcRuntimeBrokerMySqlIT` 3/3 on MySQL 8.4 and on MariaDB 10.11 · MAS 289 + 23 IT · hosted harness 289 + 16 Hosted IT · fault gates 44/44 |
| Real-rig A/B, +25 ms JDBC, 18 cases × 3 ABBA | ✅ head 54/54, 0 fences · `b9be066b0f` 27/54 (adopt CAS ×27, handoff ×3 fences) |
| Revert mutants against the PR's own tests | ✅ adopt fix (x1 drop `close()`, x3 no renewal handed over), handoff fix (x4), n01, n03: each killed by its new test |
| The 4 new real-time tests on 2 cores + 4 busy-loop hogs, ×10 | ✅ 40/40 |
| CI at this head | ✅ every Java job green, incl. `Hosted process fault gates`; only web-shell E2E (unrelated) was still pending |

![ci parity](./r3-fig2-ci-parity.png)

### Remaining notes (none blocking, none needed for merge)
- **x2 survives** (drop the inline renew before the attestation CAS, keep `close()`). It's near-equivalent: once `close()` has stopped the ticks, the plain `findById` snapshot is current, and a lapsed claim still fails the CAS. The renew only adds margin. Fine as is.
- **Round-1 m08/m15 are still killed only by my round-1 probes**: `finishLostRecovery` and `recoverBinding` re-read instead of renewing. Porting the two probes is optional.
- **Two of the new tests run on tight margins**, and I designed both (sorry): about 0.4 s between `lostHandoff…`'s renew and lease expiry, and 0.6 s between `resourceRecoveryPastOneLease…`'s 2.4 s step and its 3 s backstop. They held 10/10 under starvation. If either ever flakes in CI, widen the lease, not the assertion.
- **The PR body is stale.** "What this PR does" still says *"Each provisioner call in the chain is bounded to one renewal tick below a full lease…"*. That was the round-1 design; steps now run under their own renewal with a 2× lease backstop. The body also never mentions the adopt-path fix that `Fixes #13017` now relies on. One sentence each would keep the record straight.
- **Javadoc nit.** The "must not block the calling thread" rule sits on `reconcile` only; `recoverResources` points to "the same backstop" but not to the threading rule. The in-repo `WorkspaceRuntimeProvisioner.recoverResources` is itself a short synchronous JDBC transaction, so "must not block for long" would describe the intent without contradicting the shipped implementation.
- **C/D (retry absorption, fence-site diagnosability)** are deferred as follow-ups, as agreed.

### Not verified
- macOS / Windows.
- The production lease (30 s) under real load. The A/B uses the rig's 2 s lease plus injected JDBC latency.

Evidence (figures, A/B census and fence-site TSVs, mutant logs): [`wenshao/qwen-code@asserts/pr-13115-round3`](./)

中文版见 [REPORT.zh-CN.md](./REPORT.zh-CN.md)。

---
🤖 Generated with [Claude Code](https://claude.com/claude-code) — Claude Opus 5.5
