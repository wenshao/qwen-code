## Maintainer verification — real local A/B on this branch

I built a real environment for this PR (worktree at `6ca85e0b62`, full `npm ci` including the postinstall package build, Node v22.22.2, vitest 3, Linux/16 cores) and A/B'd the change by adding and removing exactly its three lines in place.

**Verdict: the code change is correct, well-targeted and safe to merge. The PR body, however, describes a different change than the one on the branch, and `Fixes #11414` is not carried by this diff.** Please update the description before merging.

---

### What the branch actually contributes

The three-dot diff against `main` is 3 lines in **`applies authenticated open before the yargs path starts the daemon`** (`packages/cli/src/commands/serve.test.ts:429`), waiting on `mockOpenBrowserSecurely`.

The branch has two functional commits:

| commit | change | net effect on `main` |
| --- | --- | --- |
| `a2420452fd` | `mockQr.generate` wait on `forwards --token and --allow-origin` | **none** — `main` already has it via merged #11362 (`10895031e2`, 2026-09-09) |
| `e7e2ecdf20` | `mockOpenBrowserSecurely` wait on `--open-with-auth` | this is what ships |

![shipped diff vs described change](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr11417/04-body-vs-diff.png)

---

### Findings

#### 1. (Important, docs) The body describes a change that is no longer in the diff

The body says "the `forwards --token and --allow-origin` Local Control test now waits for its fire-and-forget handler's **pairing phase**". The diff waits for the `--open-with-auth` test's **browser-open phase**. Different test, different mock, different phase.

That matters for review, because the **Reviewer Test Plan is a recipe for the merged #11362 change, not for this one**. I ran the body's recipe verbatim (Local Control `enable()` of the first test delayed ~100 ms, the next test's ~1000 ms):

* with the merged #11362 wait removed → `Unhandled Rejection: Error: process.exit(1) called`, 1 failed | 69 passed, `Errors 1 error` — the #11414 signature reproduces exactly as the body describes;
* with the merged #11362 wait in place (i.e. current `main`, and this branch) → 70/70, zero unhandled errors, **whether or not this PR's three lines are present**.

So a reviewer who follows the stated plan verifies `main`, not this PR.

![#11414 signature attribution](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr11417/02-11414-signature.png)

#### 2. (Important) `Fixes #11414` overstates what this diff does

The #11414 signature is an *unattributed* whole-run failure driven by an unhandled `process.exit(1)`. The leak this diff closes **cannot** produce that signature: its only escape is `openBrowserSecurely`, and every failure mode of that call is caught by `maybeOpenWebShellBrowser`'s own `try/catch`. I verified it directly — I made the leaked call consume a one-shot `mockOpenBrowserSecurely.mockRejectedValueOnce(new Error('leak-boom'))` installed by the next test, and the run reported:

```
qwen serve: failed to open browser: leak-boom. Please open this URL manually: http://127.0.0.1:4170/#token=generated-token
Tests  1 failed | 69 passed (70)      <- named victim test, no "Errors" line
```

No unhandled rejection, no `process.exit`. The worst case this leak can cause is a **named** test failure. The hazard #11414 actually named was already closed on `main` by #11362, and #11414 itself was closed manually on 2026-09-09, so the `Fixes` trailer is inert as well as inaccurate.

#### 3. (Nit) On today's mocks the wait is a no-op — it is insurance, not the thing that turns CI green

`startServeHandlerWithArgs` anchors on `mockRunQwenServe` having been called. `vi.waitFor`'s first check runs synchronously and always fails here (the handler `await`s `import('../serve/run-qwen-serve.js')` before calling it); every later check is a 50 ms `setInterval` macrotask. By the time the anchor is observed, the whole downstream chain — `runQwenServe` → `runtimeReady: Promise.resolve()` → `openBrowserSecurely` — has already drained, because it is microtasks only.

Measured on the unpatched tree: `openBrowserSecurely` had already been called **in 25/25 runs** (15 idle + 10 under CPU oversubscription, load average ~38 on 16 cores) at the moment test A reaches its assertions. Suite cost is unchanged (`tests 2.70s` vs `2.72s`).

![clean baseline and leak-window measurement](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr11417/03-baseline-and-leakwindow.png)

#### 4. The wait does do what it claims, and its scope is right

Forcing a genuine macrotask window between the anchor and the observable (test A's `runtimeReady` delayed 300 ms) makes the leak real, and the three lines close it — against the file's **existing** assertion, not a synthetic one:

* without the PR: the leaked `openBrowserSecurely` lands inside `prints the authenticated manual URL on the yargs headless path` and breaks its `expect(mockOpenBrowserSecurely).not.toHaveBeenCalled()` → 1 failed | 69 passed;
* with the PR: 70/70.

![forced-race A/B](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr11417/01-forced-race-ab.png)

Two risk probes, both clean:

* **Can it hang?** No. With the awaited call made unreachable (test A forced down the headless path), `vi.waitFor` gives up at its 1000 ms default with a named assertion failure. Bounded and attributed; worst case +1 s.
* **Is a sibling left leaky?** No. The one structurally similar site — `keeps Local Control pairing separate from the temporary primary token`, also `--open-with-auth`, also anchored only on `mockQr.generate` — survives the same forced race, because `startLocalControl` awaits `runtimeReady` *before* the QR call the test anchors on, so nothing observable outlives that anchor. No further quiescence is needed in this file.

![risk probes](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr11417/05-risk-probes.png)

#### 5. (Housekeeping) #11376 is now empty

The other sibling named in the body, #11376, is an empty diff against `main` (`compare main...autofix/issue-11363` → 0 files changed). It can be closed.

---

### Local gates

| gate | result |
| --- | --- |
| `npx vitest run src/commands/serve.test.ts` (with PR) | 70/70, 8/8 consecutive runs |
| `npx vitest run src/commands/serve.test.ts` (without PR) | 70/70 |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run build` | exit 0 |
| `npx vitest run src/commands` (whole directory, with PR) | 170 files, 7098 passed \| 19 skipped |
| PR CI | green |

---

### Recommendation

**Merge, after fixing the description.** The change itself is a correct, bounded, well-scoped piece of test hardening with no measurable cost. But the record should match the code:

1. rewrite "What this PR does" / "Why it's needed" to describe the `--open-with-auth` → `openBrowserSecurely` wait;
2. replace the Reviewer Test Plan repro with one that exercises *this* diff (delay test A's `runtimeReady`, not Local Control's `enable()`);
3. drop `Fixes #11414` to a plain reference — #11414's mechanism is already closed by #11362, and leaving the trailer attributes that fix to the wrong commit, which will mislead whoever investigates the next recurrence of this CI signature.

