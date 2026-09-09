# Local verification of #11485 — real build, real browser, real network faults

Verified at `d54fcd0f18` against merge-base `fbb877a48e`. Linux, Node 22.22.2, headless Chromium
(Playwright). Both arms were built from source; every browser result below comes from a real HTTP
origin serving the real built assets — **no CDP route interception, no mocks**, because route
interception is exactly what hides the failure mode this PR's last commit fixes.

## TL;DR

The mechanism is sound and I could not break it. What is left is a byte-budget decision, a doc
regression, a sequencing question, and one missing test.

| | |
| --- | --- |
| ✅ | The strip is **provably lossless** — extracted CSS is byte-identical (sha256) to what `injectCssModules` injects at runtime on the merge-base, measured **in the browser**, not just in the source. |
| ✅ | **Pixel-identical rendering** vs merge-base — 0 differing pixels, dark *and* light theme. |
| ✅ | **Fails closed** under every real failure I could stage: HTTP 404, connection reset, SRI mismatch, JS 404 — including on multi-megabyte exports. |
| ✅ | Packaging chain closed end-to-end, including both failure paths. The PR's own suites pass locally (6 + 76 + 158) and full CI is green on this head, `web-shell E2E Smoke` included. |
| 🔴 | The `<head>` latch (`c57203fc`) is **load-bearing** — I reproduced the exact bug it fixes on `3b63662b`, and **the PR's own new regression test passes without the fix**. |
| 🟠 | The byte ratchet no longer covers 56% of the render-blocking payload. Demonstrated, not argued: **+1 MB of CSS builds green here and fails the build on merge-base**. |
| 🟠 | The copy-pasteable delegation command in `docs/verification/export-renderer-delegation-mermaid/README.md` **now hard-throws**. Verified by running it. |
| 🟠 | The measured user-visible win is **~48 ms**, and it **disappears on a bandwidth-limited connection**. Total bytes are unchanged (−2,540). |

---

## 1. The extraction is lossless (issue raised in stage-2: "regex surgery on a minified artifact")

Three independent measurements, one hash:

```
sha256 e0e4a14164081338ff63621c15b46c31f9298f3fbe5808be2cbaf50c09cf3a8d   2,302,905 bytes
  ├─ JSON.parse of the `__qwenWebShellCss` literal in packages/web-shell/dist/transcript.js
  ├─ the runtime-injected <style data-qwen-web-shell="component"> textContent, read out of a live
  │  browser rendering an export built at the MERGE BASE (i.e. what readers get today)
  └─ export-transcript-document.css produced by this PR  (and dist/ after packaging)
```

The middle line is the one that matters: it is not a re-read of the same input, it is what Chromium
actually had in its stylesheet on `main`. And the CSS really left the JS: `__qwenWebShellCss`
is present in the merge-base bundle and absent at head, and so is `KaTeX_Main` — a token that can only
come from the stylesheet.

## 2. Render parity — 0 differing pixels

A transcript exercising headings, tables, fenced/highlighted code, inline + display KaTeX, mermaid,
task lists, blockquotes, a file-diff tool card and a shell tool card, rendered through the full
`/export html` path on both arms and screenshotted full-page:

![render parity](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr11485/render-parity.png)

`compare -metric AE` = **0** in dark theme and **0** after clicking *Light theme*. The output PNGs are
byte-identical. Condition B (cascade order behind the inline `<style>`) holds empirically, not just
by inspection.

## 3. The `<head>` latch is load-bearing — and untested

The approving review ruled on the mechanism and explicitly left open that the fix had *"never [been]
witnessed on a real multi-megabyte document"*. It has now.

**Repro:** serve the export and both assets from one real local origin; return a real `404` for the
stylesheet. On `3b63662b` (before `c57203fc`), on a large export, the `<link>` error is dispatched
while the parser is still blocked on it — before the `<body>` script registers its listener — so
nothing catches it and the renderer mounts anyway:

![fail-closed A/B](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr11485/fail-closed-ab.png)

Panel **B** is the bug: `data-render-complete="true"`, no alert, and `getComputedStyle('.katex')
.fontFamily === '"Times New Roman"'` — the component stylesheet never applied. Panel **C** is the same
document and the same 404 at this head.

