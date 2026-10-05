# PR #13166 — real-stack verification, round 5 (head `0ce55064`)

Rig: packaged Hosted Harness (`qwen serve`, driven through `/session` with a `toolProfile`) → Spring server jar
(Session Store on MySQL 8.4 + embedded Runtime Broker) → local-process Runtime workers from `dist/<arm>/cli.js`.
macOS arm64, Node 22.23.2, JDK 21. Spring runs with `durable-local-process=false` and
`trusted-local-reboot-recovery=false` (#13211's Linux-only defaults; a rig setting). Host load 20–101.

| File | What |
| --- | --- |
| `r5-01-deadline.png` | Round-4 wedge (6b86c46c, `logs` of round 4) next to the bounded error at 0ce55064 (S19, S22) |
| `r5-02-cost.png` | `bench-glob-worker.log` (in-thread vs bundled worker) + S21 (150k / 1M files) + S24 (six globs per response) |
| `r5-03-symlink.png` | S23 / S23b / S23c: symlinked `path`, `[.][.]` climbing, containment above the Session root |
| `r5-04-gaps.png` | 15-mutant sample (`logs/mutation/ledger.jsonl`) + the G1 mutant on the real stack (`logs/g15`) |
| `candidate-deadline-tests.patch` | tests only (+39 core, +26 cli): thread terminated before a timed-out / cancelled glob settles; Hosted glob runs on a terminable thread |
| `logs/g14/*` | round-5 probes on 0ce55064 (DB `g14`) |
| `logs/g15/*` | S22 against the G1 mutant bundle (`await worker.terminate()` → `void worker`) and its thread samples |
| `logs/unit-r5-*.log` | touched suites: core 129/129, cli 1010/1010 |
| `logs/mutation/*` | `mutate-r5.mjs` runs; G4 hung the core suite and was stopped by PID (the vitest worker ignored SIGTERM) |
| `probe/*` | probe scripts (`lib.mjs` and `spring.sh` unchanged from round 4) |

Probe labels: S21 big tree, S22 deadline/cancel, S23 symlinked roots, S23b climbing spellings, S23c climbing above the
Session root, S24 batched globs. The regression runner `run-r3.sh` and `s19-r4.mjs` are reused from earlier rounds.
