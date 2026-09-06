# Maintainer verification assets — PR #11094

Evidence for the verification comment on
[QwenLM/qwen-code#11094](https://github.com/QwenLM/qwen-code/pull/11094)
(`test(integration): deflake the /compress E2E event budget`).

Verified head: `4fa8cdf0d8` · merge-base: `1b604721b0` · date: 2026-09-06

Everything below was produced on one Linux machine with the bundled CLI
(`npm ci && npm run bundle`), `QWEN_SANDBOX=false`, `QWEN_E2E_RENDERER=ink`,
`VERBOSE=true`, `KEEP_OUTPUT=true`, against a live OpenAI-compatible endpoint.

## Figures

| File | What it shows |
| --- | --- |
| `fig1-ci-linux-failure.png` | The raw failure block from CI job `101275136893` (E2E Linux, sandbox:none, shard 2/3) of run `33954230547` — the run issue #11088 tracks. Both live cases of `context-compress-interactive.test.ts` fail at the `90000` `chat_compression` wait. |
| `fig2-ci-macos-failure.png` | The raw failure block from CI job `101275136939` (E2E macOS, shard 1/2) of the same run. `qwen-live-m4-acp-steering.test.ts` fails with `acp backend 'qwen-acp' did not initialize`, and the /compress suite passes only with `(retry x1)`, 234 s per test. |
| `fig3-failure-anatomy.png` | Timeline reconstructed from the raw Linux log: all six attempts, the 25 s seed wait expiring 9–25 s before the sentinel, and the compression spinner running 65–81 s and still going when the 90 s poll gave up. |
| `fig4-acp-failure-injection.png` | Failure injection on `acp-adaptor.ts`: `INIT_TIMEOUT_MS=10_000` + a 12 s handshake delay reproduces the macOS failure verbatim; `30_000` passes at both 12 s and 29 s. |
| `fig5-mutation-probes.png` | Mutation probes: the `INIT_TIMEOUT_MS` sweep, the `readTelemetryEvent` name-filter probe, and the live proof that `memory.enableManagedAutoMemory: false` reaches the spawned CLI. |
| `fig6-seed-budget.png` | Every seed-turn duration observable in run `33954230547`, against the PR's new 60 s budget. One of ten is 64 s. |
| `fig7-token-gate-samples.png` | All ten `chat_compression` events recorded locally, with the PR's new `tokens_before > tokens_after` gate evaluated on each. |
| `fig8-local-ab.png` | Local A/B of the suite: PR head vs its merge-base, back to back. |

## Evidence files

| File | What it is |
| --- | --- |
| `evidence/ci-linux-shard2of3-failure-tail.log` | 100-line slice of the raw job log around the failure (admin-gated; the autofix loop got HTTP 403 on it). |
| `evidence/ci-macos-shard1of2-failure-tail.log` | Same, for the macOS leg. |
| `evidence/ci-poll-timeout-census.txt` | Every `Poll timed out after N attempts` line in both job logs, with timestamps. `N≈122` = the 25 s seed wait (200 ms period); `N≈885` = the 90 s `chat_compression` wait (100 ms period). |
| `evidence/local-run-PR-1.txt` | Local run of the PR suite. |
| `evidence/local-run-BASE-1.txt` | Local run of the merge-base suite. |
| `evidence/local-run-PROBE.txt` | Three instrumented iterations that record every `chat_compression` pair without vitest retries masking a failed attempt. |
| `evidence/local-run-ACP-PR.txt` | The two qwen-live ACP E2E suites on PR head. |

## Reports

- `report-zh.md` — the full Chinese version of the PR comment.
