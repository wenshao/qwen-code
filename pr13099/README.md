# PR #13099 verification evidence

Head `697d38a33e` merged into main `3a8fd11711` (arm 2). Arm 1 is the earlier
head `6cc7cdd8f9` on main `3b18cfe5e4`, run before the head moved.

- `*.png` - evidence cards rendered from `results/arm2`
- `results/arm2/mutation-matrix.jsonl` - one line per (test variant, mutant)
- `results/arm2/r*.json` - one record per real-stack scenario
- `harness/` - the rig: Spring + MySQL 8.4 + packaged Hosted Harness + Broker,
  a recording/fault-injecting tap between Spring and the Harness, a scripted
  OpenAI-compatible model, and the scenario drivers. Paths and ports are local.
