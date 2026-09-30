# PR #13081 Linux verification evidence (head `529311dc8a`)

Real-stack verification of `feat(web-shell): add a collapsible trajectory waterfall`
on Linux (Debian, arm64, Node 24, Chromium 1228 via Playwright 1.61.1).

## What was run

| Layer | Result |
| --- | --- |
| `corepack pnpm install --frozen-lockfile` | OK |
| `npm run build` (full repo) | OK |
| web-shell `typecheck` / `lint` / `format:check` | OK / OK / OK |
| Focused trajectory unit suites (13 files) | 265/265 passed |
| Full web-shell unit suite (399 files) | 10445/10446; 1 pre-existing failure (see below) |
| Trajectory Chromium e2e at PR head | 35/35 passed |
| Trajectory Chromium e2e at merge-base `c0ebf08dfd` | 32/32 passed (PR's "baseline 32" claim) |
| Real-stack browser checks (this rig) | 23/23 passed |

The one full-suite failure is `BranchPickerPopover › remotes view › resets the
remotes view and restores no focus after a workspace switch`. It reproduces
byte-identically with the merge-base versions of every PR-touched file
(including `i18n.tsx`), so it is a pre-existing Linux failure unrelated to this
PR, which does not touch the branch picker.

## Real-stack rig

The PR lists "real daemon sessions" as not validated; this rig covers it.

- Real daemon: `qwen serve --web --port 13081 --workspace /root/rig13081/workspace`
  from a pnpm build of PR head `529311dc8a`, isolated `HOME=/root/rig13081/home`,
  `tools.approvalMode=yolo` (isolated throwaway workspace).
- Only the model is stubbed: `harness/mock-model.mjs` is an OpenAI-compatible
  SSE endpoint that returns `read_file` tool calls (two parallel calls on
  turn 4) with per-turn latency, then a final text answer.
- `harness/drive.mjs` (Playwright) drove 5 turns through the real browser
  composer, then exercised the trajectory panel against REAL transcript
  replay: the daemon's paged transcript route carried 20 request + 12 tool
  `ui_telemetry` timing frames (`reports/transcript-timing.json`).
- Checks (`reports/report-after.json`, 23/23 PASS): waterfall cells/bars from
  real timing; overview and waterfall share the time domain through wheel
  zoom, active/real-time mode switches and reset; fold turn (aria-rowcount
  41→35, collapsed-count badge, full-window metrics unchanged, expand
  restores); inspector pinned to parallel tool `call_4_b` keeps identical
  input JSON across fold-all, "Expand and locate" reveals it (5→14 rows);
  overview span click expands folded ancestors and reveals a hidden record;
  keyboard Home/End/Arrow navigation names mounted rows; 480px and 320px
  panels hide the waterfall while folding/selection survive; 1600×600 window
  keeps inspector content and clipboard copy reachable.
- Before/after on the SAME session: with merge-base `c0ebf08dfd` product
  files (`reports/report-before.json`), the same 41 rows / 26 overview spans /
  identical metrics rendered with zero waterfall cells, zero bars and zero
  fold buttons.
- Real-session nuance: the session's `managed-auto-memory-extractor` subagent
  records render with "Parent call not located", exercising the PR's
  ambiguous-parent fallback on genuine data.

## Files

- `shots/` — 11 Playwright screenshots (before/after wide 960px panel, fold,
  inspector-folded, expand-and-locate, overview reveal, zoom, clock mode,
  480/320px narrow, 1600×600 short window, chat after turn generation).
- `reports/` — machine-readable check results + real transcript timing sample.
- `harness/` — the driver, mock model and settings, for reproduction.
