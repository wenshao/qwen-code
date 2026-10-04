## Maintainer verification: #13323 at `118cc3b`

**Verdict: ready to merge.**

- The assertion that failed on main is the one this PR widens.
- I reproduced the main-CI failure signature locally under real CPU starvation, using the **unmodified** merge-base test file. The PR's file passes under the same conditions.
- The check is not weakened. A turn that never settles still fails on head with the same `AssertionError`, about 10.1 s in, and not as a test timeout.
- Merged onto current `main` (`fa3ad5ef4b`), the results are the same.

### 1. Which assertion failed on main

The analysis on #13316 could not read the job log, so I pulled it: job `111234582413`, run 37133512121, runner `ecs-qwen-hk3-17`. All three attempts (`--retry=2`) failed at the final `waitFor`:

```
 × Hosted Harness no-tool session > reports and clears the unknown Hook fence (reload: true) 18884ms (retry x2)
   → expected true to be false // Object.is equality
   → ENOTEMPTY: directory not empty, rmdir '…/resources/22222222-…/managed-turn-result'
   → expected true to be false // Object.is equality
   → expected true to be false // Object.is equality

 ❯ src/serve/hosted-harness-session.test.ts:1662:45
    1662|         expect(status.body.hasActivePrompt).toBe(false);
```

The issue named two other candidates: the `recoveryBlocked` read at L1633 and the `hook-execute` count at L1644-1646. The log rules both out.

The `ENOTEMPTY` on one retry is a side effect. `afterEach` deleted the temp root while the turn was still writing `managed-turn-result`, so the turn was slow, not stuck. The job's `DFSAMPLE` lines show the host's 1-minute load average climbing from 50 to 103 between 15:45:09 and 15:45:49. It was still 62–68 when the file finished at 15:48:10.

### 2. Main-CI census (Figure 1)

I collected every `Test (ubuntu-latest, Node 22.x)` job on main since the test landed: 52 jobs, from #13129 (2026-10-02) to 2026-10-04 09:37Z.

- `reload: true` passed 51 times, each in 415 ms or less, and no retry ever absorbed a failure. It failed once.
- In the failing run, the file took 159 s, against a median of 44.6 s.
- Compared with the same tests in the run on `5ddfacc9d4`, the file-wide median slowdown was 2.4×. Tests in the stretch just before this one were hit much harder: 8.2×, 17.1×, and 20.9× for the test immediately before `reload: false`.
- Per attempt, `reload: true` and `reload: false` both slowed by about 16.5×.

That points to a runner-load burst rather than this code path.

![Main CI census](./01-main-ci-census.png)

### 3. Real CPU starvation with unmodified test files (Figures 2 and 3)

**Rig.**
- **Arms.** Both arms share one build of the PR head. The base arm is the merge-base blob of the test file, saved as the untracked sibling `hosted-harness-session.armbase.test.ts`. The head arm is the PR's own file. No source or test line was edited in either arm.
- **Main-CI settings.** Every run uses `CI=true QWEN_CI_COVERAGE=1`, an `ecs-qwen-*` `RUNNER_NAME` (which selects the ECS config with 60 s test and hook timeouts), `--retry=2`, and `-t 'unknown Hook fence'`.
- **Throttle.** Each run executes inside a transient `systemd-run --scope`. A watcher on a private `TMPDIR` applies the CPU quota with `systemctl set-property` the moment the first selected test's `beforeEach` creates its `mkdtemp` dir. It lifts the quota when vitest prints the file result. Collection therefore runs unthrottled, and only the test bodies are starved.

| CPU quota | settle time, p50 (range) | base: failed attempts | head: failed attempts |
|---|---|---|---|
| none | 70 ms (60–76) | pass | pass |
| 5 % | 1.0 s (0.71–1.51) | **7 / 12** (1 of 6 tests red after retries) | **0 / 6** |
| 3 % | 2.4 s (1.5–3.1) | **18 / 18** (6 of 6 red) | **0 / 6** |
| 2 % | 8.8 s (6.0–16.3) | 18 / 18 (6 of 6 red) | 7 / 12 (1 of 6 red) |

Each quota got 3 rounds × 2 variants.

