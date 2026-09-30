# PR #13097 Linux verification evidence

Head: `2a0ec676f460187879d382336d24b69d128e97d7` (merge-base `bf761080251c`).
Box: Linux aarch64, Node 24.14.0, Chromium 149.0.7827.0 (playwright chromium-1228), qwen-code 0.24.7 built from head.

## Method

Real stack: `dist/cli.js serve --web` daemon + real session (REST `POST /session`) + real
command submission through the browser composer (playwright). ONLY the read-only
`GET /session/:id/context-usage` HTTP responses were mocked (browser-level route
interception) with a synthetic 560-entry MCP catalog whose serialized JSON is
106,971 UTF-16 code units (> the 100,000 limit from issue #13096). A local
OpenAI-compatible SSE mock (`harness/mock-model.mjs`) provided a genuine slow
assistant stream for the read-only-during-streaming scenario.

Before captures: same rig, same daemon, with the 4 product files reverted to
merge-base and the web-shell client rebuilt (`before-*.png`).

## Files

- `before-context-detail-1200.png` / `before-context-detail-390.png`: broken
  pre-fix render — internal `web-shell:context-usage:v1:` prefix, escaped JSON,
  `[truncated]`.
- `after-context-detail-1200.png` (+`-tail`): fixed card, complete first/last
  entries and trailing categories at 1200x878.
- `after-context-detail-390-tail.png`: `/context -d` at 390x844, last entries.
- `after-context-summary-390.png` / `after-context-view-details-390.png`: plain
  `/context` summary then in-card "View details".
- `after-streaming-context-detail-1200.png` / `after-streaming-complete-1200.png`:
  `/context detail` fired mid-stream executes immediately (no command echo) while
  the assistant stream keeps advancing and completes.
- `{before,after}-report.json`: full per-check results (before: 4/12 with the
  expected broken-render failures; after: 22/22).
- `e2e-before-{390,1200}.png`: playwright failure captures from the new
  `web-shell.context-usage.spec.ts` regression run against merge-base product
  files (both widths fail pre-fix, pass at head).
- `pr13097-e2e*.log`, `vitest-*-summary.txt`: gate outputs.
- `harness/`: the rig itself (`drive.mjs`, `catalog.mjs`, `mock-model.mjs`).
