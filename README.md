# Assets for PR #11692 verification

Screenshots from a local verification of
[QwenLM/qwen-code#11692](https://github.com/QwenLM/qwen-code/pull/11692)
(`feat(core): make the web_search budget configurable and bound the extractor
fallback`).

Two independently built arms — `main` @ `d47fa02` and the PR head @ `d34bf8a` —
each run as the real bundled CLI (`dist/cli.js`) against a fake DashScope
Responses endpoint reached over real TLS at
`https://dashscope.aliyuncs.com/compatible-mode/v1` through a local MITM proxy
passed to the CLI with `--proxy`. Nothing in the product is stubbed: the gate,
the OpenAI SDK client, the abort signals and the SSE parsing are the shipped
code paths. The terminal frames are real TUI sessions driven through a pty by
the repo's own `integration-tests/terminal-capture` harness (xterm.js +
Playwright).

| File | What it shows |
| --- | --- |
| `pr11692/01-default-budget-tui.png` | Same hanging upstream, each tree's default budget: `60.0s` on `main`, `120.0s` on the PR. |
| `pr11692/02-model-payload-before-after.png` | The `web_search` tool result captured off the wire on the next model request: 13,197 unlabeled characters of page text before, 6,131 (130-char label + 6,000 characters) after. |
| `pr11692/03-outer-tool-cap-interaction.png` | With `QWEN_CODE_TOOL_EXECUTION_TIMEOUT_MS=90000`: `main` self-limits at 60s and returns a partial result; the PR hits the outer cap at 90s and the searched evidence is discarded. |
| `pr11692/04-cancellation-preempts-budget.png` | Esc during a search still ends the turn immediately under the doubled budget. |

## Round 2 — re-verification after `8de3eeef23`

The PR head moved to `2176e5ad7b` (a docs-only commit plus another merge of
`main`). The production code this PR touches is byte-identical to round 1, so
round 2 rebuilt both arms — PR head `2176e5ad7b` and its new base
`bc7a186cda` — and re-ran the whole matrix plus the mutation set.

| File | What it shows |
| --- | --- |
| `pr11692-r2/01-documented-precedence-both-directions.png` | The sentence the docs now state, checked both ways: a cap above the budget lets the partial result survive; a cap below it discards the partial result. |
| `pr11692-r2/02-settings-dialog-truncation.png` | The same sentence never reaches the `/settings` dialog, which truncates a setting's description to one line. |

## Round 3 — Linux, live Token Plan, settings write paths

Head unchanged at `2176e5ad7b`. PR head and merge base `bc7a186cda` built in one
worktree, run as the real bundled CLI on Linux x86_64. Live rows use the PR's own
end-to-end plan against the real Token Plan endpoint; deterministic rows use a
fake DashScope over real TLS through a local CONNECT proxy (`--proxy`). Terminal
frames are tmux captures rendered to PNG. Full report: `pr11692-r3/report.en.md`
(English) and `pr11692-r3/report.zh.md` (中文).

| File | What it shows |
| --- | --- |
| `pr11692-r3/01-live-token-plan-tui.png` | The PR build against the live Token Plan endpoint with nothing under `tools.webSearch`: a real search completes (`Did 2 searches in 49.8s`). |
| `pr11692-r3/02-model-payload-without-narration.png` | What the model receives when no narration arrives: a completed search on base (14,275 chars, unlabeled) vs the PR (label + exactly 6,000), and a live base run that hit the 60 s wall. |
| `pr11692-r3/03-settings-bounds.png` | `/settings` saves `700000` on the PR head and the next search silently runs on the 120 s default; the same tree with `minimum: 1, maximum: 600000` rejects the value. |

## Round 4 — `6645d558ad`: bounds, qualified wording, new tests

Head moved `2176e5ad7b` → `6645d558ad` (three commits, no new merge of `main`). Built in the same
worktree, run as the real bundled CLI on Linux; the daemon write routes were driven against a real
`qwen serve` on both heads. Full report: `pr11692-r4/report.en.md` (English) and
`pr11692-r4/report.zh.md` (中文).

| File | What it shows |
| --- | --- |
| `pr11692-r4/01-settings-bounds-before-after.png` | `/settings` on the round-3 head saves `700000`; on `6645d558ad` the same input is rejected and `settings.json` is unchanged, while `90000` is accepted. |
