# PR 12759 verification harness

Worktrees: `~/git/qwen-code-pr12759` (PR head 8cc4ad55d0), `~/git/qwen-code-pr12759-main` (9e60263fde),
`~/git/qwen-code-pr12747-base` (89b057befd, the validator before the compile cache). Each built by `pnpm install`.

| Script | What it checks | Log |
| --- | --- | --- |
| `dist-compare.py` | shipped `dist/` of main vs PR, modulo the commit stamp | `logs/dist-compare.log` |
| `mutants.mjs` | 11 source mutants vs the PR test file and the pre-PR test file | `logs/mutants.log` |
| `ajv-nokeep.probe.ts` | in-memory Ajv that drops an object whose compile threw (`AJV_NOKEEP=all\|dup`), imported first by copies of both test files | `logs/nokeep.log` |
| vitest `--retry` | C3 mutant and a one-off injected failure under `--retry=2` | `logs/retry.log` |
| `run-arm.sh` + `mcp-fail-id.mjs` + `fake-openai.mjs` | headless `node dist/cli.js -p`, real stdio MCP server, three builds | `cli-runs/*.log` |
| `s-pdir.mjs` + `lib.mjs` | real `managed-runtime-worker` (boot v2), `QWEN_CODE_PROJECT_DIR` per directory | `logs/pdir.log` |
| `consequence.mjs`, `c3-failing-rebuilt.mjs` | each mutant on the built core module: heap, parses, serializations, results | `logs/consequence.log`, `logs/c3-single-use.log` |
| `diff-results.mjs` | results of the built validator before the compile cache vs the PR head | `logs/diff-results.log` |
| `gen.py`, `render.sh` | evidence cards (HTML, headless Chrome, PIL crop) | `../*.png` |
