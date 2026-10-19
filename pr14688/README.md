# PR 14688 local verification evidence

Head `e70f2969799a9b9ad01af6161a156b58524b80a9`, base
`9006c59650250eb79758e53803a6db81fcd395f7`, macOS arm64 / Node v24.18.1,
2026-10-19 (Beijing time).

| File | What it shows |
| --- | --- |
| `01-head-e2e.png` | Real paired daemon on head: session created Managed, `write_file` executed, SIGKILL restart, `POST /session/:id/resume` 200, prompt 202, close 204 — 10/10 |
| `02-base-e2e.png` | The same harness on base: cold resume returns 409 `session_execution_engine_unavailable` — 7/7 with the expected refusal |
| `03-legacy-control.png` | A Legacy host still refuses the same Managed transcript on both trees (409) |
| `04-unit-ab.png` | `packages/cli/src/config/config.test.ts` full file: head 524/524, base 523/523 |
| `05-mutations.png` | Three mutation witnesses killed; `config.ts` restored byte-identical |