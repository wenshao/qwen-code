# PR 13093 — real-environment verification evidence

Verified head `547b5776b5` (docs only: `packages/sdk-java/managed-agent-server/README.md`).

- `01..06-*.png` — evidence cards. Every line in a card is read from the raw logs under `results/` by `rig/build-specs.mjs`; `rig/render-cards.mjs` only draws.
- `rig/` — the harness: `build-arm.sh` / `build-refresh.sh` (the README's own build commands), `run-e2e.sh` (runs one README command and records the process tree through `watch-procs.mjs`), `path-probe.sh` (one prerequisite removed per run), `run-it.sh` (HostedPublicWorkspaceIT), `tap-run.mjs` (keeps the Harness log and public event rows before the runner cleans up), `diagnostic-session-store.diff` (diagnostic runner copy, not a proposed change).
- `results/<run>/` — `RESULT` (one line: rc, seconds, head), `env.txt`, `procs.jsonl`, and the run's logs. Run names: `r*` = main `3a8fd11711` + PR, `m*`/`g*`/`n*`/`i*`/`d*` = main `3b18cfe5e4` + PR, `p*` = PR head, `x-*` = runs discarded for a rig error (kept with a NOTE).

No credential value appears in any file here; `rig/assemble-bundle.mjs` checks that before the bundle is written.
