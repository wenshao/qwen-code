## Maintainer verification: real-stack A/B at `7f0f3ded` (Linux, MySQL 8.4.11, JDK 21)

**Verdict: both changes are correct, and the crash-driver change is worth merging as is. Two coordination points:**

1. The `requested()` hunk edits the same lines as the approved #13399, so only one of the two can land without a conflict.
2. That hunk fixes the main-CI failure #13397, which this PR does not reference.

I found nothing blocking in the code. I also found one more window of the #13370 flake that neither #13385 nor this PR covers; I've listed it below as a follow-up.

> Main already contains #13385 (merged 2026-10-04 13:40Z). Its branch tolerates a fenced `writers:renew` from a killed boot once the restored Harness has become `cli`. So the useful question for this PR is what it adds on top of that. Everything below runs main's driver and this PR's driver on the same build.

### Setup

- **Platform:** Linux x86_64, Node 22, JDK 21, MySQL 8.4.11 (Docker).
- **Gate:** the real `HostedProcessCrashIT` (`-Phosted-process-crashes`), which runs the Spring Session Store, the embedded Runtime Broker, and the bundled `dist/cli.js` Harness from `npm run build && npm run bundle`.
- **Two trees:** the PR head `7f0f3ded`, and the PR merged onto current main `292c49ec`. Main is 7 commits past the PR's base, including Store and Broker changes from #13217, #13347 and #13388.
- **Driver arms on one build:**
  - the driver as it was at the #13370 failure;
  - main's driver (#13385);
  - this PR's driver;
  - a mutant of this PR's driver with the `killedWriters.has(fields.writerId)` check removed.
- **Hooks:** every arm gets the same hooks from one patch script (published below). They hold one real Store request inside the driver's proxy and release it at a chosen moment, so the real Store answers it late. That is the same "stalled in transit" shape as #13370. The proxy's 409 classification, which is the code under test, is untouched.

### What the driver change adds on top of main

![crash gate matrix](./pr13380-crash-gate-matrix.png)

- **The order recorded in #13370 already passes on main.** In that order, the killed boot's renew is answered after the restored Harness's `writers:acquire`. Main tolerates it through #13385's branch, and on this PR the same branch takes it (`fencedWriterRenewals=1`, `staleWriterConflicts=0`). The new branch is not what absorbs the logged incident.
- **A renew answered after its lease expired, but before the restart, still fails main.** The failure text is the #13370 assertion verbatim.
  - The Store fences the renew on lease expiry alone; the writer generation is still 1.
  - At that moment `cli` is still the killed process, so #13385's `fields.writerId !== cli.bootId` check excludes it.
  - This PR's branch accepts it (`staleWriterConflicts=1`), and the gate then checks the cold load as usual.
  - Across both trees, main's driver failed 2/2 and this PR's driver passed 3/3.
- **A late write on another route also fails main.** In `harness-result`, the hook forwards the intercepted `tool_result` commit after the cold-load acquire instead of dropping it. The Store answers `transactions:commit` with `409 managed_session_writer_conflict`. Main fails because its tolerance covers renewals only; this PR passes.
- **Negative control: a fenced live writer still fails.** The hook holds the live Harness's renew until its lease expires, before anything is killed.
  - Main and this PR both fail, as they should.
  - The mutant without the `killedWriters.has(fields.writerId)` check passes, which is a false green.
  - That check is what keeps the new tolerance from hiding a real fence.
- **The unmodified gate (no hooks) passes all six faults:** 6/6 twice at the PR head (109.5 s and 108.6 s), and 6/6 on PR+main (110.0 s).

![lease-expiry window, main vs this PR, and the residual window](./pr13380-s2-timeline.png)

### One window remains (follow-up, not a blocker)

If the killed Harness's renew reaches the Store *before* its lease expires, the Store accepts it with a 200 and moves the dead writer's lease out by about 4 s. The driver still waits a fixed `close()` + 5.1 s. Then:

- the restored Harness's `writers:acquire` gets `409 managed_session_writer_conflict`;
- the cold load answers `503 managed_session_open_failed`;
- the gate fails, on main and on this PR alike (2/2 each; bottom pane above).

For a renew sent just before SIGKILL, here is what this rig showed:

| The Store answers the killed boot's renew… | main | this PR |
| --- | --- | --- |
| 1.5 s after SIGKILL: 200, lease moved 4.0 s | fail | fail |
| 2.8 s after SIGKILL: 409, lease expired, `cli` still the killed boot | fail | pass |
| 5.8 s after SIGKILL: 409, after the restart's acquire (the #13370 order) | pass | pass |

By arithmetic, the first row covers answers from about 0.8 s after SIGKILL until the lease expires (restart acquire at about 5.8 s, minus the 5 s lease).

