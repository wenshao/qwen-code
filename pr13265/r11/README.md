# PR #13265 round 11 (head abf9687ce6)

Main changed server Java and core managed-runtime modules, so the jar was rebuilt (`results/java-build.txt`) and the `.75` probes re-run at this exact head.

## Linux (192.168.0.75): `linux-75/`

`run-75-r11.sh` runs L1/L13/L14/L15b/L19/L20 for two builds:

| Build | What it is |
| --- | --- |
| `head13` | The exact-head dist |
| `rest13` | head13 plus the two round-3 edits (`probes/fix-rest8.mjs`) |

## Real stack: `macos/`

Spring jar built at abf9687ce6, native MySQL 8.4.7, fresh schema.

| Scenario | What it covers |
| --- | --- |
| S13 | Refused finalize, then attach with and without `settleAttached` |
| S14 | Lineage under sequential and concurrent writes |
| `s15-forward-retry.mjs` | Injects one failure into the Nth record forward (`FAIL_AT`). `s15-fail2` is a mid-capture forward; `s15-fail3` is the final forward inside finalize. |
| `s15b-final-forward-failure.mjs` | The final-forward failure, then waits 20 s (`s15b-retry0`), or sends the same finalize once more (`s15b-retry1`) |

## Mutants: `mutants/`

`mutants-r11.mjs` applies each mutant to a local worktree and restores it, checking that `git diff` is clean afterwards. It covers M3a, M3b, M7, M8 and M8b; M8c (the finish-arm forward propagates) was run the same way.

## Results: `results/`

TS cli (22 files) and core suites, and the Java build.

The local rig database password is redacted as `<local-rig-password>`.
