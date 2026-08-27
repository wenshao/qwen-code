# PR #10119 — verification evidence

## Round 2 — head `6962311` (after the fix commit `d9bd123`)

| file | what it shows |
| --- | --- |
| 01-fix-b.png | §B fixed: the whole-fan-out message no longer prescribes a loop |
| 02-fix-c-nit.png | §C fixed, and a refused plan now creates no directory |
| 03-mutation.png | mutation matrix 16/16, plus the hermetic-fixture and TS1117 fixes verified |
| 04-regression.png | full matrix re-run after the merge of main — nothing regressed |

## Round 1 — head `891b6ac`

| file | what it shows |
| --- | --- |
| 01-emit.png | the real CLI emitting the fan-out script |
| 02-parity.png | byte-parity vs `agent-prompt --roster` and the prompt records |
| 03-live.png | 14 real subagents dispatched through the live Workflow tool |
| 04-failclosed.png | one capped agent discards the whole fan-out |
| 05-guards.png | refusals, symlink containment, real loader behaviour |
| 06-budget.png | measured one-tool-result budget and what happens above it |
| 07-mutation.png | mutation matrix against the PR's new tests |
