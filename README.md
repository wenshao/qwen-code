# PR #11251 — maintainer verification evidence

Head verified: `c7c95e492d771b3636e076deab4d762c3a2e1d9d` · base `1c193a9a3e3e09db6cd44ab60b4515f2220a6175`
Platform: macOS (Darwin 25.6.0), Node 24.18.1.

## Figures

| File | What it shows |
| --- | --- |
| `01-history-replay-silent.png` | Real UI: a fresh mount loading a persisted session whose turns already settled — transcript restored, `settled=0 · sessionChange=0` |
| `02-split-view-panes.png` | Real UI: Split View, two sessions, both panes silent on history load |
| `03-callback-payloads.png` | The payloads one embedding host actually received, `onAssistantTurnSettled` vs `onSessionChange`, for completed / cancelled / failed / replayed / split-view turns |
| `04-wire-ledger.png` | Proxy ledger for the two transport tests: terminal held + stream cut (reconnect catch-up), and the same terminal frame re-emitted twice (dedupe) |
| `05-mutation-matrix.png` | 20 mutations of the PR's new production code against the test files it touches — 10 killed, 10 survived |
| `06-r11-1-before-after.png` | R11-1 reproduced on this head and flipped by the suggested two-term guard |

## Rig

| File | Role |
| --- | --- |
| `fake-openai.mjs` | Controllable OpenAI-compatible model server; `POST /__ctl {"mode":…}` switches between `complete` / `hang` / `error` / `error400` / `empty` / `slow` so completed, cancelled and failed turns are deterministic |
| `sse-proxy.mjs` | Transparent proxy in front of the daemon. Logs every `turn_complete` / `turn_error` SSE frame; `POST /__px {"action":"holdTerminal"\|"dupTerminal"\|"cut"}` arms the transport tests |
| `host-main.tsx`, `host-vite.config.ts` | The embedding host. Imports `@qwen-code/web-shell` through the package `exports` map (workspace symlink → `dist/index.js`, the npm consumer path), registers `onAssistantTurnSettled` next to `onSessionChange`, and renders both event logs |
| `isolated-settings.json` | The isolated `QWEN_HOME` settings (fake provider pinned to the local model server) |
| `mutate.mjs` | The mutation matrix runner |
| `probe-r11251.test.tsx` | The R11-1 witness probe (not part of the PR) |

Daemon command:

```
QWEN_HOME=/var/tmp/pr11251/home PROBE_OPENAI_KEY=probe-key \
  node scripts/dev.js serve --port 4251 --workspace /var/tmp/pr11251/ws \
    --allow-origin http://127.0.0.1:5251 --initialize-timeout-ms 180000
```

## Raw output

| File | Contents |
| --- | --- |
| `wire.log` | Verbatim proxy ledger of the run |
| `mutation-matrix.txt` | Full mutation runner output, including per-mutation test summaries and the names of the tests that turned red |
| `macos-suite-head.txt` | macOS run of the changed workspace's full suite on the PR head, with the failing test names and their timeout reason |
