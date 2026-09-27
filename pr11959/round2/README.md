# PR #11959 round 2: head `9088f00bd3` (autofix round 7)

Arms: base = `1dbb3786ea`, r1 = `f5ba51ff2c` (round-1 report), r2 = `9088f00bd3`.
Every cell drives a real bundled `dist/cli.js` with an isolated `QWEN_HOME`.

| file | what |
| --- | --- |
| `r2-01-dashscope-real-endpoint.png` | real CLI vs a real DashScope endpoint, base vs r2 |
| `r2-02-matrix.png` | `/context -d` windows and wire `max_tokens` (default and explicit 32768), base / r1 / r2 |
| `r2-03-refresh.png` | F1 lifecycle on r2, the empty-cache heal guard (r1 vs r2 on one poisoned cache), near-empty projection residual |
| `r2-04-env-channels.png` | every channel that can set `QWEN_CODE_MODELS_DEV_URL`, r1 vs r2 |
| `evidence/mutations.txt` | five source mutants (one per r2 fix) against the owning suites |
| `rig/` | round-2 scripts (`arms.sh`, `heal.sh`, `partial.sh`, `projenv-channels.sh`, `fig-r2-*.sh`, updated `mirror.mjs`) |

Endpoint URLs, key names and scratch paths are replaced as in round 1.
