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

## Round 2 — head `02665c2cf7` (2026-09-22) → `r2/`

Head `02665c2cf7` (merge-base `97b1b252e3`), plus the merged tree `origin/main 5feb7a4f34` + head. macOS 25.6 / Node 24.18.1 / pnpm 11.24.0.

- `r2/images/` — figures 4 and 5 used in the round-2 comment
- `r2/retention/` — the retention test alone, previous version (`301dbdbeea`) vs new, under each variant × mutant
  (`summary.txt`; `hashes.txt` = hash of production and test source for every run; `new-test-under-M10.txt` = vitest output)
- `r2/matrix/` — whole `packages/acp-bridge` suite per mutant, `pr` = head test files, `base` = merge-base test files, production identical
- `r2/harness/`
  - `mutate2.py` (+ `mutate.py`) — R1 mutants plus M12 (`end_turn` keeps the turn), M13 (no settle hook), M14 (unknown retains)
  - `variants2.py` / `run-var.sh` — retention-test variants: `nosnap`, `noctrl`, `sub`, `reap0`, `legacy`
  - `run-matrix2.sh` — the whole-suite matrix
  - `make-arms2.py` — real-stack bundle arms built from the head bundle, anchored on text:
    `obs` (stderr probe lines only), `mut` (+ the 7 pinned `backgroundTurn` terms off), `ur` add-on
    (the child's `collectActiveWorkHolds()` returns `[]` while its own background turn runs)
  - `probe.mjs` — scenarios `window`, `retain`, `retainx` (re-attach at a fixed delay), `retainw` (re-attach 0.5 s after the daemon's first conditional close)
  - `start.sh` / `stop.sh` / `env.sh` / `mock-llm.mjs` / `settings.json` — real `qwen serve` per arm, isolated `HOME` + `QWEN_RUNTIME_DIR`, reaper 500 ms / idle 1 s
- `r2/runs/` — raw probe outputs, per-run timelines, and the daemon's `[probe-*]` / close / reaper lines per arm
- `r2/bundle-diffs/` — `diff -ru dist dist-<arm>` for every arm
