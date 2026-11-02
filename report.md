# Verify PR #16138 — re-run a timed-out job and lose its answer in the chain test

- **PR**: [#16138](https://github.com/QwenLM/qwen-code/pull/16138) — `test(autofix-pr): re-run a timed-out job and lose its answer in the chain test`
- **Head**: `2e520a02288fbf9c860389e453baef39da39b5db` (single commit)
- **Base**: `8aea64d5f7b460298510fa90f883161569d1d9c9`
- **Trial merge**: `59f62c0b34` = head + `origin/main` `212fedbdc7`
- **Round**: 2026-11-03, local, host round (`verify-pr-prepare` reported `isolation: none`; the diff is test-only and maintainer-authored)
- **Verdict**: **merge-ready** — 51/51 scripted assertions pass, 23/23 mutation rows match their predicted outcome, 3 non-blocking notes

## What the PR changes

Four files, 150 insertions, 38 deletions, no production code. The `/autofix-pr` chain test's fake `gh` learns two things GitHub does and the fake did not: a re-run's answer can be lost on the way back (`run rerun` now honours `loseNextAnswer`, the way comment POSTs already did), and a job can end `TIMED_OUT`, which the helpers already treat as a failure. The world file is read inside the fake's guard so a bad world is logged instead of crashing silently. One chain case walks the whole path: a timed-out `e2e` job whose re-run answer is lost, the re-run counted anyway, a second re-run refused on that head, both facts left for a person in `status`. The design document's §12 test list catches up in both languages.

Because the diff is tests and a test fixture, the question this round answers is not "does the code work" but **"does the suite now hold down what the commit says it does, and did anything it used to hold down come loose"**.

## How that was measured

Three trees, all at their own commits, each with the same dependency strategy:

| arm | tree | chain cases | directory tests |
| --- | --- | --- | --- |
| base | `/tmp/pr16138-base` @ `8aea64d5` | 6 | 548 |
| head | `/tmp/pr16138-head` @ `2e520a02` | 7 | 549 |
| trial merge | `/tmp/pr16138-merge` @ `59f62c0b` (head + current `main`) | 7 | 549 |

`main` moved 166 files since the base commit but touched none of this PR's four files; the merge is conflict-free and the directory is green on it.

Dependencies are the main checkout's `node_modules` (symlinked) with workspace `dist/` copied in, so the trees run the package's own suites. That is sound for this PR specifically because it changes no production file: `rerun.ts`, `ci-log.ts` and `snapshot.ts` hash identically in both arms (`289a5920dd4e`, `258dad0f3381`, `3719be479741`), so the helpers under test are the same bytes on each side and the only variables are the fake and the test file. The helpers themselves are loaded from each tree's own sources — the chain test drives them in-process through yargs, not through a built bundle.

The mutation matrix is per-mutant, not per-commit: a test-only diff has no production change whose commits could be mutated one by one, so no per-commit coverage is claimed (`mutations.json` says so in its own `note`).

**One measurement was discarded.** The first pass ran two background scripts that overlapped on the last four rows. The chain test uses real git refs and fixed branch names (`qwen-autofix/pr-7`), so two runs at once collide — the collision surfaced as `error: cannot delete branch 'qwen-autofix/pr-7' used by worktree`. The four affected rows (base `C3`, head `M9`, `M10`, `M11`) were re-run strictly one at a time, and only the sequential results are reported. The other 19 rows never overlapped.

## Result 1 — the gates are green, and the count moves by exactly one

```
chain, head                    7 passed (7)
directory, head              549 passed (549)
directory, base              548 passed (548)
directory, trial merge       549 passed (549)
```

Base 548 → head 549 is the one new case; no existing test changed its verdict. The new case also passed on three independent occasions (the directory gate, the chain-only gate, and a targeted run), so no flake was observed — that is three runs, not a soak.

## Result 2 — the author's mutation table reproduces, row for row

Fourteen single-point mutants, each applied alone, whole directory run each time, tree restored and hash-checked after every row. `C1`–`C3` are positive controls: nothing here is worth reporting unless the runner can see a planted break.

| row | what the mutant does | base arm (6 cases) | head arm (7 cases) | author's table |
| --- | --- | --- | --- | --- |
| M1 | `rerun` reads a 5xx as a refusal, giving the lost re-run back | killed (unit only) | killed (chain + unit) | chain + other tests fail ✓ |
| M2 | `rerun` counts the re-run only once GitHub answers | killed (unit only) | killed (chain + unit) | chain + other tests fail ✓ |
| M3 | `ci-log` reads no timed-out job | killed (unit only) | killed (chain + unit) | chain + other tests fail ✓ |
| M4 | `snapshot` takes a timed-out check for no failure | killed (unit only) | killed (chain + unit) | chain + other tests fail ✓ |
| M5 | `rerun` counts no timed-out job of the run | **survived — 548/548 green** | killed (chain only) | chain fails, other tests pass ✓ |
| M6 | `rerun`'s error drops what `gh` said | **survived — 548/548 green** | killed (chain only) | chain fails, other tests pass ✓ |
| M7 | fake: `run rerun` ignores `loseNextAnswer` | n/a | killed (chain only) | chain fails ✓ |
| M8 | fake: re-runs only `FAILURE` jobs | n/a | killed (chain only) | chain fails ✓ |
| M9 | fake: the whole fake as it is on `main`, test file kept | n/a | killed — **only the new case fails**, the other six pass | ✓ |
| M10 | fake: `saveWrite` never loses an answer (both doors) | n/a | killed (2 chain cases: the reply-lost case and the new one) | not in the table; added here |
| M11 | fake: the spent-answer flag is saved before it is cleared | n/a | killed (2 chain cases) | not in the table; added here |
| C1 | `rerun`'s per-head budget never refuses | killed | killed | positive control |
| C2 | `ci-log`: no job counts as failed | killed | killed | positive control |
| C3 | `snapshot`: no check counts as failed | killed | killed | positive control |

What the base arm adds is the part the table cannot show:

- **No coverage came loose.** Every mutant killed on the base arm is killed on the head arm. The base arm kills `M1`–`M4` through unit tests only — `runRerun > counts a re-run before asking GitHub`, `runCiLog > reads finished failed jobs one by one while the run is still going`, `trackFailingChecks > gives a check its pushes back on a head someone else pushed` — and the head arm kills the same four in the chain test as well. Those three unit tests are deliberate pins, not collateral: each names the timed-out or lost-answer behaviour it asserts.
- **`M5` and `M6` are a genuinely new axis.** Both are invisible to the entire base suite (548/548 green): a timed-out job the base fake never queues, and an error string no base test inspects. The new chain case is their only pin.
- **`M9` is the PR's own premise, verified.** With `main`'s fake and the new test, exactly one case fails, and it fails the way the author predicted: `promise resolved "[ { rerun: true, runId: 12, …(1) } ]" instead of rejecting`.
- **The shared write door is pinned from both sides.** `saveWrite` is now the one place an answer can be lost, for the comment POST and the re-run alike. `M10` (never lose it) and `M11` (persist the spent flag one write too long) each take down the earlier reply-lost case *and* the new case — the refactor did not quietly narrow the older case's coverage.

## Result 3 — the fake's guard behaves as described, with one wording correction

Fifteen scripted assertions against the two fakes, called directly from immutable git blobs (`fake-gh-head.mjs`, `fake-gh-base.mjs`) so no mutant row could contaminate them:

```
base fake, missing world file     exit 1, log has 0 entries
head fake, missing world file     exit 2, log has the call, then "world <path>: ENOENT …"
base fake, malformed JSON         exit 1, log has 0 entries
head fake, malformed JSON         exit 2, log has the call, then "… Unexpected end of JSON input"
base fake, null world             exit 1, log has 1 entry (the call), no cause
head fake, null world             exit 2, log has the call, then "… Cannot read properties of null (reading 'owner')"
base fake, {} world               exit 1, log has 1 entry (the call), no cause
head fake, {} world               exit 2, log has the call, then "… Cannot read properties of undefined (reading 'number')"
head fake, CANCELLED job via jobs list   exit 2, "job conclusion CANCELLED"
base fake, same world                    exit 0 (answers it)
head fake, re-run of a TIMED_OUT job     exit 0, a new attempt queued
base fake, same call                     exit 0, nothing queued
head fake, re-run of a run with no failed job   exit 2, refused as unsupported
base fake, same call                            exit 0, nothing queued
head fake, FAILURE job via jobs list            exit 0 (control: the guard does not over-refuse)
```

## Result 4 — the numbers and the test list in the prose

The claimed numbers were parsed out of the PR body and compared with what ran, not hardcoded: 7 chain cases (7 in the file), 549 for the directory (549 measured), 542 "other" tests (7 + 542 = 549). §12 of the design document names both the new case and the conflict case #16017 added late, in English and in Chinese, and all seven items of the list exist as chain cases.

## Findings

All three are non-blocking; none contradicts the PR's purpose or its table.

**1. `Suggestion` — two behaviours are pinned only by the chain case.** `M5` (a timed-out job counts as a failed job of the run, `snapshot.ts` `failedJobsOfRun`) and `M6` (the re-run error carries what `gh` said, `rerun.ts`) survive the whole unit suite and die only on the new case. The author's table states this ("the directory's other 542 tests: pass"), so it is documented rather than hidden. If you want the same protection at unit granularity, one case in `rerun.test.ts` per behaviour is enough; the chain case stays the integration-level witness.

**2. `Suggestion` — the fake's conclusion guard does not cover the job-log route.** `actions/jobs/<id>/logs` reads `world.runs` directly and never passes through `modelled()`. Measured on one world with a `CANCELLED` job: the jobs list refuses (`exit 2, "job conclusion CANCELLED"`), the log by id answers (`exit 0, "e2e cancelled"`). This is unreachable through the helpers today — `ci-log` always lists the jobs first — so it does not weaken the new case; it only narrows the file's own promise that anything it does not model fails the call. Moving the lookup through `findRun`-style validation would close it.

**3. `Suggestion` — the new refusal of an unmodelled conclusion narrows what a future case can seed.** `STARTUP_FAILURE` is a conclusion the helpers treat as a failure (`FAILED_CONCLUSIONS`) but the fake now refuses, so a future chain case for that path must extend `JOB_CONCLUSIONS` first. The PR says this on purpose and it fails loudly (`exit 2`, logged), which is the right trade; recorded here so the next author knows where the door is.

## Corrections to the PR description

The body says of the world-file guard: *"the old fake exits 1 and writes nothing to the log"*, listing a missing file, malformed JSON, `null` and `{}` together. That holds for the first two; for `null` and `{}` the old fake parses the world, logs the call, and then dies deriving the repository and PR names — one log entry, no cause. The new fake is uniform (call, then an `unsupported` naming the path and the error, `exit 2`) either way, so the code needs nothing; the sentence is slightly wider than the measurement. A precise version: *"a missing or unparseable file left the log empty; `null` and `{}` logged the call and died without naming a cause."*

## Not covered

- **The "24 mutants #16017 was checked against" claim.** Re-deriving that set is not what this round measured; the related fact that *is* measured is that the six pre-existing chain cases still pass with the new fake, and that `M9` (the `main` fake) fails only the new case.
- **Windows.** The chain suite skips on Windows, as before; nothing here changes that.
- **A full-repository run.** Only the `autofix-pr` directory was run, at base, head and the trial merge; other suites that might touch the fake (none were found by search) were not run.
- **Soak/flake.** The new case ran green three times; that is not a flake measurement.
- **A per-commit mutation matrix.** Not applicable to a test-only diff, and not claimed.

## Evidence

- `evidence/01-mutation-matrix-base-vs-head.png` — the 14 mutants × 3 columns, as the ledger printed them.
- `evidence/02-fake-gh-world-guard.png` — the 15 world-guard assertions, base fake beside head fake.
- `evidence/03-new-chain-case-head.png` — the new case passing on the head alone.

Harness scripts and raw logs: `world-guard-probe.mjs`, `claims-check.mjs`, `log-door-probe.mjs`, `probe.out`, `claims.out`; per-row vitest logs and the runner in `/tmp/pr16138-mut/`.

## Where the claim lives in the code

- `packages/cli/src/commands/autofix-pr/__fixtures__/fake-gh.mjs` — `FAILED_JOB`/`JOB_CONCLUSIONS` and `modelled()`, `saveWrite()`, the world read inside the guard, `runRerun()`'s queued attempt and its 502 wording.
- `packages/cli/src/commands/autofix-pr/chain.integration.test.ts` — the new case, `Conclusion` gaining `TIMED_OUT`, `ci()` attaching a log to a timed-out job, and the two attempt keys now pinned exactly at `#100001`.
- `packages/cli/src/commands/autofix-pr/{rerun,ci-log,snapshot}.ts` — the unchanged helpers the mutants target; their timed-out handling is what the new case holds down.
- `docs/design/2026-10-21-autofix-pr-command.md` §12 and its Chinese counterpart — the test list both versions now share.
