# PR 6534 verification screenshots

Terminal captures from local end-to-end verification of
[QwenLM/qwen-code#6534](https://github.com/QwenLM/qwen-code/pull/6534).

## First review (head `014bfe9`)

| file | what it shows |
| --- | --- |
| `1-base-bug.png` | main @ 6e4807753: disabled extension, skills still reported `ok` |
| `2-pr-fixed.png` | PR 6534: same flow, skills reported `disabled` |
| `3-pr-preheat.png` | PR 6534: cold ACP channel recovered by preheat, 0 sessions created |
| `4-pr-notoken-401.png` | PR 6534: `POST /workspace/acp/preheat` 401s on a default (no-token) daemon |

## Re-verification of the updated head (`dc20512`)

| file | what it shows |
| --- | --- |
| `5-v2-notoken-fixed.png` | preheat now returns 200 unauthenticated; timeout path leaks no ACP children |
| `6-v2-cycle.png` | disable → re-enable round-trip on a live ACP session |
| `7-v2-fixed.png` | updated head: disabled extension, skills reported `disabled` |
