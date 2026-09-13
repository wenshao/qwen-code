# PR #11644 verification report — round 2 (`b27c100ea7`)

[中文版](REPORT-r2.zh-CN.md) · [Round 1](../REPORT.md)

## Maintainer re-verification (round 2) — `b27c100ea7`, Linux

Round 1 ([comment](https://github.com/QwenLM/qwen-code/pull/11644#issuecomment-5649574918)) verified `144bc25a31`. Two commits have landed since then:
- `0351faef57` merges `main` and resolves the #11342 conflict.
- `b27c100ea7` restores the slash input after a pre-admission failure.

**Setup**
- **Harness.** Same real `qwen serve` + Chromium harness as round 1, with three trusted git workspaces.
- **Merge base.** Now `b5567bb7a9`.
- **Bundles.** One daemon binary serves three Web Shell bundles:
  - **base:** the merge base.
  - **PR:** the head.
  - **fix reverted:** the head with only `b27c100ea7`'s one-line `App.tsx` condition put back.
- **Check.** Rebuilding the PR after the restore is byte-identical (same `index.html` md5).

**Verdict: recommend merge.**
- **Round-1 A/B.** Every result reproduces on the merged head.
- **Round-1 findings.** The `main` conflict (F1) is resolved correctly. The O1 wording is fixed in the body and both design docs.
- **The new fix.** It works end to end, and reverting it reproduces the loss.
- **chiga0's review.** Of the four blockers at `0351faef57`: F1 and F4 do not hold at this head, F2 is addressed by `b27c100ea7`, and F3 does not reproduce in the UI (§3).
- **Remaining.** One non-blocking test gap (M2). The earlier bot `CHANGES_REQUESTED` still blocks the merge button.

![Round-2 A/B request counts](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-11644/r2/fig1-requests.png)

### 1. Round-1 A/B on the merged head

| scenario | base | PR |
| --- | --- | --- |
| idle 75 s, 3 expanded rows: overview facet reads | 45 | **0** |
| idle 75 s: sidebar Git reads (`beta-lib` + `gamma-docs`) | 2 | **0** |
| `beta-lib` facets, details closed (35 s + 67 s with `focus`) | 25 | **0** |
| `beta-lib` facets, details open 33 s | 5 | 10 (keeps the 30 s cadence) |
| `beta-lib` facets / Git after the menu closes (67 s + `focus`) | 20 / 2 | **0 / 0** |
| chat Git after a turn, environment card closed / open (65 s each) | 5 / 5 | **0** / 4 |
| `GET /workspace/providers`: at startup / per Settings opening | 3 / 0 | 2 / 1 |
| sessionless Skills catalog: at startup / first `/` / reopen | 5 / 0 / 0 | **0** / 2 / 0 |
| `GET /capabilities`, page load + 95 s | 9 | 3 |
| all requests, idle page 95 s | 175 | 90 |

- **Unchanged.** Menu items at first paint are identical on both arms, and the image-plus-Skill command from a draft chat keeps the image on both.
- **One extra read.** In that draft flow the PR issues one more `supported-commands` read. This is the designed pre-classification read.

**SDK capability preflight, run against the same daemon** (merge-base SDK bundle vs PR `dist`):

| step | base: capabilities + lists | PR: capabilities + lists |
| --- | --- | --- |
| 4 sequential source-filtered lists (cold) | 4 + 4 | **1** + 4 |
| 4 concurrent lists (warm) | 4 + 4 | **0** + 4 |
| explicit `capabilities()`, then one list | 1, then 1 + 1 | 1, then **0** + 1 |
| new client, 4 concurrent lists | 4 + 4 | **1** + 4 |
| unknown capability | fresh read + `DaemonCapabilityMissingError` | fresh read + same error |
| one list after 61 s | — | 1 + 1 (TTL expired) |

### 2. `b27c100ea7`: slash prompt recovery in an existing session

**Steps.**
1. Create a session with one turn.
2. Reload with `GET /session/:id/supported-commands` forced to `500`, then reopen the session so its command snapshot is unknown.
3. Attach a PNG, insert `/release-notes <marker>`, and press Enter.

| bundle | what happens |
| --- | --- |
| base `b5567bb7a9` | Request **sent without the image**, and no error is shown. The model request starts `Base directory for this skill: …`, with no `[image: image/png]` part. The composer is cleared. |
| fix reverted | `Prompt failed: GET /session/:id/supported-commands: injected supported-commands failure`. The composer is **empty**, so text and image are both lost. |
| PR `b27c100ea7` | Same error. The composer is restored: `/release-notes <marker>` **plus the image chip**. |

![Recovery A/B/C](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-11644/r2/fig6-s12-recovery.png)

- **Base behavior.** It was a silent attachment drop whenever the command snapshot was unknown. The PR turns that into a visible, recoverable failure.
- **M3 mutation.** Reverting the one-line condition fails `preserves an unadmitted slash prompt after failure (new input: false)`. The `new input: true` control still passes, and the unmutated file passes 933/933.

### 3. chiga0's review at `0351faef57`

| item | result at `b27c100ea7` |
| --- | --- |
| **F1** Git visual captures lost | **Does not reproduce.** The spec now opens the environment card and clicks its branch row. CI `Web-shell Visuals` passes `git-branch-picker.spec.ts`. Locally it passes 1/1 and writes all three captures ([01](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-11644/r2/visual-spec/01-branch-picker.png) · [02](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-11644/r2/visual-spec/02-commit-dialog.png) · [03](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-11644/r2/visual-spec/03-create-pr-form.png)); capture 01 shows the real picker. |
| **F2** attachment dropped / prompt fails | **Addressed** by `b27c100ea7` (§2). A failed classification still fails the send, but now visibly and recoverably. |
| **F3** stale branch carried into workspace B | **Does not reproduce in the UI.** Steps: in an attached `alpha-app` session with the environment card open, run `git checkout -b feature/s13`; the card shows `feature/s13` within about 1 s. Then start a new task in `beta-lib` from its workspace menu. On both bundles, the branch chip reads `main` in all 16 samples from 30 ms to 7.6 s, and `feature/s13` never appears. Caveat: I could not separate the session's git events from the App's own Git read, so this is a user-visible check, not proof of the provider-level retain condition. |
| **F4** Escape through an empty slash menu | The handler checks `slashMenuRef.current?.items.length`. Mutating it back to `if (slashMenuRef.current)` fails `empty menu retains prior Escape default behavior`. I could not force an empty menu mid-turn end to end: attached sessions still listed 16 `/skills` entries with every catalog read blocked. This row rests on the DOM test plus the mutation. |
| **R1-23** restore budget | **Pinned.** Restoring the pre-fix `generation === capabilitiesGeneration` fails `keeps the latest successful restore budget when newer discovery returns 503`. |
| **R1-3** Live polling | Linux daemons have no `/live/setup`, so this is unit-only. **M2 survives**; see the test-gap note below. |

**M2 test gap (non-blocking).** Removing `Boolean(refreshError) ||` from `statusPending` keeps all 8 `useLiveVoiceSetup` tests green. The `failed read` case fails the *first* read, where `!status` already keeps polling. So a refresh that fails *after* a stable status has loaded is unpinned. One test for that case would close the gap.

### 4. Merge resolution against #11342

`0351faef57` keeps both of main's `reloadModelConfigurations()` and the PR's Settings-gated providers refresh in `handleCloseAuthDialog`. `git merge-tree` against current `main` (`d47fa0202d`) is clean.

**Runtime check.** Settings → Model → the advisor role (the button labelled `Use main model`) opens `Set Advisor Model` on both bundles. The dialog content is identical: `1. Use main model · Modality text-only · Context Window (unknown) …`. `GET /workspace/providers` is read 4 times through that flow on each arm. The Settings-only providers gate does not starve #11342's role-model dialog.

![Advisor dialog on the PR](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-11644/r2/s15-pr-advisor.png)

### 5. Build, tests, CI (Linux, Node 22.22.2)

- **Export size guard.** `Document export renderer JS` is 1,857,007 bytes on base and 1,857,224 on the PR (+217), against the 1,930,000 limit, so it passes. CI at this head also logs 1,857,224. The 1,930,080 bytes in the author's comment does not reproduce on Linux or in CI.
- **Browser daemon SDK bundle.** 243,458 bytes on base and 244,414 on the PR. Base already exceeds the 221,184-byte warning threshold, so the warning is not new.
- **Unit tests.** 12 changed web-shell test files: **2043 passed**. `DaemonClient.test.ts`: **442 passed**.
- **Playwright.** `web-shell.workspace-overview.spec.ts` 4/4; `git-branch-picker.spec.ts` 1/1.
- **CI.** Green at `b27c100ea7`: Test (ubuntu), Lint & Static, web-shell E2E Smoke, Integration (no-AK), Desktop Shell, Web-shell Visuals.

### Still open (unchanged from round 1)

- **R1-1:** non-active workspaces lose the sidebar branch picker.
- **#11604:** stays open for the remaining deferred-connect duplicate.
- **Not covered:** Live setup end to end, embedded `composerToolbarActions` without `gitBranch`, macOS/Windows.

Harness, logs and figures: [`asserts/pr-11644/r2`](https://github.com/wenshao/qwen-code/tree/asserts/pr-11644/r2).
