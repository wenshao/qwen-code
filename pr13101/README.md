# PR #13101 (D6b permission Actions): real-environment verification evidence

Verified heads: `c11c1bdf3c` (first pass), `358212a8b2`, `7ab2952507` (final). Report: the PR comment that links here.

## Layout

| Path | Content |
| ---- | ------- |
| `*.png` | the nine evidence cards embedded in the report (rendered from the transcripts by `harness/fig/`) |
| `results/head-7ab2952507/` | probe transcripts (`.log`) and their JSON for the final head: main sequence, upgrade from `main` `3a8fd11711`, real model, Harness skew and the optional candidate, startup matrices, contract validation, unit / Hosted IT / JDK 11 summaries |
| `results/earlier-heads/` | the same probes at `c11c1bdf3c` and `358212a8b2`, including the restart series and the default-timeout restart run |
| `results/merge-collision-at-c11c1bdf3c/` | the Flyway error of `c11c1bdf3c` merged with `main` `7827a3ffcd`, and the runs on the renumbering candidate that matched the later fix |
| `results/mutation/` | the mutation runs (see its README) |
| `results/ci/` | summaries of the CI job logs cited in the report |
| `candidates/ManagedActionsCoverageTest.java` | 8 unit tests that kill 11 mutants the PR's suites leave alive |
| `candidates/cand-yolo-old-harness.patch` | optional: let a Session pinned to `yolo` use a Harness that reports no approval mode |
| `harness/probe/` | the probes (`s1` test plan … `s14` real model), the scripted model, the recording proxy and the contract validator |
| `harness/rig/` | launchers for the server jar and the Hosted Harness, build scripts, the trusted-actor adapter source, `run-head.sh` (the whole sequence for one head) |
| `harness/mut/` | the mutation runner and the list of edits |

## Reading a transcript

Each line is `PASS`, `FAIL` or `NOTE`, a label, then the measured detail. A `FAIL` on a line that starts with `EXPECTED` is a finding of the report (F1, F2), not a broken probe.

## Rig

The server fat jar runs with `harness.enabled`, `workspace-files-enabled`, the embedded Runtime Broker and a Session Store pointing at itself. The Hosted Harness is `dist/cli.js serve --profile hosted-harness` from the same tree with a clean environment. A proxy sits between the two and records or alters calls according to `tap-rules.json`. Everything in `harness/` is for verification only; tokens, passwords and keys in it are placeholders.
