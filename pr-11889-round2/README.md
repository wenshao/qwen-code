# PR #11889 — round 2 verification at `341a0d67b5`

Round 1 (at `5fd2460104`): https://github.com/QwenLM/qwen-code/pull/11889#issuecomment-5723783044,
harness on `wenshao/qwen-code@assets-pr11889`.

- `01-fault-window-reads.png` — arm F: a real `EROFS` defeats the rollback; R1 head / head / head+patch.
- `02-held-prune-absorbed.png` — arm G: restore done, prune of a v2-only directory held.
- `03-mtime-order-test.png` — `falls back to mtime order …` red on pristine head, green with patch.
- `04-round1-regression.png` — the round-1 arms re-run at this head.
- `05-mutation-matrix.png` — 20 mutants on the round-2 delta.
- `full-fix.patch` — +32/−14 against `341a0d67b5` (fault-window refusal + test pinning).
- `harness/` — `arm.mjs --arm=F|G --dist=<core dist> --work=<ext4 dir> --sp=<dir with harness/ and lockfs/>` (needs root for the bind mount); `data/` — raw logs.
