# PR #11959 real-environment verification evidence

Head `f5ba51ff2c`, base = merge-base `1dbb3786ea`, cand = head + `candidate.patch`.
Every run drives a real bundled `dist/cli.js` with an isolated `QWEN_HOME`.

| file | what |
| --- | --- |
| `01-context-window.png` | `/context -d` window per model, base / PR / PR with `QWEN_CODE_MODELS_DEV=off` |
| `02-dashscope-real-endpoint.png` | real CLI against a real DashScope endpoint, base vs PR |
| `03-output-max-tokens.png` | `max_tokens` on the wire (fake OpenAI server ledger), base / PR / cand |
| `04-refresh-lifecycle.png` | six CLI starts sharing one `QWEN_HOME` against a local mirror of the real `api.json` |
| `05-project-env.png` | a repository `.env` sets `QWEN_CODE_MODELS_DEV_URL`, PR vs cand |
| `candidate.patch` | the 3-part candidate fix exercised as `cand` |
| `evidence/` | raw text outputs, per-id catalog on/off dump, direct endpoint probes, real-CLI run summaries |
| `rig/` | the scripts (copy `rig/` into a worktree as `pr11959-rig/`; they import `integration-tests/fake-openai-server.ts` and `integration-tests/terminal-capture`) |

Endpoint URLs and key names are replaced with `${DASHSCOPE_BASE_URL}` / `DASHSCOPE_KEY`;
scratch paths with `${SCRATCH}`. `evidence/modelsdev` is not included: fetch
`https://models.dev/api.json` (served ETag `"b13b0ae61edc53ce8123a1c96eff376e"` on 2026-09-26).
