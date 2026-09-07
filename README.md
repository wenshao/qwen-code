# PR #11246 verification assets

Screenshots from the local real-environment verification of
[QwenLM/qwen-code#11246](https://github.com/QwenLM/qwen-code/pull/11246)
(`feat(external-context): Add opt-in auto recall for administrator-owned Mem0 dialects`)
at head `c0fc7ce5fce0cb5791929d12f4dc6dd4574a3bf2`, on Linux.

| file | what it shows |
| --- | --- |
| `imgs/tui-ab.png` | Real TUI A/B: identical CLI and prompt, administrator Hook installed vs not installed |
| `imgs/flake-before-after.png` | `auto-recall.integration.test.ts` under identical CPU contention, test file at `529ac62` vs `c0fc7ce` |
| `imgs/flake-contention.png` | The pre-fix failure mode in detail (`spawnSync ETIMEDOUT` on the sanitizer tests) |
| `imgs/mcp-compat-matrix.png` | MCP registration matrix + the v2 special-file behaviour change (base accepts / PR rejects) |
| `imgs/arm-a-hook-installed.png` | Full terminal, Hook installed |
| `imgs/arm-b-no-hook.png` | Full terminal, Hook not installed |
