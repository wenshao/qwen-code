# PR #13088 — real-environment verification, round 3 (head f5ede8cea8)

f5ede8cea8 = 2cbf89313a + one line in HostedWorkspaceStorageGuardMySqlIT. Round 2 (2cbf89313a, c21efbdfa1) is in `../r2/`, round 1 in `../`.

- `r3-01-f5ede8cea8.png`: the card in the report, from `harness/cards-r3.mjs`.
- `results/head-f5ede8cea8/`: the two W1a ITs three times plus the claim negative control (`java-it.console.txt`, summaries), the scenario consoles and logs re-run on this head, the jar class comparison.
- `results/ci/`: totals and W1 markers of GitHub job 110041689350.
- Scripts: `harness/` (this round's runners); the scenario scripts themselves are in `../r2/harness/vm/`.
Paths are rewritten (`/rig` is the rig root); tokens and keys are rig-only dummy values.
