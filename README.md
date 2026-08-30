# PR #10543 verification evidence

Screenshots from a local end-to-end verification of
[QwenLM/qwen-code#10543](https://github.com/QwenLM/qwen-code/pull/10543)
(`feat(config): let operators size or disable the Goal token budget`).

All shots come from real `qwen` runs (bundled from the PR head, `732085dc5b`)
driven against a local OpenAI-compatible mock that controls the
`usage.total_tokens` each call reports, so a real Goal budget stop is
reachable in seconds.

| file | what it shows |
| --- | --- |
| `01-value-matrix.png` | `model.goalTokenBudget` value matrix across real headless runs, plus a one-line-revert baseline |
| `02-tui-usage-limited.png` | interactive TUI: a Goal stops at the configured 5,000-token window; the reason quotes the configured number |
| `03-tui-resume-rearms.png` | `/goal resume` arms exactly one more configured window (9,000 -> 14,000) |
| `04-invalid-value-loudness.png` | invalid values: the sibling run budgets fail loud at startup, `goalTokenBudget` falls back silently |
| `05-settings-scopes.png` | the setting is honored from both operator scopes, workspace wins over user |
