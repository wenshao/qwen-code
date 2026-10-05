# PR #13402 real-environment verification evidence

- `01-stack-ab.png`, `02-threads.png`, `03-tests-mutants.png` — figures in the PR comment.
- `rig/hub.mjs` + `rig/configs/*.json` — packaged-stack rig (MySQL 8.4.7 + Spring fat jar per arm + packaged Hosted Harness + fake model); `rig/run-stack.sh` runs one fresh DB/JVM per config.
- `rig/mutate.mjs` + `rig/run-mutants.sh` — SessionEventHub mutants applied to the trial merge; `rig/run-verify.sh` — full `mvn verify`.
- `results/stack.json`, `results/runs/*/result.json`, `results/stack-summary.txt` — per-run results.
- `results/mutants.tsv`, `mutants/*.diff`, `mutants/*.log.gz` — mutation matrix.
- `dumps/*.txt.gz` — `jcmd Thread.print` and `Thread.dump_to_file` taken 5 s after subscribing.
- `logs/verify-{head,mut}.log.gz` — full `mvn verify` on PR head 2552154bf3 and trial merge 6bf9785da7.

Arms: main = 8d864a9f21, trial merge = 6bf9785da7 (main + #13402 head 2552154bf3).
