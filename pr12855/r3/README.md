# Round 3: head ebbce5bf6d merged with main 0a136f89d7

Every run used the local merge `9fc58a37fa`, except the `*-v5.*` summaries, which cover the PR head alone.

- `results/v5-mutants.*`: 25 mutants. `T18-rerun.txt` explains why T18 shows LIVES in the log (the runner's file list) and records the re-run that kills it.
- `results/new-s14-disabled.log`: monitor_run disabled after records exist.
- `results/s13-delete-race-ebbce5bf6d-merged.log`: 0/186. Round 2 holds the A/B against the pre-lock jar.
- `results/flake-ManagedAgentServerIntegrationTest-reruns.txt`: the unrelated flake from the first full run, followed by 5/5 passing reruns.
