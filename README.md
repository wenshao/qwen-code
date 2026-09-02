# PR #10527 — local verification evidence

Rig and raw output behind the verification report posted on
https://github.com/QwenLM/qwen-code/pull/10527

Targets, in order:
- round 1 — head `6263226df6f88b745c17be4d5ed9ddb72616b5c8`, +21/−4
- round 2 — head `58d4658011bfbba7a213be5d058282371edf166d`, +57/−4 (after commit
  `d5c154976c` implemented the round-1 Suggestion)

## Environment

Debian 12 container built from `rig/Dockerfile` on top of `node:22-bookworm`,
which ships Node **v22.23.2** — the exact version the PR names. Host: macOS 26.6,
Docker 29.5.2, 2 vCPU allotted to the container.

## Method

Same-tree A/B: both arms run the identical `autofix-status-heartbeat.sh` and
differ only in the one hunk of `autofix-status-heartbeat.test.mjs`
(`before` = the file as it stands on `main`, `after` = the PR's version;
`gate1` = the PR's version with `>= 2` weakened to `>= 1`, to test whether the
occurrence count is load-bearing).

The fault model is **fork latency**, not CPU starvation: `rig/make-shims.sh`
puts wrappers for `date`, `mktemp`, `head` and `timeout` first on `PATH`, each
sleeping N seconds before exec'ing the real binary. This is what a loaded
self-hosted runner does to a tick that forks several processes in sequence,
and it is the only model that reproduces the observed red (pure CPU
oversubscription does not — see `logs/cpu-contention.log`).

Every mutation is applied by `rig/mutate.py`, which asserts its anchor is
unique and the caller re-checks the file's sha256 changed — a mutation that
silently fails to apply would otherwise be reported as a surviving mutant.

## Files

| path | what it holds |
|---|---|
| `shots/s1-ab.png` | the CI red reproduced and fixed, same tree, one hunk apart |
| `shots/s2-sweep.png` | fork-latency headroom sweep, before vs after |
| `shots/s3-siblings.png` | the three sibling tests that also failed in run 33268028550 |
| `shots/s4-mutation.png` | mutation adequacy, incl. the `>= 1` vs `>= 2` question |
| `shots/s5-diagnosability.png` | what the new assertion message stops printing |
| `shots/s6-whole.png` | whole-file flake rate and full helper-suite result |
| `logs/ab-matrix.log` | 12-arm A/B and mutation matrix |
| `logs/latency-sweep.log` | 12-point latency sweep, both arms |
| `logs/sibling-sweep.log` | per-subtest breaking points |
| `logs/whole-file-flake.log` | 6+6 whole-file runs at 0.2 s/fork |
| `logs/whole-file-latency.log` | whole-file runs at 0.15 and 0.2 s/fork |
| `logs/cpu-contention.log` | 20 whole-file runs under 6× and 12× CPU oversubscription |
| `logs/helper-suite-tail.log` | full 23-file HELPER_TESTS run at PR head |
| `logs/ci-run-33268028550-failures.log` | the four failing subtests in the cited CI run |
| `rig/*` | the harness, reproducible as-is |

## Reproducing

```bash
docker build -t hb-verify:1 rig/
# put before.test.mjs / after.test.mjs / gate1.test.mjs and the .sh in rig/src/
docker run --rm -v "$PWD/rig:/rig" -v "$PWD/out:/out" hb-verify:1 \
  bash /rig/ab.sh demo after none 0.3 3
```

## Round 2 (head `58d4658011`)

Re-ran every round-1 measurement plus a new mutation family aimed at the
round-3 additions: does the new `the failed-mint gate failure carries the
observed log state` test actually pin the enriched message?

| path | what it holds |
|---|---|
| `shots/r1-messages.png` | the enriched gate-timeout message in three real failure shapes |
| `shots/r2-mutation.png` | round-2 mutation matrix, script + message mutants |
| `shots/r3-regression.png` | round-1 vs round-2, side by side |
| `logs/round2-matrix.log` | the full round-2 A/B and mutation matrix |
| `logs/round2-whole-file-0.2.log` | 6+6 whole-file runs at 0.2 s/fork (the boundary) |
| `logs/round2-whole-file-0.3.log` | 4+4 whole-file runs at 0.3 s/fork (deterministic) |
| `logs/round2-gate-timeout-messages.log` | the verbatim messages, real loop |
| `logs/round2-helper-suite-tail.log` | full HELPER_TESTS run at the new head |
| `rig/r2.sh`, `rig/mutate-test.py`, `rig/r2-matrix.sh` | the round-2 harness |