| export size | fault | `3b63662b` (pre-latch) | `d54fcd0f` (head) |
| ---: | --- | --- | --- |
| 10 KB | CSS 404 / reset / SRI mismatch | closed | closed |
| 0.40 MB | CSS 404 | closed | closed |
| 1.20 MB | CSS 404 | closed | closed |
| 2.41 MB | CSS 404 | closed | closed |
| **3.21 MB** | CSS 404 | **UNSTYLED 3/3** | closed 3/3 |
| **4.0 MB** | CSS 404 | **UNSTYLED 3/3** | closed 3/3 |
| **4.0 MB** | connection reset | **UNSTYLED 3/3** | closed 3/3 |
| **4.0 MB** | SRI mismatch | **UNSTYLED 3/3** | closed 3/3 |
| **4.81 / 7.22 MB** | CSS 404 | **UNSTYLED 3/3** | closed 3/3 |
| any | JS 404 | closed | closed |

The threshold on this machine is between 2.4 MB and 3.2 MB of exported HTML. `EXPORT_TRANSCRIPT_LIMITS_V1`
allows a 32 MB envelope and 1,000 blocks, so this was comfortably reachable — and the SRI-mismatch row
means a corrupted or tampered CDN response would have rendered, unstyled, rather than failing closed.
The fix is correct and worth keeping.

**Two things follow from that.**

1. **The new regression test does not pin the fix.** I rebuilt the export template from `3b63662b`
   (pre-latch) and ran the PR's own case against it:
   `chat-transcript-document.test.ts -t "fails closed when the CDN stylesheet is unavailable"` → **1 passed**.
   The test uses `page.setContent` + `route.abort`, which resolves over CDP long after the document has
   parsed, so it can only ever exercise the slow path. Nothing in the suite would notice if the `<head>`
   latch were deleted tomorrow. A pinning test needs a real origin and a document large enough to make
   the parser yield; the harness on the assets branch is ~120 lines and does exactly this.
2. **The alternative fix suggested in triage would not have worked.** `link.sheet === null` was proposed
   as a simpler guard. Measured on a real 404: `link.sheet !== null` with `cssRules.length === 0`. The
   guard would not have fired. The latch is the right shape.

## 4. The byte ratchet — demonstrated, symmetrically

I padded the `__qwenWebShellCss` literal by exactly 1,000,004 bytes on both arms and rebuilt:

| | merge-base | this PR |
| --- | --- | --- |
| CSS +1 MB | ❌ build fails: `Document export runtime is 5142389 bytes; expected <= 4200000` | ✅ **build green**, `renderer JS is 1833944 bytes; component CSS … is 3302909 bytes` |

The `<link>` is in `<head>` and is render-blocking — I measured this too: stall the stylesheet 2.5 s and
`first-paint` moves to **2,544 ms** (nothing paints at all, not even the background). So a Tailwind scan
widening or a second KaTeX font format can add hundreds of KB to bytes the reader waits on, and every
build stays green. Adding a second constant pair for the CSS is ~4 lines; if the JS-only budget is the
deliberate call, it is worth making that call explicitly rather than inheriting it from the design doc.

Also worth noting for whoever re-ratchets next: the logged figure is taken **before** the renderer-version
placeholder substitution, so it is 3 bytes above the asset actually written (`1833944` logged vs `1833941`
on disk), and the ~3 KB inline document CSS that the merge-base counted is no longer in the budget at all.

## 5. Performance — honest numbers

Built sizes (my build; slightly above the PR body because `main` moved):

| | merge-base | this PR | Δ |
| --- | ---: | ---: | ---: |
| `export-transcript-document.js` | 4,139,386 | 1,833,941 | **−55.7 %** |
| `export-transcript-document.css` | — | 2,302,905 | new |
| total on disk | 4,139,386 | 4,136,846 | −2,540 |
| gzip −9, total | 1,538,709 | 1,536,599 | −2,110 |
| build headroom | 57,609 B under the 4,200,000 cap (and **over** the warning line) | JS 96,059 B under the new cap | — |

The merge-base build prints `Document export runtime exceeds the 4100000-byte warning threshold` today,
which corroborates the premise of #11478 independently of the author's numbers.

Time from navigation to `data-render-complete` (median, headless Chromium, local origin):

