# PR #11165 — local verification evidence

Screenshots produced by a local real-execution verification of
`refactor(ci): extract release workflow scripts` at head `8eb111ad`
against merge base `63578c7e`.

| file | what it shows |
| --- | --- |
| `01-differential.png` | 67-scenario differential execution: merge-base inline shell vs the extracted scripts |
| `02-trust-boundary.png` | Real sparse checkout + poisoned older ref; A/B on the reset + re-checkout step |
| `03-dockerignore.png` | Real `docker build` proving the new `**/.git` line keeps the helper checkout's `.git` out of the sandbox context |
| `04-workspace-guard.png` | The transport-timeout guard driven by real, induced `[vitest-worker]: Timeout calling` logs |
| `05-push-guard.png` | Push-time guard exit-code matrix, plus the new version-format gate |
| `06-mutation.png` | 11-mutation battery against the PR's new tests |
| `07-gates-and-docker.png` | Repo gates base vs head, and the docker runner's real flock/fd protocol |
| `08-sweep-blind-spot.png` | Why the re-pin sweep's `npm` predicate went vacuous, and a validated fix |