---

# Round 2 (b) — head `92609a403f`, second rig, files under `rig/r2`, `logs/r2`, `shots/r2-s*`

Second verification pass, after the author's round-3 commit `d5c154976c` extracted the
gate into `awaitTwoSkipLines(workdir, timeoutMs)` and added a witness test for the
enriched failure message. PR diff against `main` at this head: one file, +57/−4.

## Environment

Host: Debian 13, 16 vCPU, Docker 26.1.5. Container: the official `node:22-bookworm`
image as-is (Node **v22.23.2** — the version the CI runner reports — bash 5.2.15,
python 3.11), no packages added. The full helper suite mounts the repo's `node_modules`
and a static `jq` 1.7.1 read-only. Screenshots are real `xterm` windows on `Xvfb`,
captured with ImageMagick (`rig/r2/xshot.sh`).

## Files

| path | what it holds |
|---|---|
| `shots/r2-s1-ab.png` | the CI red reproduced on `before` and closed on `after`, 0.3 s/fork |
| `shots/r2-s2-shapes.png` | the gate's failure message on the REAL loop: pulse-death, never-skips, fail-open mutants |
| `shots/r2-s3-matrix.png` | A/B counts and the production-script mutation matrix, incl. `>= 1` vs `>= 2` |
| `shots/r2-s4-witness.png` | test-side variants: what the new witness pins and what it does not |
| `shots/r2-s5-sweep.png` | fork-latency sweep, both arms, 16 points |
| `shots/r2-s6-whole.png` | whole-file runs at 0 / 0.2 / 0.3 s/fork, sequential-execution proof, full suite, lint |
| `shots/r2-s7-ci.png` | CI ground truth: the slow-runner job at `58d4658011`, and the helper step across every run of the branch |
| `logs/r2/core-matrix.log` | E1–E3 raw arm results (`rig/r2/core.sh`) |
| `logs/r2/demo-*.log`, `logs/r2/var-*.log` | spec-reporter output behind s2 and s4 |
| `logs/r2/test-variants.log` | test-side variant verdicts, whole-file runs under each, witness ×20 |
| `logs/r2/latency-sweep.log` | 16-point sweep, both arms, ×2 |
| `logs/r2/whole-file-matrix.log` | whole-file runs; `whole-file-*.tap` two raw TAP outputs |
| `logs/r2/helper-suite-full-uid1000.tap` | full 23-file HELPER_TESTS run as uid 1000: 509/509 |
| `logs/r2/helper-suite-full-as-root.tap` | the same run as root: 473/509 (flakiness-gate root-identity gate) |
| `logs/r2/ci-run-33610891036-job-100185567005.log` | the slow-runner CI job: step timings, heartbeat block, what the 2 h timeout cancelled |
| `logs/r2/ci-branch-survey.tsv` | Test(ubuntu) job + helper step for every CI run of the branch |
| `logs/r2/panel-*.txt` | plain-text versions of every screenshot |
| `rig/r2/*` | round-2 harness: `core.sh`, `demo.sh`, `sweep.sh`, `suite.sh`, `variants.py`, `mutate.py` (+`mintok`), `whole.sh` (comment corrected), `xshot.sh` |

## Reproducing round 2

```bash
docker pull node:22-bookworm
# rig/src/: before.test.mjs (main), after.test.mjs (PR), autofix-status-heartbeat.sh (identical on both)
python3 rig/r2/variants.py rig/src/after.test.mjs rig/src     # gate1, baremsg, noqq, noqqpred, absentlog, emptylog
docker run --rm -e FORCE_COLOR=1 -v "$PWD/rig:/rig:ro" -v "$PWD/out:/out" node:22-bookworm bash /rig/r2/core.sh
docker run --rm -v "$PWD/rig:/rig:ro" -v "$PWD/out:/out" node:22-bookworm bash /rig/r2/whole.sh before-0.3 before 0 4 0.3
```

## Correction to round 1

Round 1 said the loop tests inside the `describe` run concurrently. They do not: node:test
runs a suite's tests one at a time (sum of the 23 subtest durations equals the suite
duration, 37.1 s, and CI's own timestamps agree). The whole-file red in round 1 was fork
latency alone; the breaking points (0.20 → 0.22 s/fork before, 0.45 → 0.50 after) are
the same on this host as on the 2 vCPU one, so the fault is latency-dominated.
