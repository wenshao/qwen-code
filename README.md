# PR #10300 — maintainer verification assets (round 2, head `ff01d1e075`)

Everything used to produce the verification report posted on
https://github.com/QwenLM/qwen-code/pull/10300

## Arms

| arm | what it is |
| --- | --- |
| `main` | `74e71c5945` |
| `PR head` | `ff01d1e075` merged into `74e71c5945` (clean merge, tree `930435603b`) |
| `PR minus the R9-1 fix` | PR head with **only** `moveLedgerSidecar`'s direction-aware branch reverted to the direction-blind append it had at `dc689848` |

Environment: Debian 13 (Linux 6.12.63, x86_64), Node v22.22.2, npm 10.9.7, uid 0, sandbox off.

## Harness

| file | what it drives |
| --- | --- |
| `harness/ledger-ab.mjs` | prompt-ledger merge ordering (L1–L5) through the real serve lifecycle entry points |
| `harness/fence-ab.mjs` | post-commit ownership fence (F1–F5) |
| `harness/daemon-e2e.sh` | a real `qwen serve` daemon + real loopback `POST /sessions/unarchive` |
| `harness/fence-deterministic.mjs` | deterministic `node:fs` fault injection at the two mutation-survivor sites |
| `harness/fence-window.mjs` | event-loop-poller variant (kept for completeness; it lands outside the intended window) |
| `harness/enospc.mjs` | real `ENOSPC` on a 6.5 MiB ext4 loop filesystem, both merge directions + retry |
| `harness/cost-and-m5.mjs` | no-op batch lease cost |
| `harness/mutate.py` | five mutations of the PR's own source, judged only by the PR's own test files |

Run any harness with `TREE_ROOT=<worktree> node harness/<file>.mjs`.

`raw/` holds the unedited observation JSON each run produced.

| `harness/r10-1.mjs` | conflict repair vs. an unattributable active copy (the open R10-1 thread) |
