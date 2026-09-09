# Round 2 — re-verified at `328feb43f8`

Same rig as before: both arms built from source, browser results from a real local HTTP origin
(no CDP route interception). Merge-base is unchanged (`fbb877a48e`), so the round-1 numbers carry over
where I say so. **Everything below that says "measured" was run on this host.**

## First, a correction to my last report

I wrote: *"Nothing in the suite would notice if the `<head>` latch were deleted tomorrow."* **That was
wrong.** `scripts/tests/export-transcript-document-template.test.js` — added by the latch commit itself —
goes **6-red** when the template is reverted to the pre-latch shape:

```
latches stylesheet failures in <head>, ahead of the <link>        ×
nonces the latch script, because the CSP allows no inline script  ×
listens for error in the capture phase                            ×
only records the failure while the parser is still in <head>      ×
acts on the latch from the body script                            ×
compares the failing element id both listeners agree on           ×      Tests  6 failed (6)
```

What actually stands from round 1 is the narrower claim: the **browser** gate does not witness it — the
new `fails closed when the CDN stylesheet is unavailable` case still passes against a pre-latch build. So
my ask #1 was over-stated; the static lane is real coverage, and only the behavioural half is missing.

## The new commit does what its message says — checked by mutation, statically *and* in a browser

Assets are bit-identical to `d54fcd0f18` (`export-transcript-document.js` sha256 `d87a95d4…`, `.css`
`e0e4a141…`), so round-1's sizes, render parity and fail-closed matrix carry over unchanged. Re-run here
anyway: **241 tests green** (159 scripts + 76 cli + 6 browser gate), the 12-cell fail-closed matrix is
`closed` in every failure cell, and render parity vs merge-base is still **0 differing pixels** in both
themes.

**The id-contract test is well-aimed, and both listeners it pins are load-bearing.** I reproduced the
commit's own static result and then asked the question the static lane can't: does the drift it now
catches actually break anything?

| mutation | old test file (`d54fcd0f`) | new test file (`328feb43`) | browser, real origin |
| --- | --- | --- | --- |
| latch compares the wrong id | `5 passed` | `1 failed \| 5 passed` | 4.0 MB export + instant CSS 404 → **UNSTYLED** (small export still closed) |
| body listener compares the wrong id | `5 passed` | `1 failed \| 5 passed` | small export + 404 / slow-404 / SRI mismatch → **UNSTYLED**; 4.0 MB export + slow-404 → **UNSTYLED** |

So they cover **disjoint timing windows** — the latch catches a failure dispatched before the body script
exists, the body listener catches one dispatched after — and neither is redundant. Worth saying plainly:
this test is the only thing pinning either, and it earns its place.

**The corrected `build.mjs` comment is factually right.** Measured in the exported document: a `<style>`
created through the document's `createElement` shim is nonced and **applies** (`rgb(1,2,3)`); an identical
`<style>` created so the shim never sees it is **CSP-blocked** with
`Applying inline style violates ... 'style-src-elem 'nonce-…''`. The old comment's claim that the CSP
would block an un-stripped duplicate injection was wrong, and the correction is the accurate one.

**The design docs really are synced**, both languages: section 1 quotes the shipped
`TRANSCRIPT_CSS_ENTRY_FILTER` and names `transcript-css-entry.mjs`, section 2 describes the `<head>` latch
(position, nonce, capture phase, record-only, body-side consumption), section 3 names the module-level
render guard, and "Files affected" lists the three previously omitted files.

## Deferred findings — settled here, since the browser lane is out of budget on the author's host

The replies on this PR defer several findings because they need Playwright/Chromium and a build. I have
both, so I ran them. Each row is a mutation applied to the head tree, the suites re-run, and the mutant
opened in a real browser.

