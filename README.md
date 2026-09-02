# Evidence — PR #10679 (workspace-scoped MCP management)

Local verification against a real `qwen serve` daemon (PR head `3b936af2d7`) and a real Chrome,
with an isolated `HOME`, two trusted git workspaces (`ws-a`, `ws-b`), stdio mock MCP servers
and a fake OpenAI-compatible provider.

| file | what it shows |
|---|---|
| `e1-before-after.png` | Same rig / same config, merge-base bundle vs PR-head bundle: workspace selector appears, and `requiresAuth` now reads "Needs authentication" instead of "Disconnected". |
| `e2-workspace-isolation.png` | The selector switching between `ws-a` and `ws-b`; each shows only its own workspace-scoped servers plus the shared user-scope server. |
| `e3-selector-and-detail-lock.png` | The workspace dropdown, and the server detail page where the workspace stays visible but the control is `disabled`. |
| `e4-cold-start-no-session.jpg` | Cold start: Plugins → MCP loads servers while both workspaces still report zero sessions. |