A fix that closes every row: before restarting, wait for the killed boot's in-flight Store requests to settle (the proxy already sees them), then wait past the latest `leaseUntil` the proxy saw for that writer. Every late answer for a killed boot then lands before the restart. A 200 just pushes the wait out, and a 409 is exactly what this PR's branch accepts.

### `requested()` wait (#13397)

![requested() CPU quota ladder](./pr13380-unit-ladder.png)

- This hunk fixes #13397: `expected 'before_model' to be 'await_action'` at `hosted-workspace-tool-turn.test.ts:1833`. The PR does not reference that issue.
- **Reproduction.** I applied a cgroup CPU quota after collection and ran the test the way main CI does: coverage on, an `ecs-qwen` runner name, no retry.
  - **Base:** fails 2/4 at 3 % with the #13397 line verbatim. Settle time there is 0.9–1.1 s, right at the 1 s default. It fails 4/4 at 2 %.
  - **This PR's 5 s:** passes 8/8 at those two quotas.
  - **At 1 %** (settle 5.7–17.8 s), it fails at `vi.waitFor.timeout` with the same assertion. The wait is bounded, and no check was dropped.
- **Overlap with #13399.** That PR is approved, links #13397, and changes the same lines to `{ timeout: 10_000 }` with a comment.
  - `git merge-tree` of main+#13380 against #13399 reports a content conflict in `hosted-workspace-tool-turn.test.ts`.
  - At 1 %, the 10 s version failed 1/4 and the 5 s version 4/4.
  - I'd land #13399 for this helper and drop the hunk here, which leaves this PR as the crash-fencing change. Either order works as long as only one of them lands.

### Static gates and CI

- **PR head, both changed files:** `prettier --check` and `eslint --max-warnings 0` are clean.
- **PR+main:**
  - `tsc -p integration-tests/tsconfig.json --noEmit`: 0 errors.
  - `packages/cli` `tsc --noEmit`: exit 0.
  - `hosted-workspace-tool-turn.test.ts`: 146/146.
- **CI at `7f0f3ded`:** every completed check is green, including `Hosted process fault gates / MySQL 8.4 / Java 21`.

### Suggestions (non-blocking)

1. Reference #13397, and land only one of this hunk and #13399 (see above).
2. **Reword the new branch's comment.** It says a killed Harness's write "can be answered only after the cold load's acquire bumped the writer generation". After the bump, renewals are already taken by #13385's branch above it. What this branch actually adds:
   - a renewal fenced on lease expiry while `cli` is still the killed boot, before any new acquire;
   - any other Store route, for example a late `transactions:commit`.

   Saying that in the comment would save the next reader the confusion.
3. Already raised by other reviewers and still true at this head: the trailing `killedWriters.add(cli.bootId)` in `killHarness()` is now redundant, and `staleWriterConflicts` is never asserted.
4. A follow-up for the remaining window described above.

### Not verified

- macOS, Windows and MariaDB. The author covered macOS and MariaDB.
- A current-boot conflict after the restart. Once its cold load is refused, the restored Harness stops renewing, so there is no live renewal to fence. The pre-kill live-writer control exercises the same guard.
- The hooks are mine and not part of the PR. Every 409 shown is the real Store's answer.

### How to reproduce

1. Worktree at `7f0f3ded`: `QWEN_SKIP_PREPARE=1 HUSKY=0 corepack pnpm install --frozen-lockfile`, `npm run build`, `npm run bundle`. Install `packages/sdk-java/qwencode` and `runtime-broker` into a private Maven repo.
2. `docker run -d -e TZ=UTC -e MYSQL_ROOT_PASSWORD=hosted-fixture -p 33380:3306 mysql:8.4`.
3. Driver arms: `git show ffc9772423^:integration-tests/helpers/hosted-process-crash-driver.ts` (the #13370 driver), `git show 05ebb1ef3e:…` (main), `git show 7f0f3ded24:…` (this PR). Then run `python3 harness/instrument.py <arm>.ts <arm>.inst.ts` on each. The live-writer mutant comes from `harness/mutate-noidentity.py`.
4. `harness/run-it.sh <arm file> <fault|all> <mode|-> <tag>` copies the arm and `verify13380.ts` into `integration-tests/helpers/`, creates a fresh database and runs `HostedProcessCrashIT`. The modes are documented at the top of `verify13380.ts`. `harness/batch*.sh` lists every run behind the matrix.
5. Unit ladder: `harness/unit-run.sh <quota> <arm> <log> '<test name>'`. The arms are sibling copies of the test file (`armbase` = main, `armpr` = this PR, `armten` = #13399, `armsettle` = this PR plus a settle-time probe).

Evidence: [`pr-13380/`](.) has the figures, the report in both languages, the hook module and patch script, the run scripts, and the per-run event logs and Maven output.
