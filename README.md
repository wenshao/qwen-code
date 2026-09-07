# Verification assets — PR #11269 (`fix(web-shell): gate todo spinner on live work`)

Evidence for the local verification of [QwenLM/qwen-code#11269](https://github.com/QwenLM/qwen-code/pull/11269).

Arms: `base` = `3dd860aafb` (the PR's merge base, #11267 head) · `head` = `c926de9df9` (the PR).

## screenshots/

| file | what it shows |
|---|---|
| `01-before-after.png` | The bug and the fix, side by side: a persisted `in_progress` Todo with nothing live. |
| `02-matrix.png` | All 8 live-work scenarios × both arms, real Chromium. |
| `03-real-daemon.png` | A real `qwen serve` turn, mid-turn and after settle, both arms. |
| `base-*.png` / `head-*.png` | The real-daemon captures at full size. |
| `raw/` | Every scenario's full-viewport capture, both arms. |

## data/

`matrix-{base,head}.json` — per-scenario verdicts from the Chromium matrix, including the
`Element.getAnimations()` readings used as ground truth.

`real-daemon-{base,head}.json` — the real-daemon run: the daemon's `live-state` samples once a
second, and the icon state sampled every 300ms across the whole turn.

## harness/

| file | what it is |
|---|---|
| `web-shell.todo-liveness.spec.ts` | The 8-scenario Playwright spec. Drop into `packages/web-shell/client/e2e/`, run with `TODO_LIVENESS_ARM=head TODO_LIVENESS_OUT=... npx playwright test`. |
| `mockDaemon-live-state-passthrough.patch` | Makes the E2E mock daemon's `live-state` route forward `activeWorkState`, matching the real route. Required by the spec above. |
| `TodoPanel.liveness-gate.test.tsx` | Suggested regression guard (3 cases). Passes on the PR; the middle case fails when `&& hasLiveActivity` is removed. |
| `fake-model.mjs`, `drive-one.mjs`, `run2.sh` | The real-daemon rig: scripted OpenAI-compatible model, the Playwright driver, and the orchestration. Needs `tools.todoWrite.enabled` in the daemon's settings. |
