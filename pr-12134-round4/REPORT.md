## Maintainer verification, round 4: real daemon + production bundle at `2a74ac5a` (delta only)

Earlier rounds: [R1, real daemon, `8cac35c`](https://github.com/QwenLM/qwen-code/pull/12134#issuecomment-5762945477) · [sandbox, `f523b8e`](https://github.com/QwenLM/qwen-code/pull/12134#issuecomment-5769601038) · [R3, F1 re-measured, `e433da2`](https://github.com/QwenLM/qwen-code/pull/12134#issuecomment-5831128856) · [sandbox, `e433da2`](https://github.com/QwenLM/qwen-code/pull/12134#issuecomment-5830813149). This round covers only what those left open.

**Shape decision: (a), the strip.** @holny, thanks for waiting on this. Keep the pinned strip as implemented, expanded by default, with the collapse toggle. I'm not asking for the cockpit rework.

**Verdict: mergeable after one 13-line patch plus one e2e spec (both below, both tested).** The F1 compensation is correct in a production build against a real daemon. Two gaps remain, and one patch closes both:

- **G3.** When the plan completes, the strip unmounts and a scrolled-up reader's text jumps up by the strip's last height (64.19 px in the 7-step run).
- **G1.** In dev builds only, React StrictMode runs the mount compensation twice, and the text jumps 175 px the wrong way.

The spec closes F2/G2: until now nothing in CI would notice the strip disappearing from `App` or the compensation being deleted.

![Reading-position movement per arm](fig1-reading-shift.png)

### 1. What this round measured that earlier rounds did not

**Rig.** I merged PR head `2a74ac5a` into current `main` `d5a157c45e`. The merge is conflict-free, and its diff against main is exactly the 6 PR files (+548/−0). I ran it as a real `qwen serve` daemon serving the production Web Shell bundle, with `tools.todoWrite.enabled`. A scripted OpenAI-compatible model issues real `todo_write` calls and holds each request until the harness releases it, so every plan update travels core → ACP → SSE → Web Shell. Input is real wheel and click events in Chromium at 1280×800. Client arms are hot-swapped under the same daemon, and each run reports the served `index-<hash>.js`.

| Arm | What it is |
|---|---|
| head | `2a74ac5a` as is |
| control | head with the F1 effect removed (the pre-`e433da2` file) |
| patch | head plus the patch in §3 |
| dev | the same trees under `vite` dev, where `main.tsx` enables `React.StrictMode` |

**1a. Reader scrolled 600 px up, one 7-step plan (figure above).** Each cell is the Δy of one on-screen transcript paragraph.

| event | control (prod) | head (prod) | head (dev) | patch (prod) | patch (dev) |
|---|---|---|---|---|---|
| strip appears (+174.94 px) | +174.94 | −0.06 | **−175.06** | −0.06 | −0.06 |
| 5 row drops (−22 px each), summed | 110.75 | 0.75 | 0.75 | 0.75 | 0.75 |
| plan completes, strip removed | −64.19 | **−64.19** | **−64.19** | **−0.19** | **−0.19** |
| total | 349.88 | 65.00 | 240.00 | 1.00 | 1.00 |

- The sandbox round inferred, without measuring, that production is unaffected by G1. That half is now measured: the production mount is −0.06 px.
- G1 reproduces on the real daemon in dev: −175.06 px.

![Completion A/B](fig2-completion-ab.png)

**1b. Follow mode, new.** No earlier round ran the reader-at-the-bottom cases that a batched `todo_write` or a collapse click produces. The concern was that the browser's clamp of `scrollTop` would feed the `fromBottomBefore` formula a wrong value and push a following reader off the bottom. It does not happen. Every row below is identical on head, control and patch:

| event while following the bottom | strip Δ | settled `fromBottom` | max `fromBottom` in painted frames |
|---|---|---|---|
| plan appears | +174.94 | 0 | 0 |
| 1 item completes | −22.00 | 0 | 0 |
| 3 items complete in one `todo_write` | −66.56 | 0 | 0 |
| 60 paragraphs then stream in | – | 0, and the last paragraph is on screen | – |
| collapse click, ×6 | −112.94 | 0 | 0 |
| expand click, ×6 | +112.94 | 0 | 0 |
| plan completes | −64.19 | 0 | 0 |

"Painted frames" means a sampler queued after each `requestAnimationFrame`, so it reads what the frame actually painted. A sampler inside rAF, which runs before the frame's ResizeObserver callbacks, sees a 113 px intermediate state on head during expand in 6 of 6 runs. That state is never painted: the post-frame sampler reads 0 in all 6. It is not a visible flicker.

**1c. Historical viewport, new.** Triage stage 2 listed this as not verified. I seeded 300 turns through the daemon API, used the turn rail to enter `data-history-viewport="historical"`, and ran a plan while viewing that older range.

- **Reader mid-range** (5503 px from the top, 3438 px from the bottom): each row drop compensates to −0.19 px, **0** extra history requests are made, and the view stays historical. Completion: −64.19 px on head, −0.19 px with the patch.
- **Reader 215 px from the top** (the viewport's older-page threshold is 200 px): on head, the first 22 px compensation crosses the threshold and triggers exactly **one** `GET /session/:id/transcript` for the older page. The viewport's anchor restore keeps the paragraph in place to within +0.25 px, and the view stays historical. On control there is no load, and the text moves −22 px per step. So the triage's hypothesis is real, but the effect is the same as a 22 px user scroll and does no harm.

**1d. The `mobileWelcomeGroup` insertion is unreachable.** Earlier rounds listed this branch as unmeasured. It cannot render the strip:

- `showMobileWelcomeFooterMiddle` requires `useMobileWelcomeMiddleLayout`, which requires `isChatEmptyState`.
- `isChatEmptyState` includes `!showFloatingTodos` (`App.tsx:18366` at `2a74ac5a`).
- `stickyPlanStrip` requires `showFloatingTodos` (`App.tsx:20642`), and `showFloatingTodos` has a single declaration (`App.tsx:7447`).

So `{stickyPlanStrip}` at `App.tsx:20843` is always `null` (nit; it can go in the follow-up).

### 2. Status of earlier findings at `2a74ac5a`

| finding | status |
|---|---|
| R2-F1: reading jump on every row drop | **Fixed.** Measured in production against a real daemon (§1a). |
| G1: mount compensation not idempotent under StrictMode | **Dev only.** Production is measured clean. **Closed by the patch.** |
| G3 / F1-r3: 64 px jump when the plan completes | **Stands on head. Closed by the patch.** |
| F2 / G2: App wiring and compensation unpinned in CI | **Closed by the spec** (§3, matrix below). |
| R3: Lint & Static red on gate freshness | **Fixed at head.** Every check that ran on `2a74ac5a` is green. `main` has changed the gate file `.github/workflows/ci.yml` five times since the merged commit `790bd83c2b` (#12709, #12733, #12780, #12864, #12833), so **merge `origin/main` before the next push** or that step goes red again. |
| SB-F1 inert `position: sticky` / `backdrop-filter`; SB-F3 duplicate `Current tasks` landmark (re-counted: 2); SB-F4 and TodoPanel duplication; cap-comment drift; §1d dead insertion | Non-blocking. **Please file these together as one follow-up issue** rather than widening this PR. |

### 3. The patch and the spec

The compensation already runs in a layout effect. React runs a layout effect's cleanup before it removes the strip's DOM node, so the cleanup still sees the pre-removal geometry and can hand the strip's height back to the scroller. The same cleanup also undoes the first mount compensation when StrictMode re-runs the effect: +H, −H, +H nets to +H. That is why no ref is needed. The cleanup skips readers who are following the bottom, using the same 30 px rule the effect already uses.

```diff
--- a/packages/web-shell/client/components/panels/StickyPlanStrip.tsx
+++ b/packages/web-shell/client/components/panels/StickyPlanStrip.tsx
@@ -76,7 +76,18 @@
       compensate(delta);
     });
     observer.observe(strip);
-    return () => observer.disconnect();
+    return () => {
+      observer.disconnect();
+      // Layout-effect cleanup runs before React removes the strip, so this is
+      // still the pre-removal geometry: hand back the height the list regains.
+      // Also undoes the mount compensation when StrictMode re-runs the effect.
+      const list = strip.parentElement?.querySelector<HTMLElement>(
+        '[data-web-shell-message-list]',
+      );
+      if (!list) return;
+      if (list.scrollHeight - list.scrollTop - list.clientHeight < 30) return;
+      list.scrollTop -= height;
+    };
   }, [mounted]);
   if (!mounted) return null;
```

The spec is `client/e2e/web-shell.sticky-plan.spec.ts`, 192 lines, tagged `@smoke`, and uses the existing `mockDaemon` only. It holds three tests:

- **t1, App wiring.** The strip mounts above the message list, shows the same step as the chip, starts expanded with 5 rows plus `... 2 more`, follows a live `todo_write`, and unmounts on completion.
- **t2.** A scrolled-up reader stays within 2 px while a batched `todo_write` drops two rows.
- **t3.** The same reader stays within 2 px when the plan appears and when it completes.

Full file: [`patch/web-shell.sticky-plan.spec.ts`](patch/web-shell.sticky-plan.spec.ts). The combined diff is [`patch/sticky-plan-strip-cleanup-plus-e2e.diff`](patch/sticky-plan-strip-cleanup-plus-e2e.diff); `git apply --check` passes on `2a74ac5a`, and the e2e utils there are identical to `main`.

| arm (e2e runs under `vite` dev, so StrictMode is on) | t1 wiring | t2 rows drop | t3 appear + complete |
|---|---|---|---|
| head `2a74ac5a` | ✅ | ✅ | ❌ 175.06 px on appear (G1) |
| **head + patch** | ✅ | ✅ | ✅ (15/15 over `--repeat-each=5`) |
| control, F1 effect removed | ✅ | ❌ 44.19 px | ❌ 174.94 px |
| mutant: `App` never renders the strip | ❌ | ❌ | ❌ |
| mutant: `App` starts the strip collapsed | ❌ | ✅ | ❌ 40 px |
| mutant: appear fixed, completion not compensated | ✅ | ✅ | ❌ 174.94 px on complete |

Head's t1 and t2 passed 6/6 on repeat, and its t3 failure is deterministic (3/3 at 175.06 px). The last mutant shows that t3's completion assertion can fail independently of its appear assertion.

### 4. Gates

| gate | result |
|---|---|
| full `packages/web-shell` vitest on the merge result | **393 files / 10385 tests pass** |
| with the patch and spec applied: `eslint --max-warnings 0`, `prettier --check`, `tsc -p tsconfig.json --noEmit` | clean |
| with the patch: `StickyPlanStrip`, `TodoPanel` and `todos` tests | 95/95 |
| patch in production, all scenarios in §1a–§1c | per-step shift ≤ 0.19 px; follow mode 0 px in every case; 0 extra history requests mid-range |
| CI on `2a74ac5a` | every check that ran is green: Test (ubuntu), Lint & Static, Integration (no-AK), web-shell E2E Smoke, visuals (the macOS and Windows test legs were skipped) |

### 5. Not covered

- macOS and Windows; Linux Chromium only.
- WebKit and the mobile projects.
- A real model this round. R1 ran glm-5.3-flash, and the paths it exercised are unchanged.
- The `onOpen` / cockpit path (covered by R1 and the unit test).
- Collapse-state persistence, which the PR declares out of scope.
- The inert-CSS pixel diff was not re-measured; `StickyPlanStrip.module.css` has not changed since the sandbox measured it.

**What unblocks the merge:** apply the patch and the spec (with a `main` merge first, for the lint gate), and open the follow-up issue. The standing bot `CHANGES_REQUESTED` is anchored at pre-fix commit `521493f` and needs a maintainer dismiss at that point.

Evidence: figures, the harness (fake model, drivers, 300-turn seeder, compose script), raw per-arm JSON and spec logs are under [`pr-12134-round4/`](.) on the `asserts` branch.