The settle times come from a separate probe arm: the PR's file with a timer inserted before the unchanged `waitFor`. The timer measures from the prompt POST to the first settled `/status`, polling every 10 ms. When idle, settling takes about 70 ms with coverage on and 28 ms without.

**Calibration.**
- In the failing CI run, `reload: false` passed in 5,285 ms.
- At 5 % CPU, the head arm's per-test times were 5.0–7.6 s, so the CI burst corresponds roughly to the 5 % row.
- At that load, the old 1 s window loses 7 of 12 attempts. The 10 s window leaves 6–14× headroom over the observed settle times.

**Merged with current main.** I re-ran the 3 % case on `fa3ad5ef4b` + this PR. The base arm, using main's own file, fails both variants with `retry x2`. The head arm passes both.

![Real contention A/B](./02-real-contention-ab.png)

![Settle time vs CPU](./03-settle-vs-cpu.png)

### 4. Deterministic delay ladder and negative control (Figure 4)

This uses the same arms without throttling. Instead, the turn's single model call is delayed by D ms, with the same injection in both arms. The runs use the local config, no retries, and no coverage.

- **Base** fails from D = 1,200 ms.
- **Head** passes up to D = 9,000 ms.
- **Head** fails at D = 11,000 ms, and also when the model never resolves. Each failure comes about 10.1 s in, with `AssertionError: expected true to be false` on the `hasActivePrompt` line (`vi.waitFor.timeout`), not `Test timed out`. The local `testTimeout` is 15 s.

The wider window still reports the real assertion.

![Delay ladder](./04-delay-ladder.png)

### 5. Other checks

- **Diff.** `git diff -w 5ddfacc9d4 118cc3b` shows only the re-wrapped call and the added `{ timeout: 10_000 }`. Both `expect` lines are byte-identical.
- **Full file.**
  - PR head: 180/180 passed.
  - Merge with main (`fa3ad5ef4b`): 188/188 passed in 3 consecutive full-file runs.
  - Target test on the merge: 40/40 over 20 reps, settle p50 28 ms for both variants.
- **PR CI.** CI is green: 30 success, 48 skipped. However, PR runs leave `QWEN_CI_COVERAGE` empty, so coverage is off there. It is on in the post-merge main runs where this flaked, so a green PR run says nothing about this flake. That is why I built the local rig.

### Non-blocking notes

1. **The variant explanation in the description doesn't hold up.** The description says `reload: true` flaked because it is the first turn on a freshly reloaded server and does more fsynced work, while `reload: false` "stays inside the window". The data shows no such difference:
   - Both variants settle in the same time when idle (28 ms each) and at every quota.
   - On CI, both slowed by 16.5×.
   - At 5 % CPU, the base arm's `reload: false` failed more often than `reload: true`.

   It looks like the burst simply landed on `reload: true`. No code change is needed, because both variants share one `it.each` body and the fix covers both.
2. **10 s is a finite margin.** At 2 % CPU, about 18–22 s per attempt and 3–4× heavier than the observed burst, head fails too, with the identical signature. Ten seconds is the file's convention and is fine here.
3. **Other waits still use the default.** As triage noted, 44 of the file's 71 `vi.waitFor` calls still use the 1 s default (46 once merged with current main; counted with the TypeScript AST). After this PR, 27 calls pass an explicit timeout: 26 × `10_000` and 1 × `3000`. Sweeping the rest is a separate decision.
4. **The CI timeout budget is larger than triage stated.** Triage stage 3 described the budget as `testTimeout: 15_000`. On `ecs-qwen-*` runners, where main CI runs, `vitest.config.ts` sets both the test and hook timeouts to `60_000`, so the 10 s window has more room on CI than stated.
5. **An unrelated failure in one local run.** One of my four full-file runs on the merge result failed `Hosted Harness tool approvals > keeps a replay retryable when it fails before writing on a stopped Session`: `:6159`, expected 503 but got 200. That test comes from #13071. It then passed 3/3 in isolation and 3/3 in further full-file runs on both main's file and the merged file. This PR doesn't touch it.

**Evidence.** The harness, raw data, and figures are at this directory (`harness/`, `data/`). That covers the arm generator, the throttle runner, the ladder, the CI census TSV and per-test slowdown, every A/B and ladder log, and the probe JSONL.
