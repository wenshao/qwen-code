## Maintainer verification: PR #12930 @ `9162fd0064` (round 1)

**Verdict: ready to merge.** The change is test-only and does what it says: the SIGKILL now goes out only after the daemon has accepted the SSE subscription. On the base test I reproduced the exact failure signature from #12925 two ways, naturally (CPU contention, no injection) and deterministically. The head test passed every run under the same conditions. In `main` CI history, the first attempt of this test failed in 24 of 336 macOS jobs and retries hid almost all of them; the timing fits this race. I have one optional wording nit (below).

### How I tested

- Fresh worktree at `9162fd0064` (merge base `6b66321a5a`): `pnpm install --frozen-lockfile`, `npm run build` and `npm run bundle` all exit 0. Linux x64, Node 22.22.2.
- Real `qwen serve` from `dist/cli.js`, a real `qwen --acp` child and a real `kill -KILL`. The model side is the file's own fake OpenAI server.
- **Two arms, one build.** head is the PR's file. base is `git show 6b66321a5a:integration-tests/cli/qwen-serve-streaming.test.ts`, saved beside it as `cli/armbase-serve-streaming.test.ts`. The PR diff is this one file, so the daemon, SDK and CLI under test are byte-identical in both arms. The whole test file at `1b46d63fb7a0`, the commit that failed in CI, is also byte-identical to the merge base.
- **Instrumented without edits.** A `NODE_OPTIONS=--require` preload activates only in vitest's fork workers and is a no-op in the daemon and the ACP child. It timestamps the `fetch(GET /session/:id/events)` call, its response and `execSync('kill -KILL …')`, and can optionally inject faults. No test or product file was modified.
- Every A/B run used `--retry=0`, and all except the 5 full-file runs also used `-t SIGKILL`. The suite config defaults to `retry: 2`, which is where CI's `retry x2` came from.

### 1. The race is real and reproduces the CI failure exactly

![ordering timeline](./fig1-timeline.png)

- **Ordering.** In base, the kill does not race the request; it always comes first. `fetch()` only queues the GET, and the synchronous `execSync('kill -KILL …')` runs before the request can leave the test process. A standalone probe (`harness/sync-write-probe.cjs`) confirms this even on a pooled keep-alive socket. In all 55 natural base runs, the daemon's answer arrived 10–64 ms after the kill returned. base passes only if the daemon registers the subscriber before it processes the child's exit. In all 71 head runs (56 natural, 15 with the GET delayed), the kill started 0–1 ms *after* the `200`, and the daemon never returned 404.
- **Natural reproduction, no injection.** On 3 pinned cores shared with 6 busy loops, base failed 1 of 14 runs and head passed 15/15. The daemon answered the late GET with `404`, the empty `catch {}` swallowed it, and vitest reported `AssertionError: expected undefined to be defined` at `:692:18`. That is the same line, the same message and the same `expect(died)` statement as the macOS log of run 36407829658 (job 108886128942: 3/3 attempts failed, 25246 ms). With no contention, and with a heavier 2-core/10-loop load, base passed 20/20 both times, so the window is narrow.
- **Deterministic reproduction.** I held the SSE GET back in the test process. base passed 5/5 at +5 ms and +10 ms, 2/5 at +20 ms, and 0/5 at +50, +100 and +250 ms. head passed 15/15 at +250, +1000 and +3000 ms. All 19 base failures (18 delayed, 1 natural) went down the same path: the daemon returned `404`, then the test failed at `:692:18`.

A caveat on attribution: base prints this same signature for *any* path where `session_died` never arrives (see §3), and the CI log carries no daemon-side lines. So the CI failure *matches* this race; it does not prove it.

![A/B matrix](./fig2-matrix.png)

![real vitest output under contention](./fig4-vitest-ab.png)

### 2. How often it hit main

I scanned all 998 E2E job logs (macOS shards plus Linux `sandbox:none`) from all 614 push runs on `main` created 2026-09-15 → 2026-10-01. I left out the docker legs because this suite skips itself there.

