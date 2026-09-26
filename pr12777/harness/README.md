# PR 12777 verification harness

Builds (each by `pnpm install --frozen-lockfile`, whose prepare step builds `dist/`):
`~/git/qwen-code-pr12777` = PR head f6c5829942, `~/git/qwen-code-pr12777-base` = merge base d004e3ddf8 (main),
`~/git/qwen-code-pr12747-base` = 89b057befd (the validator before the compile cache). Ajv 8.20.0 in all three.
The merge commit 34ad20a750 has the same blobs as f6c5829942 for all four changed files.

| Script | What it checks | Output |
| --- | --- | --- |
| `run-arm.sh` + `mcp-schemas.mjs` + `fake-openai.mjs` + `seq.json` | headless `node dist/cli.js -p`, isolated home, real stdio MCP server with 8 tools, 15 scripted calls; debug log `[SchemaValidator]` lines | `cli-runs/*` |
| `run-seed.sh` (`make-cases.mjs`, `gen-cases.mjs`, `child.mjs`, `compare.mjs`) | generated schemas through each build's `packages/core/dist/src/utils/schemaValidator.js`; `register.mjs`/`hooks.mjs`/`logstub.mjs` capture the debug logger | `fuzz-out/*.gz`, `logs/summary.json` |
| `classify.mjs`, `pr-vs-pre.mjs`, `main-dev.mjs`, `summarize.mjs` | where the builds differ, by kind | `logs/summary.json` |
| `make-catch-probe.cjs` + `probe-stats.mjs` | what the new catch sees on the same inputs | `logs/catch-stats.txt` |
| `mutants.mjs` | 19 source mutants vs this PR's tests and the tests before it (`schemaValidator.pre12777.test.ts`), `--retry=0` and `--retry=2` | `logs/logs-mutants.txt` |
| `retry-inject.mjs` | one-off failure after each compile-cache test body, `--retry=2` | `logs/logs-retry.txt` |
| `run-tools-probe.sh` + `probe-tools.mjs` | `dist-probe` = `dist` with `globalThis.__svProbe?.(this)` spliced into the DeclarativeTool constructor; each constructed tool's schema judged by main's and the PR's exactness rule | `logs/tools-probe-*.json` |
| `run-wf.sh` + `fake-wf.mjs` + `wf-script.js`, `realm-probe.mjs` | workflow `agent({schema})` with an `$id` schema, 3 calls, invalid first submission (out of scope, same on main) | `cli-runs/workflow-*` |
| `cards/render.py` + `cards/*.txt` | the four evidence cards (PIL) | `../*.png` |
