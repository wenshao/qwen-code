# PR 12475 verification harness

- `fake-dingtalk.mjs` — DingTalk OpenAPI (https :443) + Stream gateway (ws :28080) + control port :28081.
  Needs `certs/{leaf.key,leaf.crt,ca.crt}` (self-signed CA; leaf SAN `api.dingtalk.com`, `oapi.dingtalk.com`),
  `/etc/hosts` entries for both hosts → 127.0.0.1, and `NODE_EXTRA_CA_CERTS=certs/ca.crt` for the daemon.
- `fake-openai.mjs` — scripted OpenAI-compatible model on :28090; answers `ANSWER <token>` for the last `T-…`
  token in the last user turn; a `TOOL-TOUCH` marker makes it request `run_shell_command`.
- `fake-github.mjs` — minimal GitHub REST API on :28190 (`/__inject` adds a comment + unread notification).
- `run-dingtalk.mjs [S-ids] [arms]`, `run-github.mjs [arms] [G-ids]` — one fresh `qwen serve --channel …` per
  scenario and arm; results JSON under `data/`.
- `mut/run.py` — mutation runner (hardlinked copy of the worktree; every mutated file is a new inode).
- `webshell-editor-save.cjs` — Playwright script: edit Instructions, Save, Start in the real Web Shell.
- `render.cjs` — renders the figures.
