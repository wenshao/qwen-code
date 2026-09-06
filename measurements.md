# Measurements (macOS 15.6 / Darwin 25.6, Apple 10-core, Node 24.18.1, vitest 3.2.7)
Tree: worktree at PR head dabd8dae87 (merge of main 1b604721b0 + the one-file change)
Arm A = test file at merge-base 1b604721b0 (child process + SIGKILL 20s)
Arm B = test file at PR head (in-process + expectWithinLatencyBudget 1000ms x20)

## What each ceiling measures (idle-ish host, load ~80)
armA spawn_total_ms=8754   child_work_ms=204     -> 97.7% of the 20s ceiling is tsx startup
tsx import only: 9766 / 6766 / 4461 ms (3 cold runs)
armB inprocess_ms=96 / 279 / 146 (cold, first call in worker)
armB warm median (7 calls): 20 ms

## Separator sensitivity of the measured projection (warm, median of 7)
plain_text=22ms sep0=20ms sep1=20ms sep5=20ms sep10=19ms sep40=20ms sep200=21ms sep1000=58ms
-> at the fixture's 40 separators the guarded scan contributes ~0 ms of the measured value

## A/B, no added load (host load 68-82)
armA spawn_total_ms=4347 PASS | armB inprocess_ms=65 PASS
armA spawn_total_ms=4779 PASS | armB inprocess_ms=81 PASS

## A/B, +30 spinners (load 108-170)
armA 13707 PASS | armB 430 PASS
armA 11977 PASS | armB 284 PASS
armA 14263 PASS | armB  79 PASS

## A/B, +80 spinners (load 188-213)
armA 20085 FAIL  AssertionError: expected Error: spawnSync ... ETIMEDOUT to be undefined
armB  1425 FAIL  AssertionError: expected 1425 to be less than 1000
armA 20034 FAIL  (same ETIMEDOUT)
armB   537 PASS

## Parallel-suite self-contention (npx vitest run src/ui/utils = 60 files, 1505 tests)
armB inprocess_ms=247 PASS

## Injected regression (catastrophic backtracking added to hasAmbiguousUrlHomePath)
armA: EXIT=1 WALL=29s   -> spawnSync ETIMEDOUT (SIGKILL at 20s), clean failure
armB: EXIT=137 WALL=180s -> zero vitest output; killed by external limit; no 15s testTimeout fired

## Cost of the injected regression vs separator count (plain node, measured)
14->5ms 16->4ms 18->18ms 20->67ms 22->1156ms 24->963ms 26->4313ms 28->16828ms 30->84400ms
growth ~4-5x per +2 separators -> extrapolated at the fixture's 40: 19-43 hours

## Mutation matrix on arm B (target case only)
BASELINE quiet lane                 exit=0  1 passed
BASELINE pool lane                  exit=0  1 passed
M1 budget=1, quiet lane             exit=1  AssertionError: expected 60 to be less than 1
M1 budget=1, pool lane              exit=1  AssertionError: expected 61 to be less than 20
M2 poolMultiplier removed, pool lane exit=0 SURVIVES (assertion checks nothing there)
M3 leak assertion inverted          exit=1  expected '{"schemaVersion":1,...' to contain 'alice'
M4 'ordinary' assertion inverted    exit=1  fails

## Whole-file runs (72 tests)
armA quiet lane  72 passed  file=7153ms case=2810ms
armA pool lane   72 passed  file=6738ms case=2424ms
armB quiet lane  72 passed  file=4217ms case<1s
armB pool lane   72 passed  file=4201ms case<1s

## Lint/format
eslint: clean | prettier --check: clean

## CI facts (from the run the PR cites, job 101100555383)
export-transcript-document.test.ts: 72 passed, file 102716ms, this case 14306ms (PASSED)
only failure: acpAgent.test.ts runtime-root pinning choke point (assertion, not timeout)
fixed by #11036, merged 2026-09-05T02:45:52Z