| finding | verdict | witness |
| --- | --- | --- |
| **R1-8** publish gate has no negative test | **already fixed** at head | deleting the `prepare-package.js` line reds `package asset scripts > fails packaging when the published stylesheet is missing` (`1 failed \| 35 passed`) |
| **R1-7** `<link>` nonce not element-scoped | **confirmed — and worse than stated** | deleting the `<link>`'s nonce leaves `html.test.ts` **3 passed** and the scripts lane **42 passed**; in a real browser the stylesheet is CSP-blocked and **every export renders the load-error page** |
| **R1-6** renderer gate confounded | **confirmed** | deleting `transcript-renderer` from the body listener leaves `fails closed when the CDN renderer is unavailable or fails integrity` **green**, while a renderer-only 404 (CSS served fine) yields a **completely blank page** — `data-render-complete` unset, no alert, 0 chars of body text |
| **R1-18** two `renderComplete` guards, one unpinned | **settled** | the **module-level** guard is the load-bearing one *and* is pinned (removing it → the new stylesheet case goes red; behaviourally it paints an unstyled transcript over the alert). The **rAF** guard is **dead code**: removing it keeps the gate at **6 passed** and the document still fails closed |
| **R1-13** cascade order unpinned | **confirmed, zero live impact** | putting the `<link>` before the inline `<style>` keeps every suite green (static 6, html 3, gate 6/6) and the render is **pixel-identical** (`compare -metric AE` = 0) |
| **R1-21** `sheetLoaded` oracle | **confirmed, with one correction** | with `integrity` in place: 404 → `sheet !== null`, 0 rules; connection reset → `sheet !== null`; but **empty and truncated read `sheet === null`**, because SRI blocks them. Only 404 and reset defeat the oracle, not "empty, truncated, 404" |
| **R1-5** release gate is JS-only | **confirmed** | `grep -rn export-transcript-document .github/workflows/` → 2 hits, both the JS fetch and its `cmp` in `release-vscode-companion.yml`; no `.css` anywhere |
| **R1-4** delegation unusable in this window | **confirmed** | unpkg: `.css` is 404 at `0.23.2`, `0.23.1` and `0.23.1-preview.0`; npm `latest` = `0.23.2`; the runbook's two-knob command still throws |

![mutation matrix](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr11485/mutation-matrix.png)

Panels 1 and 2 are the two mutations that ship with a fully green suite. Panel 3 is the one the new
stylesheet case does catch — note that it reaches `data-render-complete === 'error'` *and still shows the
transcript*, because React replaces `#app` after `showLoadError` wrote into it, so a check that only reads
the marker would pass while the reader sees an unstyled export.

## Unchanged from round 1

Sizes (`4,139,386` → `1,833,941` JS + `2,302,905` CSS; total −2,540 bytes; gzip −2,110), the byte-ratchet
counterfactual (+1 MB of CSS: **green** here, `Document export runtime is 5142389 bytes; expected <= 4200000`
on merge-base — re-run at this head, still green), and the render-blocking measurement (2.5 s stylesheet
stall → `first-paint` at 2,544 ms). Time-to-render re-measured at this head: **median 326 ms vs 383 ms on
merge-base**, i.e. −57 ms this round (−48 ms last round); still ~0 under 10 Mbps.

The four documentation gaps are unchanged at this head: the runbook's copy-pasteable delegation command
still throws (re-run just now), `build.mjs:200` still says "Set both or neither",
`docs/users/features/commands.md:39` still describes one pinned asset, and
`docs/verification/export-html-runtime-size/README.md` §6 still quotes the renamed log line.

## Updated verdict

The thing I flagged as most wanting before merge is now largely covered, and my framing of it was too
strong — I've corrected that above. What this round adds is that the new id test guards a genuinely
exploitable regression on both halves, which I'd call a good use of the round.

Revised pre-merge list, shortest version:

1. **R1-7 and R1-6** — I'd fold these in now rather than next round. Both are small test edits, and both
   have a measured blast radius that is worse than the finding text: one makes *every* export unopenable,
   the other silently drops the renderer branch's only witness. Neither needs a rewrite, just an
   element-scoped assertion and a `RENDERER_CSS_URL` fulfil in the existing route handler.
2. **The delegation runbook command** — it is executable and it is broken.
3. **The CSS budget** — decide it explicitly; ~4 lines if the answer is "guard both".
4. **#11372 sequencing** — still open, still opposite-direction on the same two constants.

R1-18's rAF guard is dead code on every path I could stage; R1-13 has no live impact today. Both are
follow-up material, not merge blockers. R1-8 can be closed as already fixed.

<sub>Harness, full-resolution screenshots and raw probe output: https://github.com/wenshao/qwen-code/tree/assets-pr11485</sub>
