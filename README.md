# Verification assets for QwenLM/qwen-code#12360

Figures produced while verifying PR #12360 (`fix(core): Simplify system prompts and remove conflicting examples`)
at head `5b60dd70001225f53dc9255636f2f83d267135e4`, against merge base `eceaede18ea5c37404b79974c6d4833c12c23935`.

| file | what it shows |
| --- | --- |
| `imgs/fig1-ci-break.png` | `contextCommand.test.ts` green on the merge base, red on the PR head — the red CI job reproduced locally |
| `imgs/fig2-wire-default-headless.png` | What a default non-interactive session actually puts on the wire, before and after |
| `imgs/fig3-negative-control.png` | Reverting only `prompts.ts` flips the PR's new tests red |
| `imgs/fig4-tokens.png` | The PR's token table, recounted independently |
| `imgs/fig5-wire-matrix.png` | 60 paired runs of the real bundled CLI |
