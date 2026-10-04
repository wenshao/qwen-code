# PR 13336 real-environment verification (head 6ee195a, base eb0b79c5)

Evidence for the verification comment on QwenLM/qwen-code#13336.

- `01`–`04-*.png` — the four cards, rendered by `rig/make-cards.mjs` from `results/` and `runs/` only.
- `rig/rogue.mjs` — R3-2: the real TypeScript authority creates a Session through the Spring HTTP Session Store, a second writer commits one crafted transaction over raw HTTP, a fresh authority reopens it (`openManagedSession`). Results: `results/rogue-*.jsonl`.
- `rig/split.mts` + `rig/gen-h3preview.mjs` — R3-3: real Spring jar + MySQL 8.4.7 + Hosted Harness on a Workspace-bound Session; the Harness runs a copy of the shipped bundle with two anchored edits (monitor_run enabled; a trigger chunk makes the authority commit the shared fixture's first monitor_run revision). Runs: `runs/split-*-r4/`.
- `rig/cancel.mts`, `rig/MapProbe.java`, `rig/monitor-cancel.mjs` — R3-1: the real Broker row for a call cancelled before its claim, each jar's `executionOf` on it, and the Monitor settling revision committed to each arm's store. Runs: `runs/cancel-head-1/`, `results/r3-1-*.txt`.
- `rig/upgrade.mjs` — head jar on a copy of a base-era database (V34 → V35). `results/upgrade.txt`.
- `rig/mutate.mjs` — 15 mutants, one anchored edit each, file restored byte-identical. `results/mutants.tsv`.
- `rig/run-e2e.sh` — the repo's own `scripts/run-managed-agent-server-e2e.ts` on head (real model qwen3.8-max and `--session-failover`). `results/e2e.tsv`, `runs/e2e-*.log`.
- `rig/ab-hook.sh` — base/head A/B of `ManagedAgentMySqlIT#admitsHookExecutionsWithoutReadingTheirHistoryOnMySql` on MariaDB 10.11.18. `results/ab-hook*.tsv`.
