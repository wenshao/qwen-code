## Maintainer verification — real daemon + real browsers · head `083b476`

**Verdict: the paging works end to end against a real `qwen serve` daemon, in both Chromium and WebKit. I'd merge after one CSS line (finding 1).** The bar that is meant to hold a constant height still changes height when the walk ends, so the reader's row jumps 3.5 px on the last page. Finding 2 is a small keyboard/focus issue and I've included a validated patch for it. Findings 3 and 4 are nits.

`083b476` only changes `web-shell.trajectory.spec.ts` relative to `ec6c05f`. The production code is byte-identical, so the browser runs below (built at `ec6c05f`) apply to the current head unchanged. The e2e spec itself was run at `083b476`.

### How this was tested

- **Both arms built from source.** I built head and base (`8f86b4f`, the merge base) with `pnpm install` plus a full `build`/`bundle`.
- **Real daemon.** A real `qwen serve` from the head bundle, with an isolated `QWEN_HOME`, talked to a scripted OpenAI-compatible model. Every prompt ran real `read_file` tool calls, so the real core persisted the request/tool timing telemetry the panel folds.
- **Seeded sessions.** All sessions were seeded through the daemon's own HTTP API (`POST /session`, `/prompt`, SSE `turn_complete`):
  - **300 turns / 3,700 records** — 15 pages.
  - **45 turns / 555 records** — 3 pages.
  - **One session with a 100-tool-call turn** — uneven pages of 60 / 505 / 35 events.
  - **Two more 45-turn sessions** for the live-append and 409 cases.

  The daemon was restarted before any browsing, so the sessions were read cold.
- **Browsers.** Playwright **Chromium 1228** and **WebKit 2311**, driving the **production bundle the daemon serves**. There's no mock daemon and no `page.route`, apart from the single 500 injected in the retry case. The base arm is the same daemon binary with the base client swapped in.
- **Oracle.** The control is clicked for real with the mouse. A `requestAnimationFrame` sampler records where the anchor row is painted on **every frame** after the page lands, so a transient flash would show up, not just the settled position. Anchors were taken with the reader at the **top**, **middle** and **tail** of the table.

![Base vs head on the same real session](./fig1-base-vs-head.png)

### Results

