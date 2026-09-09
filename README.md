# PR #11411 — local runtime validation assets

Screenshots produced while runtime-verifying
[QwenLM/qwen-code#11411](https://github.com/QwenLM/qwen-code/pull/11411)
(`fix(permissions): cite matching deny rule for compound and virtual-op shell denials`,
head `f69d917cca`, merge-base `1919ff97f5`).

| file | what it shows |
| --- | --- |
| `imgs/pr11411-fig1-tui-before.png` | real interactive TUI on pre-PR `main` — both denials print the bare tool-scoped message |
| `imgs/pr11411-fig2-tui-after.png`  | same session on the PR head — rule cited, invocation-scoped wording |
| `imgs/pr11411-fig3-wire-ab.png`    | the exact tool-result strings the model receives, captured on the wire from a mock OpenAI server |
| `imgs/pr11411-fig4-parity-sweep.png` | 377-pair `evaluate()` vs `findMatchingDenyRule()` parity sweep, both arms |
| `imgs/pr11411-fig5-mutation.png`   | 6-mutant teeth check on the PR's new tests + counterfactual against pre-PR code |
| `imgs/pr11411-fig6-toolwide.png`   | measured tool-wide-vs-scoped classification of the new reassurance |
| `imgs/pr11411-fig7-acp.png`        | same A/B over `qwen --acp` (stdio JSON-RPC) — the path the PR body lists as out of scope is in fact covered |
