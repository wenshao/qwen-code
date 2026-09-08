# PR 10237 verification artifacts

See [report.md](report.md) for the English report with a folded Chinese translation. Tests and artifacts were produced on 2026-09-09. `environment.json` pins source versions and hashes. `assertions.json` counts composite behavioral checks; `verdict.txt` is `findings` because two existing nonblocking diagnostic/test-coverage observations are retained, despite all expected behavior checks passing.

The local environments are retained at `/tmp/qwen-pr10237-verify-20260909/{base,head,merge}`. These are disposable detached worktrees, with independent core package resolution. Run commands from a directory under that scratch root. The sibling `run-isolated.py` wrapper preserves only an explicit noncredential environment and applies `isolation.sb`. Do not run untrusted PR code using the maintainer's ordinary auth environment.

To rerun a runtime arm in the existing local environment:

```sh
/tmp/qwen-pr10237-verify-20260909/run-isolated.py node /tmp/qwen-pr10237-verify-20260909/artifacts/runtime-harness.mjs /tmp/qwen-pr10237-verify-20260909/head /tmp/qwen-pr10237-verify-20260909/artifacts/head-runtime head
/tmp/qwen-pr10237-verify-20260909/run-isolated.py node /tmp/qwen-pr10237-verify-20260909/artifacts/cross-process-harness.mjs /tmp/qwen-pr10237-verify-20260909/head /tmp/qwen-pr10237-verify-20260909/artifacts/head-cross-process head
```

Use the base tree and mode `base` for expected-broken controls; use the merge tree and mode `head` for current-main compatibility. Keep both harness scripts beside the output directories: the runtime idle-scan case launches the cross-process worker.

For the full CLI smoke, from the head tree:

```sh
/tmp/qwen-pr10237-verify-20260909/run-isolated.py node --import ./node_modules/tsx/dist/loader.mjs /tmp/qwen-pr10237-verify-20260909/artifacts/cli-smoke.mjs /tmp/qwen-pr10237-verify-20260909/head head
```

The driver binds a real localhost HTTP server and uses a dummy API key. It uses the repository `integration-tests/fake-openai-server.ts` for OpenAI protocol framing. The globally installed CLI version was copied unchanged to `global-qwen`; its binary identity is not used as the bug A/B base, only a compatibility smoke control.

For a fresh setup, fetch the exact public commits in `environment.json`, create the three worktrees, install dependencies with `QWEN_SKIP_PREPARE=1`, then build. The original exact-head path used `npm ci`, `npm run build`, `npm run bundle`, and `npm run typecheck`. Current-main merge core used its own lockfile install. Base reused APFS clones of the identical head dependency installation, including core-local dependencies; copying only root node_modules is insufficient. Internal `@qwen-code/qwen-code-core` links must resolve to each arm's own `packages/core`.

`mutation-matrix.py` temporarily changes one production expression in the head source, runs the focused suite, and restores exact original file bytes in `finally`; run it only when no other build/source test is active there. `lint-control.py` similarly inserts and removes an unused binding. `verify-results.mjs` rechecks recorded outputs and writes `assertions.json`.

Raw HTTP fixture requests contain public built-in prompts and synthetic test data. No real credentials are used or included. `evidence/*.png` are terminal-output renders created by the repository's `scripts/verify-capture.mjs`, with original logs beside them.
