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
