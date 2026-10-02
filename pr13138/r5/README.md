# PR #13138 — real-environment verification, round 5 (head `26de3752`)

Head `26de3752`: W1b validates Hosted file-history records with the live parser (`parseHostedFileHistoryRecord`,
including #13144's undo-receipt rules); Java main sources are byte-identical to `d8bc703e`. Same Ubuntu 24.04 ext4 VM +
MySQL 8.4.11 rig.

| Path | What |
| --- | --- |
| `01-undo-receipts.png` | Real undo shapes written by the head and by `d8bc703e` (pre-#13144), cold load, capture/verify; runbook on the head |
| `results/e2e-r5/` | `r5-undo-{head,legacy}*`, `r4-runbook-26d*`, every maintenance run's stdout/stderr |
| `results/unit-ts-r5.log` | W1b + hosted-file-history suites on the head (139 tests) |
| `results/flaky*.txt` | `ManagedEventReplayTest` loops behind the CI diagnosis (0/140 locally) |
| `harness/` | `r5-undo.mjs`, `r4-runbook.mjs`, `flaky-loop.sh`, card generator, push script |