| scenario | merge-base | this PR | Δ |
| --- | ---: | ---: | ---: |
| small export, unthrottled (7 runs) | 383 ms | 335 ms | **−48 ms (−12.5 %)**, no run overlap |
| 900-block / 7.2 MB export, unthrottled (5 runs) | 1,609 ms | 1,561 ms | −48 ms (−3 %) |
| small export, 40 Mbps / 20 ms RTT (5 runs) | 1,193 ms | 1,185 ms | −8 ms |
| small export, 10 Mbps / 40 ms RTT (5 runs) | 3,591 ms | 3,585 ms | −6 ms |

So the PR body's framing is accurate — this is a JS parse/compile win — but the size of it is ~48 ms, it
is constant regardless of transcript size, and it is **noise once bandwidth is the bottleneck**, because
the same 4.1 MB still has to arrive and the stylesheet is render-blocking. One more thing the split does
*not* buy: both URLs derive from the same `exportTranscriptRendererVersion.split('+')[0]`, so every
release invalidates both assets together — there is no differential-caching benefit to bank on.

None of this argues against merging. It argues that #11478 condition F (base64 KaTeX fonts, Tailwind
utilities from components the transcript never imports) is where the reader-visible win actually is, and
that it should become a tracked follow-up rather than be closed out by this PR.

## 6. Documentation regression — confirmed by execution

The runbook whose whole purpose is this recipe still documents the two-knob contract at
`docs/verification/export-renderer-delegation-mermaid/README.md:106-107`. Run verbatim:

```
merge-base : Document export delegates its renderer to …@0.23.1-preview.0/… ✅
this PR    : Error: QWEN_EXPORT_RENDERER_CSS_INTEGRITY must be set together with the renderer
             delegation … ❌ exit 1
```

Adding the third knob works (`sha384-…` computed over the built CSS → build succeeds), so this is a doc
fix, not a code fix. `build.mjs:188-210` still says "Set both or neither"; `docs/users/features/commands.md:39`
still describes one pinned asset; `docs/verification/export-html-runtime-size/README.md` §6 still quotes
the `Document export runtime is N bytes` line this PR renames. All four are already reported — I am only
adding that one of them is an executable command that is now broken.

## 7. Packaging and release sequencing

Closed loop, verified live: `copy_bundle_assets` → `dist/export-transcript-document.css` byte-identical to
the built asset (same sha256) → `prepare-package` `verifyBundleArtifacts` hard-requires it (removing it
gives `Error: Required package artifact not found: …/dist/export-transcript-document.css`) → dist
`package.json` `files` carries it → standalone exclusion list carries it. The CSS-only-missing branch in
`copy_bundle_assets` names the missing file, as intended by `d54fcd0f`.

Live CDN check (this is a release-ordering note, not a defect):

```
https://unpkg.com/@qwen-code/qwen-code@0.23.2/export-transcript-document.js  → 200, 4,136,297 bytes
https://unpkg.com/@qwen-code/qwen-code@0.23.2/export-transcript-document.css → 404
npm dist-tag latest = 0.23.2
```

The 4,136,297 matches the PR body's "before" figure exactly. Since the exported URLs are built from the
repo version, no export from this branch renders until a version *after* 0.23.2 is published carrying both
assets — expected and disclosed, but it means this must not ship in a release where only part of the
bundle chain ran.

## Verdict

Technically I have nothing blocking. The extraction is lossless, rendering is pixel-identical, and the
fail-closed path is now genuinely airtight across the real failure modes — including the one the last
commit fixed, which I confirmed was a real, reachable bug rather than a theoretical one.

Before merge I would want:

1. **A test that pins the `<head>` latch.** Right now the fix's own regression test passes without the
   fix. Recipe and harness are on the assets branch.
2. **A decision on the CSS budget**, made explicitly. Four lines if the answer is "guard both".
3. **The delegation runbook command fixed** — it is copy-pasteable and it now fails.
4. **#11372 sequenced.** It is still open, still edits the same two constants in the opposite direction,
   and if this lands first its premise is gone.

And I would re-word the PR body's performance claim to match what is measurable: ~48 ms of parse/compile
on a fast link, nothing on a slow one, total bytes unchanged — with condition F tracked as the follow-up
that actually removes bytes.

<sub>Harness, full-resolution screenshots and raw probe output: https://github.com/wenshao/qwen-code/tree/assets-pr11485</sub>