| leg | SIGKILL test ran | clean pass | passed only on retry | failed all 3 attempts |
| :-- | --: | --: | --: | --: |
| macOS | 336 | 312 | 23 (22× `retry x1`, 1× `retry x2`) | 1 (the #12925 run) |
| Linux `sandbox:none` | 318 | 318 | 0 | 0 |

On macOS the first attempt failed in 24 of 336 jobs (~7.1%), and `retry: 2` almost always absorbed it. The reporter does not print a retried attempt's error. The retried jobs took 11.9–19.2 s in total. That fits one expired 5 s `session_died` poll (two for the `retry x2` job) plus a clean attempt; clean macOS passes run p50 4.4 s, p90 6.9 s. A failure in `pgrep` or in the later assertions would not include that 5 s wait. An expired poll also fits a daemon that takes longer than 5 s to process the exit, which this PR does not address. If those retries were this race, they should disappear after merge, and any that remain will now name their cause (§3).

### 3. Failure diagnostics (the D2-1 / R7-1 follow-ups)

![diagnostics](./fig3-diagnostics.png)

| injected fault | base | head |
| :-- | :-- | :-- |
| stream never opens (unknown session id → real daemon 404) | 5.9 s, `expected undefined to be defined` | **0.9 s**, `DaemonHttpError: … No session with id "…"` |
| transport error after the handshake | 5.8 s, same | `TypeError: terminated (…)`, the real cause |
| clean EOF without `session_died` | 5.8 s, same | `SSE stream ended without session_died (events: none)` |
| stream open but silent for 5 s | 5.8 s, same | `SSE stream ended without session_died (events: none)` (see nit) |
| SSE open never completes (wedged daemon) | 5.8 s, same (killed the child anyway) | 30.8 s, `TimeoutError: Initial connect timed out`, child not killed |

The last row slightly corrects the PR's risk note. A wedged open fails at the SDK's 30 s connect timeout (`DEFAULT_FETCH_TIMEOUT_MS`, which `DaemonClient.subscribeEvents` passes as `connectTimeoutMs`), and the error is named. It does not run into the 60 s test timeout.

### 4. Regression and gates

- Full file (all 11 tests): head passed 3 of 3 runs, base 2 of 2. The PR's own reviewer command (`cd integration-tests && QWEN_SANDBOX=false npx vitest run cli/qwen-serve-streaming.test.ts`, default retry) passed 11/11 with exit 0.
- `eslint --max-warnings 0` and `prettier --check` on the file are clean. `tsc -p integration-tests/tsconfig.json --noEmit` exits 0.
- PR CI exercised this file only in `Integration Tests (no-AK, No Sandbox)` on Linux, where the SIGKILL test passed in 1430 ms. macOS E2E does not run on PRs at all, because `e2e.yml` has no `pull_request` trigger. The only macOS PR check (`Test (macos-latest, …)`) runs unit tests, and it was skipped on this PR. So this change first meets macOS on `main` after merge, and the PR body's "macOS covered by CI" applies only after merge.
- The other half of the guarantee also holds. The route registers the subscriber synchronously before `flushHeaders()`, so `onSseStreamAccepted` implies registration. `EventBus.close()` drains by default (`queue.close()` without `drain: false`). A subscriber registered before the kill therefore receives `session_died` even though `handleChannelExit` closes the bus right after publishing. That matches 71/71 head runs.

### Optional nit (non-blocking)

`integration-tests/cli/qwen-serve-streaming.test.ts`: two cases reach the fallback error. With a clean EOF, "SSE stream ended" is accurate. When the stream stays open but silent, it is not: the daemon is slow to process the exit, and the test itself aborts the stream after 5 s (the "silent for 5 s" row above). The code comment already says "ended (or stayed silent)". This wording would cover both:

```ts
new Error(`no session_died on the SSE stream within 5s of SIGKILL (events: ${events})`)
```

To keep the distinction, record whether `consumer` settled before `ac.abort()` and say "ended" or "stayed open". Separately, once the consumer has already settled (transport error or clean EOF), the poll still waits the full 5 s. Racing the poll against `consumer` would trim that, but it only affects how long a failing run takes.

### Not verified

- macOS locally (I have no Mac here). The fix is platform-neutral.
- On Linux the natural reproduction is rare: base failed 1 of 34 contended runs. The deterministic delay sweep is what pins the mechanism down.

Evidence: `harness/` (scripts, see `harness/README.md`) and `data/` (raw per-run results, timelines, CI scan) in this directory.
