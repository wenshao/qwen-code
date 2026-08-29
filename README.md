# PR #10040 — local verification evidence

Screenshots for the review comment on QwenLM/qwen-code#10040
(`refactor(sdk): break ACP route table cycle`).

| file | what it shows |
| --- | --- |
| `imgs/01-cycle-proof.png` | Node ESM loader-hook module graph, both arms + whole-package Tarjan scan |
| `imgs/02-fragility.png` | TDZ fragility experiment — what removing the cycle actually buys |
| `imgs/03-differential.png` | 43,641-case cross-arm differential + 4-mutant negative control |
| `imgs/04-wire-and-gates.png` | 554 real HTTP/SSE + WebSocket round trips, gate sweep, artifact deltas |
| `imgs/05-serve-mcp-bin.png` | qwen-serve-mcp duplicated-hashbang bug: before / after / negative control / gates |
