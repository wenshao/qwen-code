# PR #13265 verification evidence (head 817383760e)

Base 1a4de7486a. Real stack: the PR's Spring jar on MariaDB 10.11.18 (docker),
driven by the PR's built `packages/core/dist` over the HTTP session store.
macOS arm64, JDK 21.0.12, Node 24.18.1.

| Image | Scenario logs |
| --- | --- |
| 01-real-stack-chain.png | results/scenarios/s1-gate-{head,base}.log, s2-chain.log, s2-chain-merge.log |
| 02-resource-closure.png | s3-closure-ABCE.log (cases A, B, C), s3-closure-D.log, s3-closure-E.log |
| 03-differential-npe.png | results/differential-compare.txt, s4-bypass.log, spring-head-npe-excerpt.log |
| 04-reattach-and-order.png | s2-chain.log (shell-3), s4-bypass.log, s5-order-{old,new}.log |
| 05-mutation.png | results/mutation/* |

Notes
- `s3-closure-ABCE.log` is the first run of the five-case script. Its D case
  used a filter that the client undid (it re-adds refs from the staged body)
  and its E case was refused locally; D and E were rerun with the corrected
  script (`s3-closure-D.log`, `s3-closure-E.log`). Only A, B and C are cited
  from the first log.
- `s5-order-*-with-bypass.log` is a first S5 run that also committed a
  non-start first revision through a bypass writer; the H3 reader then calls
  that log corrupt on reopen. The cited S5 run uses an honest writer only.
- `s5-order-old.log` RESULT `authorityTasks` is a hard-coded value from a
  script bug fixed after the run; the `[old server state]` line holds the
  measured value (see `s5-NOTE.txt`).
- `child_run` is enabled only inside the rig process (`ENABLE_CHILD_RUN=1`
  pushes it onto `MANAGED_SESSION_ENABLED_DOMAINS`), as the PR's own
  authority test does with `vi.mock`. S1 runs without it.

Harness: `harness/` (scenario scripts, launcher, Java build), `harness/diff/`
(200k-candidate TS/Java differential), `harness/mut/` (mutants, runners,
survivor classification), `harness/render.mjs` (cards).
