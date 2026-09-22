# PR #12267 round 7 harness (head 54c6407f69)

Arms: `head` = 54c6407f69 (this head), `prev` = 0b4349f088 (round-6 head `05f6d76332` rebased onto `0fa0c54289`; the delta commit is the R6-1 fix).
Each arm: `node scripts/setup-worktree.js`, `npm run build`, `npm run bundle`. `q.sh <arm> <policy> ...` runs the bundled CLI with an isolated `QWEN_HOME` (policies live in `$ART/scratch/home-<pol>/settings.json`).

Scripts are parameterised to the local artifact dir (`ART=...pr12267-verify-20260922-164444`); edit `ART` to reuse.

- `fd-escape.sh`, `nobody-escape.sh`: R6-1 A/B (redirected stdin as host descriptor) — root and uid 65534 rows
- `stdin-matrix.sh` (+ `fifo-data.sh`, `spawn-socket.cjs`): R5-1 stdin-shape regression matrix
- `epipe-matrix.sh`: R5-2 downstream-close matrix
- `r53-tail.sh` (+ `burst-reader.py`): R5-3 short-tail-after-drain re-measure
- `verify-net.sh`: `sandbox --verify` 4 policies x uid {0,65534}, loopback open/closed probe
- `tool-path.sh` + `fake-model.cjs`: scripted-model run_shell_command check, prompt piped on the CLI's stdin
