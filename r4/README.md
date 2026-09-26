# PR #12250, round 4: head `7ab49d5e0d`

Host: macOS 26.6 arm64 (Apple M1 Max), Node 22.23.2, `pnpm install --frozen-lockfile`.
Trees: head `7ab49d5e0d`, and head merged with `main` `939b4db6bc` (clean merge, tree `ba102db92a`).

| Path | What |
| --- | --- |
| `images/` | the three figures in the report |
| `matrix/summary.txt` | every whole-suite run: arm, mutant, counts, failing test names (reruns appear after the load-hit first runs) |
| `matrix/hashes.txt` | sha1 of the production files and the test files for every run |
| `harness/unit/` | `run-matrix4.sh` (one full `packages/acp-bridge` run per arm × mutant), `mutate*.py` (text-anchored mutants, each must match exactly once), `variants4.py` (`r4settled`) |
| `bundle-diffs/` | the four real-stack arms as diffs against the head bundle (`obs` = probe line only) |
| `harness/rig/` | real-stack rig: scripted OpenAI-compatible model, `qwen serve` launcher, `probe4.mjs` (100 ms live-state sampler), `ui4.mjs` (Web Shell capture) |
| `runs/` | per-run JSON for 4 arms × 3 runs: every sample, every `[probe-aws]` projection tally, the model log |
| `ui/` | full Web Shell screenshots and the same-instant capture JSON |
| `logs/` | the PR's own commands at head; CI excerpts for `7ab49d5e` |
