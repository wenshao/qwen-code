# PR #12267 round 6 harness (head 05f6d76332)

Arms: `pr12267-r6` = 479027b0a7 (previous head), `pr12267-r7` = 05f6d76332 (this head), `pr12267-r7fix` = r7 bundle with `dist/sandboxBwrapRelay.js` patched per `out/relay-patch.ts.diff`.
Each arm: `pnpm install --frozen-lockfile`, `npm run build`, `npm run bundle`. `q.sh <arm> <policy> ...` runs the bundled CLI with an isolated `QWEN_HOME`.

- `stdin-matrix.sh`, `epipe-matrix.sh`: R5-1 / R5-2 closure matrices
- `fd-escape.sh`, `nobody-escape.sh`: R6-1 (redirected stdin handed to the payload as the host descriptor)
- `tool-path.sh` + `fake-model.js`: scripted-model run_shell_command check, prompt piped on the CLI's stdin
- `mut/mutate.py`: 18 hand mutants over the delta commit's changed lines
- `fig/`: figure scripts (xterm.js render); `ns.sh` runs a command in a private mount namespace with an overlay bwrap
