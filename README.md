# PR #12250 local verification — evidence

Verified PR head `171e1b17fc` (merge-base `009aab05b2`) on macOS 25.6 / Node 24.18.1 / pnpm 11.24.0,
plus the merged tree `origin/main c502f3dcfe` + head.

- `images/` — figures used in the PR comment
- `harness/` — everything needed to reproduce
  - `mock-llm.mjs` — scripted OpenAI-compatible model; scenario `bgwin` makes the parent launch one
    background agent, and the automatic background-notification turn run a silent 20 s shell
  - `start.sh` / `stop.sh` / `env.sh` — real `qwen serve` per arm (`head` = `dist`, `obs` = `dist-obs`,
    `mut` = `dist-mut`), isolated `HOME` and `QWEN_RUNTIME_DIR`, reaper 500 ms / idle 1 s
  - `probe.mjs` — scenarios `window`, `cdonly`, `forkonly`, `retain`
  - `ui-fork.mjs` — Playwright against the Web Shell the daemon serves
  - `make-dist-mut.py` — turns the 7 pinned `backgroundTurn` terms off in the bundle (`dist-mut.diff`)
  - `instrument-dispatch.py` — observation-only stderr lines before each child dispatch (`dist-obs.diff`
    also adds the `[probe-drain]` line; `dist-mut.diff` also carries the auto-close trace lines)
  - `mutate.py` / `run-matrix.sh` — source mutants, whole `packages/acp-bridge` suite per mutant,
    `pr` arm = PR test files, `base` arm = merge-base test files (production identical)
  - `retention-variants.py` / `run-variant.sh` — the retention-test variants in figure 2
- `runs/` — raw probe outputs (`<arm>-<scenario>-<tag>.json`) and every `[probe-*]` daemon line
- `matrix/` — per-mutant results for both test arms
