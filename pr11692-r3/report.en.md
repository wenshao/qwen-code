## Round 3 verification — Linux, the live Token Plan endpoint, and the settings write paths

A scoped addendum to [round 1](https://github.com/QwenLM/qwen-code/pull/11692#issuecomment-5650585151) and [round 2](https://github.com/QwenLM/qwen-code/pull/11692#issuecomment-5653625721). The head is still `2176e5a`, so this round does not repeat their matrix. It covers what they could not: a **real DashScope endpoint** (both earlier rounds had no key and used a fake upstream), **Linux** (both ran on macOS), and the **three ways to write `timeoutMs` other than editing settings.json by hand**.

**Verdict: still merge-ready. Nothing blocking.** On the live endpoint the budget change does what the PR says. One suggestion is worth taking in this PR because the field now shows up in `/settings`: declare its bounds. Right now every out-of-contract value is saved without complaint and then silently replaced by the default. The two-line fix is verified below.

### Setup

- **Two arms from one worktree.** The PR head `2176e5a` and its merge base `bc7a186` differ only in the PR's 9 files. For base I checked those files out at `bc7a186`, rebuilt core, bundled, then restored them. Rebundling the PR afterwards gave a byte-identical `cli.js`. I confirmed each arm by grepping its bundle: the PR bundle contains the salvage label, `WEB_SEARCH_TIMEOUT_MS`, `12e4` and `6e5`; the base bundle has only the fixed `6e4`.
- **Runtime.** Every run used the real bundled CLI (`node dist/cli.js`) with an isolated `HOME`, on Linux x86_64 with Node 22.22.2.
- **Live runs** follow the PR's own end-to-end plan:
  - the only `modelProviders` entry is a ModelStudio Token Plan entry (`token-plan.cn-beijing.maas.aliyuncs.com`, `BAILIAN_TOKEN_PLAN_API_KEY`)
  - nothing under `tools.webSearch`
  - `qwen3.8-flash`, the same prompt, `--approval-mode yolo --output-format stream-json`

  What the model received is read from the session transcript's `functionResponse`.
- **Deterministic rows** use a fake DashScope reached over real TLS at `https://dashscope.aliyuncs.com/compatible-mode/v1`, through a local CONNECT proxy passed with `--proxy`. The fake chat model records the exact tool result it is handed.

### Test plan on Linux

| Step | Result |
| --- | --- |
| `packages/core`: `web-search.test.ts` + `config.test.ts` | **869 passed** |
| `packages/cli`: `config.test.ts` + `settingsSchema.test.ts` + `settingsUtils.test.ts` | **564 passed** |
| `npm run generate:settings-schema` | **no diff** |

### Live Token Plan — 2026-09-13, 15:40–15:53 UTC, base and PR lanes run at the same time

| Arm | Budget | Run 1 | Run 2 | Run 3 | Run 4 |
| --- | --- | --- | --- | --- | --- |
| base `bc7a186` | fixed 60 s | `18.5s` | **`60.0s (partial result)`** | `10.2s` | `31.4s` |
| PR `2176e5a` | default 120 s | `48.7s` (2 searches) | **`69.7s`** (2 searches) | `10.7s` | `49.9s` |
| PR `2176e5a` | `WEB_SEARCH_TIMEOUT_MS=15000` | `15.0s (partial result)` | `15.0s (partial result)` | | |

- **One run per arm crossed 60 seconds.** Base's was cut off. The PR's ran to 69.7 s and returned a normal result. The sample is small (4 runs per arm) but consistent with the author's 13–107 s.
- **The base cut-off is the #11687 defect, reproduced live.** The model got 8,056 characters, and their 6,520-character answer section is extractor output with no label (bottom panel of the second figure).
- **Both 15-second runs were cut before any page read arrived.** They exercised the partial path but not the label. The label is covered by the deterministic rows below and by round 1.
- **Page lists:** 130 bullets across the 10 headless live runs; 129 are bare URLs. The exception is Observation 3.

![PR build against the live Token Plan endpoint, default budget](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr11692/pr11692-r3/01-live-token-plan-tui.png)

### New deterministic rows

| # | Arm | Upstream / configuration | Display line | Tool result handed to the model |
| --- | --- | --- | --- | --- |
| N1 | base | stream **completes**, no narration item, 13,145-char page | `Did 1 search in 0.0s` | 14,275 chars — the whole page, unlabeled |
| N2 | **PR** | same bytes | `Did 1 search in 0.0s` | **7,330** — label + exactly 6,000, no partial marker |
| N3 | base | search finishes at 70 s | `Did 1 search in 60.0s (partial result)` | 1,125 — narration lost; upstream closed at 59,998 ms |
| N4 | **PR** | same | `Did 1 search in 70.0s` | 1,269 — the complete result with narration |
| N5 | **PR** | setting `30000` + env `700000` | `Did 1 search in 120.0s (partial result)` | the env override shadows a valid setting, then falls back to the default |
| N6 | **PR** | settings.json `"timeoutMs": "90000"` (a string) | `Did 1 search in 120.0s (partial result)` | ignored with no startup warning |
| N7 | **PR** | a surrogate pair straddling the 6,000 cut | `Did 1 search in 3.0s (partial result)` | the cut backs off to 5,999; no lone surrogate reaches the next request |
| N8 | **PR** | `WEB_SEARCH_TIMEOUT_MS=40`, silent upstream | `Web search timed out after 0s.` | see Observation 1 |

- **N3/N4 is the forward form of test plan step 1.** A search that needs 70 s lost its narration on `main`; on the PR it completes.
- **N1/N2 settles triage suggestion 2 empirically.** The bound and the label also apply to a search that completed without narration. The docs sentence is accurate as written; only the PR body's "cut off" wording is narrower than the code.

![What the model receives when the narrated answer never arrives](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr11692/pr11692-r3/02-model-payload-without-narration.png)

### Suggestion — declare the bounds (triage suggestion 3, still open)

`tools.webSearch.timeoutMs` is `showInDialog: true`, `type: 'number'`, and declares no `minimum` or `maximum`. The runtime contract lives only in `resolveWebSearchTimeoutMs`: a positive integer up to 600000, otherwise the default. `validateSettingValue` cannot see that contract, and it is the check all three write paths call: `/settings`, `/config key=value`, and the daemon's workspace-settings route.

| Value | `/settings` or `/config` on the PR head | Same tree + `minimum: 1, maximum: 600000` |
| --- | --- | --- |
| `700000` | saved | **rejected** — `Value must be <= 600000` |
| `-5` | saved | **rejected** |
| `0` | saved | **rejected** |
| `1.5` | saved | still saved (the type is `number`) |
| `90000` | saved | saved |

- **What a user sees.** Every value in the first four rows is thrown away at runtime. With `700000` saved from the dialog and the CLI restarted, the next search ends at `120.0s (partial result)`; the upstream was closed at 119,981 ms. The user asked for a longer budget and got the default without being told.
- **The fix.** The two-line change was built and exercised through the real `/settings` dialog and headless `/config`, and rejects `700000`, `-5` and `0` at write time.
- **Not suggested.** `1.5` still gets through. `type: 'integer'` would cover it, but `SettingsDialog` only has an edit path for `number`, so I am not suggesting that untested.
- **The daemon route** (`serve/routes/workspace-settings.ts`, both `validateSettingValue` call sites) was checked by reading only, not driven.

![Out-of-contract values are saved, then silently replaced](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr11692/pr11692-r3/03-settings-bounds.png)

### Observations — no action needed for this PR

1. **`formatBudget` rounds to `0s` below 50 ms.** Its comment says "never rounded to zero", but N8 shows `Web search timed out after 0s.`. Cosmetic: nobody sets a 40 ms budget on purpose.
2. **An out-of-range env var shadows a valid setting (N5).** The CLI checks only that `WEB_SEARCH_TIMEOUT_MS` is positive. So `700000` in the env overrides a valid `tools.webSearch.timeoutMs: 30000`, and core then uses the 120 s default rather than the 30 s the user wrote. This matches "other values fall back to the default".
3. **Garbage candidate URL from upstream, pre-existing.** One live candidate bullet was `- https://<b>github</b>.com/<b>Qwe`: search-highlight markup, truncated. It passes the new bare-URL test (`^- https?://\S+$`), and the citation policy would let the model cite it. This PR doesn't change the candidate-list code; a hostname check before listing would be a follow-up.
4. **Burst input reverses digits in the dialog, pre-existing.** It affects every editable `/settings` field. When several keys arrive in one read (non-bracketed paste, automation), each is inserted at the same stale cursor position. On base, typing `123` into `Cleanup Period (days)` saved `321`; on this PR, `45000` saved `54`. Bracketed paste and normal typing are fine. For this field a reversed `120000` would be saved as `21`, a valid 21 ms budget. Worth a separate issue.
5. **"Raw page content" slightly overstates it (wording).** Live `web_extractor` output is a goal-directed extraction ("The useful information in <url> for user goal … Evidence in page: … Summary: …"), not the page itself. The part of the label that matters — the narrated answer did not arrive — is accurate.

### Not verified

- Windows. This round ran on Linux; rounds 1–2 were macOS.
- The daemon's workspace-settings write path: read, not driven.
- Live latency beyond 4 runs per arm.
