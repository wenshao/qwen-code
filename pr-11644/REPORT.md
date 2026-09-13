# PR #11644 verification report

Posted to https://github.com/QwenLM/qwen-code/pull/11644 · [中文版](REPORT.zh-CN.md)

## Maintainer verification — real `qwen serve` + Web Shell in Chromium, Linux

Verified head `144bc25a31` against its merge base `00d86315c8`.

**Setup**
- **Build and arms.** The PR tree was built once with `npm ci`. Both arms run the same daemon binary; only the Web Shell bundle is swapped.
  - The base bundle reverts the PR's `packages/web-shell` and `packages/sdk-typescript` changes. It rebuilds the SDK dist before `vite build`, because the production build resolves `@qwen-code/sdk` from `dist`.
  - Rebuilding the PR after the restore is byte-identical to the shipped bundle.
- **Workspaces.** Three trusted git workspaces are bound with `--workspace` ×3, each with a project skill:
  - `alpha-app`: active; 3 modified, 2 stashed.
  - `beta-lib`: 1 modified.
  - `gamma-docs`: clean.
- **How requests are counted.** Every browser → daemon request is recorded with Playwright `page.on('request')`. Turns are served by a mock OpenAI-compatible model.

**Verdict: the change works as described. Recommend merge once the new conflict with `main` is resolved (F1).**
- Idle overview and sidebar Git polling drop to zero.
- Visible consumers keep their cadence and stop when closed.
- Providers, Skills catalog and capability-preflight reads drop as claimed.
- None of the user paths I exercised regressed.
- One wording correction: the providers read is 3 → 2 on a real page, not 2 → 1 (O1).

![A/B request counts](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-11644/fig1-requests.png)

### 1. Sidebar reads overview and Git only while a consumer is open (#11603, #11605)

In an idle page with three expanded rows, the 75 s steady state (after the first 20 s) gives:
- Overview facet reads: base **45** (5 facets × 3 rows × 3 ticks), PR **0**.
- Sidebar Git reads on `beta-lib` + `gamma-docs`: base 2, PR **0**.
- Over the whole 95 s: base 174 requests, PR 95.

Per-phase counts on `beta-lib`:

| `beta-lib`, per phase | base facets / Git | PR facets / Git |
| --- | --- | --- |
| idle 35 s, never hovered | 10 / 1 | **0 / 0** |
| details popover open 33 s | 5 / 1 | 10 / 1 (open + one 30 s tick, `git?wait=1`) |
| 67 s after leaving, including a `focus` event | 15 / 2 | **0 / 0** |
| workspace menu open 62 s | 10 / 1 | 15 / 2 (3 rounds) |
| 67 s after the menu closes, including `focus` | 20 / 2 | **0 / 0** |

- **Why `beta-lib`.** Sidebar Git is counted on it rather than the active workspace. The empty-state composer legitimately polls the active workspace's `/git` every 30 s (its toolbar shows `gitBranch`), and that path is indistinguishable from the sidebar's.
- **Menu items at first paint** are identical on both arms, including `New worktree task`.
- **Hover summary** is plain text built from the existing phrases: `main   3 modified · 1 untracked · 2 stashed`.

![Hover details A/B](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-11644/fig2-details.png)

### 2. Chat Git reads follow their visible consumer

This test runs after a real turn, where the default toolbar no longer contains `gitBranch`. It counts Git reads on the active workspace over 65 s:

| environment card | base | PR |
| --- | --- | --- |
| closed | 5 | **0** |
| open (`Toggle environment information`) | 5 | 4 (the 30 s poll resumes) |

![Environment card closed vs open](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-11644/fig5-chat-git.png)

<sub>The red toasts are harness noise from the mock model id and appear on both arms.</sub>

### 3. Startup reads: providers, Skills catalog, capability preflight

- **`GET /workspace/providers`.** Chat startup: base 3 → PR 2. Each Settings opening: base 0 → PR 1. Closed Settings: 0 on both. The remaining two reads are explained in O1.
- **Sessionless Skills catalog** (`/config/skills` and `/runtime/skills`):
  - Startup: base 5 → PR **0**.
  - Ordinary typing: 0 → 0.
  - First `/`: base 0 → PR 2.
  - Second `/`: 0 → 0.
  - `/release-notes` is offered on both arms with identical options.
- **`GET /capabilities`** during page load plus 95 s idle: base 9 → PR 3.
- **SDK against the same daemon** (base SDK bundle vs PR `dist`):

