# PR #9070 local verification evidence

Verified 2026-09-07 on macOS 26.6.2 / Node 24.18.1, qwen-code 0.23.0.

- PR head: `e8fbdc9e5c70c23f3a4ae86e0abcc5a352df7d9b`
- `origin/main`: `7567824d4cd0bd23b0bf7a9cf18aab9424cc2dd7`
- merge tree tested: `e3414c7d812883ecfb5fb9c9c6e88c28b6b0ce03` (`git merge-tree` clean; diff vs main = the PR's 311+/18-)

## Layout

- `images/` — the three figures embedded in the PR report comment.
- `harness/` — the rig. `fake-openai.mjs` is a standalone OpenAI-compatible
  streaming server that scripts the leader and the teammate separately and
  logs every request body. `run-direct.mjs` drives stream-json *direct* mode
  (no SDK control system). `run-sdk.mjs` speaks the control protocol directly
  so the host failure mode is exact (`error` / never-answer / allow / deny).
  `mutate.py` + `run-mutants.sh` are the 9-mutant matrix. `mkfig.py` renders
  the figures, `crop.py` trims them.
- `evidence/` — per-scenario `tool-results.json` (what the blocked agent's
  model actually received, read off the provider wire) and `stderr.txt`,
  plus `ab-summary.json`, the mutation `summary.txt`, and `typecheck.log`.

## Reproducing

Build both trees (`npm run build && npm run bundle`), then:

    node harness/run-direct.mjs A <headTree>/dist/cli.js yolo out/D-A
    node harness/run-direct.mjs B <mainTree>/dist/cli.js yolo out/D-B
    node harness/run-sdk.mjs   A <headTree>/dist/cli.js error out/S-err-A
    node harness/run-sdk.mjs   A <headTree>/dist/cli.js timeout out/S-to-A
    SCRIPT_MODE=auq node harness/run-sdk.mjs A <headTree>/dist/cli.js auq out/AUQ-A

The teammate approval round is forced by a `PreToolUse` hook that returns
`permissionDecision: "ask"`; the rig writes it into an isolated `QWEN_HOME`.
