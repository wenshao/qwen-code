<!-- qwen:serve-ab -->
### 🩺 serve daemon A/B
Built the PR base vs this PR head `e0cc5b6`, drove a fixed endpoint set against each, and diffed the JSON responses. Only fields that changed are shown.

#### `health-deep-with-session`

| field | PR base (before) | this PR (after) |
| --- | --- | --- |
| `activeWorkStaleMs` | `3` | `4` |

— _Qwen Code · serve A/B_