| step | base: capabilities + lists | PR: capabilities + lists |
| --- | --- | --- |
| 4 sequential source-filtered lists (cold) | 4 + 4 | **1** + 4 |
| 4 concurrent lists (warm) | 4 + 4 | **0** + 4 |
| explicit `capabilities()`, then one list | 1, then 1 + 1 | 1, then **0** + 1 |
| new client, 4 concurrent lists | 4 + 4 | **1** + 4 |
| `requireCapability('definitely_not_a_feature')` | fresh read, `DaemonCapabilityMissingError` | fresh read, same error |
| one list after 61 s | — | 1 + 1 (TTL expired) |

### 4. Checks on the new code paths

- **Attachment with an unresolved Skill command.**
  - Steps: in a draft chat, attach a PNG, insert `/release-notes <marker>` without browsing suggestions, then press Enter.
  - Both arms: the model request starts with `[image: image/png] Base directory for this skill: …/release-notes`, so the image is kept.
  - Both arms issue the same single `GET /session/:id/supported-commands`. The new async classification adds no visible request here.
- **R1-7 (worktree entry appears late).** Not observable on these small repositories: the menu's first paint already contains `New worktree task`.
- **R1-54 (stale summary).** Not observable either.
  - Steps: changed `beta-lib` while its details were closed, then re-hovered.
  - The first sample at popover visibility (824 ms after hover, including the 300 ms delay) already read `3 modified · 1 untracked`.
  - Both items remain plausible where `git status` takes seconds.

### 5. Visible capability change: sidebar branch picker for non-active workspaces (R1-1)

- **Base:** every row has a Git chip. Clicking `beta-lib`'s chip opens `Update Project / Commit / Push / View Changes / New Branch… / Checkout Tag or Revision…` for a workspace that is not active.
- **PR:** that entry point is gone, and the hover summary is read-only.
- This matches the Risk & Scope note and the R1-1 disposition. I'm calling it out because multi-workspace users will notice it.

![Sidebar Git before/after](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-11644/fig4-sidebar-git.png)

### Tests and CI (Linux, Node 22.22.2)

- **Unit tests.** The 12 changed web-shell test files: **2041 passed**. `DaemonClient.test.ts`: **440 passed**.
- **Playwright** `web-shell.workspace-overview.spec.ts`:
  - At head: **4/4 passed**.
  - With the merge-base sources and the PR's spec: the two rewritten tests fail (`Expected length: 0, Received length: 21` for idle facet reads; `Expected 10, Received 15`), and the two unchanged tests pass.
  - So the new assertions are not vacuous.
- **CI at `144bc25a31`.** Green: Test (ubuntu), Lint & Static, web-shell E2E Smoke, Integration (no-AK), Desktop Shell, Web-shell Visuals.

### Findings

**F1 — conflict with current `main`; must be resolved before merge.**
- GitHub now reports `mergeable_state: dirty`.
- `git merge-tree` against `b4d61e3a0b` conflicts in one hunk of `App.tsx` `handleCloseAuthDialog`: #11342 added `void reloadModelConfigurations()` directly above the comment this PR rewrote.
- *Resolution:* keep main's call and its dependency array, with either comment.
- *Semantic side:* #11342's new `providersState` consumers (the advisor and image role-model dialogs) open only from the Settings models section, where `providersEnabled` is true. So the Settings-only gate should not starve them.
- *After the rebase:* re-run `App.test.tsx`. (`autofix/takeover` is on, so the bot may pick this up.)

**O1 — #11604 is only partly closed: the page reads providers 3 → 2, not 2 → 1.**
- *How attributed:* CDP `Network.requestWillBeSent` initiator stacks.
- *Base, three reads:* two come from `DaemonSessionProvider`'s deferred-connect `Promise.allSettled([client.workspaceProviders(), …])`, and one from `useDaemonProviders`.
- *PR, two reads:* the PR removes the `useDaemonProviders` read. Both remaining reads carry the identical deferred-connect stack, because that batch runs twice during boot.
- *Impact:* not a defect in this PR. But the body's "one initialization read" should read "two", and #11604 should stay open for that intra-provider duplicate.

### Not covered

- **Live setup polling.** The Linux daemon returns 404 for `/live/setup` and does not list `experimental.liveVoice.enabled`, so the hook is unsupported here. Covered only by `useLiveVoiceSetup.test.tsx` (passes).
- **Embedded hosts** with an explicit `composerToolbarActions` that excludes `gitBranch`. Not reachable in the daemon-served shell; unit tests only.
- **Unit tests only:** the deferred command refresh after extension changes, and the catalog failure/retry UI.
- **Platforms:** macOS and Windows.

Harness, raw JSON and logs: [`asserts/pr-11644`](https://github.com/wenshao/qwen-code/tree/asserts/pr-11644).
