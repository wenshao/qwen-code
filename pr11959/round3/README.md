# PR #11959 round 3: head `1bb0e56e57` (= `6addd4f72c` + merge of main `700620f4`)

Arms: base3 = merge-base `700620f4d0`, r2 = `9088f00bd3` (round 2), r3 = `1bb0e56e57`.
Every cell drives a real bundled `dist/cli.js` with an isolated `QWEN_HOME`. Each PNG has a plain-text
transcript beside it in `evidence/` (same basename, `.txt`).

| file | what |
| --- | --- |
| `r3-01-max-tokens-wire.png` | wire `max_tokens` with nothing configured and with `QWEN_CODE_MAX_OUTPUT_TOKENS=32768`, base3 / r2 / r3 |
| `r3-02-dashscope-explicit-budget.png` | the same budgets against a real DashScope endpoint, with the `max_tokens` actually sent (`--openai-logging`) |
| `r3-03-regression.png` | round-2 fixes after the main merge: context windows, F1, heal guard, F2 channels |
| `r3-04-open-items.png` | near-empty projection, a null model entry, a catalog peer that never answers |
| `evidence/regression.txt` | full (non-figure) run of every scenario on r3 |
| `evidence/threads.tsv` | review threads at the time of verification (resolved, outdated, author, first line) |
