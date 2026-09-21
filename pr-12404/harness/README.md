# PR 12404 harness

Real `qwen serve` + the daemon's Web Shell in Chromium (Playwright), mock OpenAI provider.

- `env.sh`: ports, token, workspace (`ws/demo-app`: git repo with `README.md` and a long-named `src/*.ts`, `.qwen/settings.json` registers the `mcp/o2-docs.cjs` stdio server).
- `setup-home.sh`: isolated HOME, trusted workspace, links `ext-src/browser-kit`.
- `start-daemon.sh <pr|base|fix>`: runs `<worktree>/.arm-<arm>/cli.js serve` (a full `dist/` copy per build); `RT=<dir>` selects the runtime dir.
- `s1.mjs` core A/B (compose with the real @ picker → live → refresh → restart → file preview); `s2-attach.mjs` tags + text/image attachment; `s3-edge.mjs` offset edge cases; `s4-cross.mjs` cross-build history; `s5-*.mjs` raw-HTTP malformed / oversized annotations; `s6-edit.mjs` edit after restart; `s7-queued.mjs` server-queued prompt; `mutate.py` unit-test mutants; `fig-*.mjs` + `compose*.py` figures.