| Check | Result |
| --- | --- |
| Wire contract (real daemon) | The panel's first read is `direction=backward&limit=250`, then `cursor=…&limit=250` with **no** `direction`, all 200. Walking all 15 pages with the same reads: contiguous, **0 overlap** against the JSONL, all 300 prompts covered |
| Anchoring, non-final pages — Chromium + WebKit, reader at top / middle / tail, 154- and 204-row prepends | **0 px** in every trial. `scrollTop` moved by exactly `rowsAdded × 34`. **0 frames** painted off-position |
| Last page of a walk (session start *or* capacity), reader mid-table | **−3.5 px** in both engines → finding 1 |
| Capacity | After 4 pages: "Earlier records are beyond the window this panel keeps.", 80 turns held |
| Walk to the session start | Totals `45 turns · 105 requests · 60 tools` = JSONL ground truth: 45 prompts; 150 `api_response` − 45 memory-extractor = 105; 60 `tool_call` |
| 500 on the first cursor read | Rows and `scrollTop` kept. "Try again" re-reads **the same cursor**; the newest page is read once in total. After recovery the anchor is back at its pre-click y (0 px) |
| Session appended mid-walk (6 turns between clicks) | Cursor stays valid and the walk completes; the newest page then shows the appended turns at the tail |
| JSONL rotated mid-walk (409) | Alert shows, rows kept, "Try again" repeats the 409; the header refresh recovers and paging resumes. This matches the documented limitation, not a new finding |
| Selection across a prepend | Kept by key; `aria-activedescendant` follows the renumbering (`row-77` → `row-231`) |
| Double-click on the control | 1 transcript read (the hook's in-flight guard holds) |
| Base A/B (same session) | Base shows 20 of 300 turns and an inert notice; head reaches the 4-page cap, and the whole of the 45-turn session |
| PR unit tests | trajectory + panel **96/96** (base 82/82), `ArtifactPanel` 95/95, `App -t trajectory` 3/3 |
| PR e2e (`web-shell.trajectory.spec.ts` @ `083b476`, local Chromium) | **18/18** (6 tests × 3 repeats). The same spec against base code: 4 pass, the **2 new ones fail** (no control) — so they discriminate |

![The prepend correction holds the reader](./fig2-anchor-holds.png)

![A failed read is retried at its own cursor](./fig4-retry.png)

### Findings

**1. The bar is not constant-height, so the last page moves the reader 3.5 px (should fix, one line).**

This is the property `3ea33ee` set out to guarantee ("at a constant `min-height`"). In a real layout the button is taller than the minimum:

- `.olderButton` computes to **24.5 px** in both engines: `line-height` 16.5 px (inherited 1.5 × 11 px, so it doesn't depend on the font) + 2 × 3 px padding + 2 × 1 px border.
- With the bar's 4 + 6 px padding (border-box), the bar is **34.5 px** while it holds the button, but only **31 px** (the `min-height`) once it holds either notice.

When the walk reaches the session start, or the capacity notice replaces the button, `.scroll` (`flex: 1`) grows by 3.5 px. The grid's top edge moves 135.5 → 132 and the reader's row rises **3.5 px**. It stays there on every frame after the page lands. The prepend correction itself is exact (`scrollTop` +1258 = 37 × 34).

Measured in Chromium and WebKit, on the production bundle and in dev, on three different sessions. At the tail the scroll clamp hides it (−0.5 px), which is why nothing in the PR sees it:

- the e2e anchors at the tail, on a non-final page;
- jsdom does no layout.

Suggested fix, validated:

```css
.olderBar {
  /* … */
  height: 35px; /* was: min-height: 31px — the button is 24.5px + 10px padding */
}
```

With it, the bar is 35 px in every state, the start and capacity transitions move the row **0 px** (Chromium), the PR's unit tests pass 96/96 and its two paging e2e tests pass. A fixed `height`, rather than a larger `min-height`, also survives a later font-size change on either child.

![The last page moves the reader 3.5 px; a fixed bar height removes it](./fig3-final-page-shift.png)

**2. Activating the control from the keyboard drops focus to `<body>` (a11y, recommended).**

The button is `disabled` while its page loads. Browsers blur a focused element that becomes disabled, so after Enter the focus lands on `<body>`, a second Enter does nothing, and a keyboard reader has to Tab back for every page. I measured this in Chromium and WebKit. The hook already refuses re-entry (`olderInFlightRef`), so the DOM `disabled` isn't what prevents a double load.

Suggested patch, validated:

```tsx
disabled={status === 'loading'}
aria-disabled={loadingOlder || undefined}
```

With it, focus stays on the button, a second Enter loads the next page, a double-click still issues one read, and unit tests pass 96/96. One residual case remains: when the button turns into a notice at the start or at capacity, focus still drops. Handing it to the grid would be a small follow-up.

**3. The e2e anchoring test can't see an over-correction (nit).**

The table opens at the tail and the test anchors there, so any extra upward shift is absorbed by the scroll clamp. I applied the correction **twice**: the jsdom test fails, but `keeps the reader on the same row…` **still passes**. Dropping the correction is caught by both. The jsdom test already pins the arithmetic. The browser test exists to catch browser-side interplay, such as native scroll anchoring adding its own shift, and that failure is exactly an over-correction. Scrolling the grid to the top or middle before the click, plus one last-page case, would make it catch both finding 1 and this.

**4. The description overstates what refresh does after a walk (nit).**

The Risk section says a reader who has paged back and then refreshes "returns to the tail". Measured: the numeric `scrollTop` is kept (clamped). From the top of a walk the reader lands at `scrollTop 0` of the rebuilt newest page (`Prompt #281` of 300), not at the tail, and turns that were just appended aren't visible until they scroll. Either scroll to the tail on refresh or reword the sentence.

### Not verified

- Real macOS/Safari and Windows. WebKit on Linux is the same engine as Safari, and finding 1 doesn't depend on the font.
- A page boundary inside a turn ("(continued)"). The real daemon kept every turn whole here: it extends a page up to 3 × limit, or shrinks it (60 events) rather than split a turn. So that fold path rests on the unit tests.
- The author's eight mutations individually. I ran my own: correction removed, correction doubled, and the fix arm.
- Re-fold cost at the 4-page cap on very large records.
- The `web-shell E2E Smoke` job on `083b476` was still pending when I wrote this.

Rig, harness scripts, raw measurements and logs: [`pr-12434/`](./)
