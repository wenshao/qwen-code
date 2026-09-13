## Local runtime verification (round 2) — PR #10938 @ `5f70a13`

**Recommendation: fix one small, phone-width regression, then merge.** The two blockers from round 1 (R6-3, R7-3) are fixed and hold up in Chromium. R8-2, the Critical that was still open, is fixed by `5f70a13866`: I reproduced it in a real session on `5c4f1de`, and it is gone on `5f70a13`. The `main` merge broke nothing.

**One defect remains, and this diff introduces it:** at ≤480px, a dependency edge that skips a layer runs its vertical segment through the step in between. That is the part of R6-3 about edges that span more than one layer, which the author left open because nobody had observed it. At 390px and 430px, the segment at `riseX = endX - 24` runs 10px inside step 4, so a dependency from step 3 to step 5 looks like it enters step 4. A 10-line candidate patch removes the crossing, keeps every 1440px path byte-identical, and passes all 47 `PlanExecutionView` tests. It only affects phone widths and plans that have such edges, so a fast follow-up would also be reasonable.

One test gap remains as well: the `toolUseId` dedup in the new agent count has no test (mutant M20 survives).

### What changed since round 1

- `4860e0a7e6` fixes R6-3 (the adjacent-edge shoulder) and R7-3 (adds an sr-only dependency summary).
- `5c4f1de9e8` merges `main`. The merge base is `bc7a186`, the current `main` tip.
- `5f70a13866`, pushed at 06:23 while this round was running, fixes R8-2. It only touches web-shell client files, so I built it as its own bundle and re-ran every check it could affect.

### Environment

This round reuses the round-1 harness. The worktree was built with `npm ci` (Node 22.22.2, Linux). **One** real `qwen serve` daemon, built from `5c4f1de`, backs every arm. `5f70a13` changes client code only, so that daemon is also the backend for the new head. Each arm is a static proxy that serves its own bundle and forwards all REST and SSE traffic to that daemon, so **all arms render the same live sessions at the same moment**:

| Arm | Port | Bundle |
| --- | --- | --- |
| base | 4939 | The 7 changed sources exactly as they are on `bc7a186` (checked with `git diff --quiet`) |
| revert | 4940 | `5c4f1de` with `4860e0a7e6` reverse-applied (2 files) |
| previous head | 4938 | `5c4f1de`. The rebuilt bundle has the same hash as the one the daemon serves |
| **head** | 4943 | `5f70a13` |
| lanefix | 4941 | Previous head plus the candidate lane patch. **Not part of this PR** |

The sessions are new and were created through the real Plan & Review flow. Since #11423, the approval option reads **"Approve and execute · Full Access"**.

- **DAG:** 5 steps in 3 layers, one return lane, and 8 linked agents (6 succeed, 1 stays running, 1 fails).
- **REVIEW:** the same plan, left unapproved, so the approval card shows the interactive graph.
- **BIG:** 50 steps with 525 dependencies.
- **NEST:** a background agent linked to step 1 whose subagent launches a nested agent. Both stay live.

The browser is headless Chromium driven by Playwright 1.58.2.

### 1. R6-3 fixed: arrowheads point into their target at every width

For each adjacent-layer edge I took the end tangent (end point minus last control point) from the rendered `[data-plan-edge]` path. All three adjacent edges give the same value at each width, and `5c4f1de` and `5f70a13` give identical numbers:

| Viewport | Gutter | base | revert | **head** |
| --- | --- | --- | --- | --- |
| 1440 | 64px | (28, 0) | (28, 0) | **(28, 0)**, unchanged path |
| 700 | 32px | (28, 0)¹ | (0, 0), degenerate | **(12, 0)** |
| 430 | 18px | (28, 0)¹ | (−14, 0), reversed | **(5, 0)** |
| 390 | 18px | (28, 0)¹ | (−14, 0), reversed | **(5, 0)** |

¹ The base bundle has no narrow tiers; its gutter is 64px at every width.

The revert arm reproduces the round-1 numbers exactly. Mutant M13 restores `Math.max(24, …)`, and the new test `keeps the arrowhead pointing at the target on every gutter tier` catches it.

![Arrowheads: fix reverted vs head](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-10938/r2/fig2-arrowheads.png)

### 2. R7-3 fixed: unselected nodes name their blockers again

On the approval card, edges are drawn and `aria-hidden`, and nothing is selected. `ariaSnapshot()` of step 4 in each arm:

- base: `compare-findings Blocked Compare findings and draft the migration plan Depends on: survey-api, read-tests`
- revert: `Blocked 4 Compare findings and draft the migration plan`
- **head: `Blocked 4 Compare findings and draft the migration plan Depends on: 1 Survey the public API surface, 2 Read the existing test suite`**
- zh-CN (checked on `5c4f1de`; `5f70a13` does not touch this code): `被阻塞 4 Compare findings and draft the migration plan 依赖： 1 Survey the public API surface, 2 Read the existing test suite`

The summary changes nothing visible. The span is `1×1`, `position: absolute` and `clip-path: inset(50%)`. Screenshots of the approval-card graph differ between revert and head in **0 pixels** (966×253), and every node has the same height in both arms. Each surface states a dependency exactly once:

| Surface | Visible chip rows | sr-only summaries |
| --- | --- | --- |
| Approval card (edges drawn) | 0 | 2 (steps 4 and 5) |
| Cockpit (`showStepDetails={false}`) | 2 | 0 |
| BIG, 525 dependencies (no edges) | 25 | 0 |

Mutants M14–M17 all fail the suites: summary removed, clip removed, raw ids instead of number and title, and summary rendered next to the visible chips.

### 3. R8-2 fixed by `5f70a13866`, confirmed in a real session

Session NEST, cockpit view. Both heads render at the same moment against the same daemon:

| Arm | Node face | Agent rows on that node | Overview strip |
| --- | --- | --- | --- |
| previous head `5c4f1de` | **`1 agent`** | 2 (`Agent: Parent agent`, `↳ general-purpose: Nested probe`) | `2 Active agents` |
| **head `5f70a13`** | **`2 agents`** | 2 | `2 Active agents` |
| base | no count on the face | 2 | `2 Active agents` |

![R8-2: previous head vs head](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-10938/r2/fig3-r8-2-agent-count.png)

The trigger is ordinary: a background agent whose subagent calls `agent`. Nesting is on by default (`DEFAULT_MAX_SUBAGENT_DEPTH = 5`), and `general-purpose` inherits the `agent` tool. The nested child shows up as a live task with `parentAgentId`, but the parent tool call has no matching `subTools` entry. That is the "live task with no transcript entry" case the review describes.

Before the push, I had built the patch the author proposed in the thread as a separate bundle. It also read `2 agents`. The pushed commit is the same code apart from one variable name.

Tests at `5f70a13`:

- The existing fixture now expects `2 agents`.
- The new test `the node-face agent tally matches the rows it renders` covers a live child with no transcript entry, and keeps the singular form (`1 agent`) tested.
- Mutant **M19** (count back to transcript-only) and **M21** (live child tasks dropped) both fail the suites.
- Mutant **M20** removes the `toolUseId` dedup, so an agent seen both as a live task and in `subTools` would be counted twice, and **it still passes all 41 tests**. The dedup exists, but nothing tests it.  I tried to reach that overlap in a real session with a foreground variant: the root agent runs in the foreground, and its subagent calls `agent`. The nested agent's own model request did arrive, but neither head showed the nested agent at all (1 row, `1 agent`, strip 1), so the overlap case cannot be reached from the UI. M20 is therefore a test gap, not an observed bug. A fixture where a live task's `toolUseId` matches a transcript `subTools` entry, asserting it is counted once, would close it.

### 4. Remaining defect: at ≤480px the return lane rises through the step between its ends

The router for edges that span more than one layer still uses fixed 24px shoulders: `dropX = startX + 24` and `riseX = endX - 24` in `PlanExecutionView.tsx`. An 18px gutter leaves only a 10px run, so the vertical segment lands 6px inside the neighbouring lane of nodes.

In the DAG session at 390px, the edge `check-docs → write-summary` (step 3 → step 5) rises at x=246, and step 4 spans x=140–256. The segment overlaps step 4 for 106px, and the SVG is painted under the nodes. So the blue lane runs up into step 4's bottom edge and disappears, and on a phone it looks like a dependency of step 4. The numbers on `5f70a13`:

- 390px and 430px: identical crossing.
- 700px (32px gutter): the rise clears step 4 by 4px.
- 1440px: it clears step 4 by 36px.
- base: never crosses, because its gutters are always 64px.
- The drop segment has the same geometry: at 390px, x=150 falls inside layer 2's span. It misses a node here only because layer 2 has a single node.

![Lane crossing at 390px: head vs candidate](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-10938/r2/fig1-lane-crossing.png)

The candidate is in `patches/lanefix-candidate.patch` (+24/−10) and is **not** in this PR. Like the adjacent edge already does, it derives each shoulder from the gutter measured on that side, and it shrinks the corner radius so the curve still fits:

```ts
const dropShoulder = Math.min(24, dropRun / 2); // dropRun = next layer's left − 4 − startX
const riseShoulder = Math.min(24, riseRun / 2); // riseRun = endX − (previous layer's right + 4)
const corner = Math.min(EDGE_CORNER, dropShoulder / 2, riseShoulder / 2);
```

Measured on the same session:

- **1440px:** all 4 paths are byte-identical to head.
- **700px:** the rise moves from x=426 to 438 and the drop from 250 to 238, the centres of their gutters.
- **390px:** the rise sits at 265 (gutter 256–274) and the drop at 131 (gutter 122–140). 430px is the same shifted by 5px. There are 0 node crossings, and the final tangent is (2.5, 0).
- **Tests:** `PlanExecutionView` suites pass 47/47.

A first version used `corner = min(6, shoulder)`. At 18px that left a zero-length final segment, which is why the corner is halved. The patch touches only the router, so it applies unchanged on `5f70a13`.

### 5. Round-1 claims after the `main` merge

Measured on `5c4f1de`. `5f70a13` only changes the agent count, and the DAG session has no nested agents. Every value round 1 measured still holds:

| Claim | Round 2 |
| --- | --- |
| Node faces | `1 Survey the public API surface` / `✓ 3 agents 10s`; `3 Check the docs…` / `◐ ! 2 agents 4s` |
| Status rule contrast | dark 8.01 / 5.9 / 12.05; light 5.38 / 7.2 / 4.73; blocked and ready are transparent |
| Ports | no input port; the output port uses the hairline colour |
| Selected blocked node | `3px transparent`. Forcing the ring colour gives `3px oklch(0.708 0 0)`, so the pin is needed |
| Cockpit dependency navigation | `5 Write…` selects `write-summary`, then `4 Compare…` selects `compare-findings` |
| Approval-card Step details | 3 `<button data-plan-dependency data-plan-interactive>`; clicking in either direction selects the step |
| Show all | `Show all 8 runs` renders on one line with `display:block` and expands to 8 rows. With its two rules deleted it wraps to 3 lines (77px) |
| Narrow lanes | 700px fits (676 = 676), 430px fits, 414px overflows by 6px, 390px by 30px |
| > 500 dependencies | 0 edges plus the notice; chips on 25/25 leaves |
| Console and page errors | 0 on every arm and scenario |

![Cockpit on 5c4f1de](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-10938/r2/fig4-cockpit-head.png)

### 6. Static checks, tests and CI

| Check | `5c4f1de` | **`5f70a13`** |
| --- | --- | --- |
| `tsc -p packages/web-shell/tsconfig.json --noEmit` | ✅ 0 errors | ✅ 0 errors |
| `eslint` on the changed TS/TSX files · `prettier --check` on all changed files | ✅ · ✅ | ✅ · ✅ |
| `vitest run client/components/messages/PlanExecutionView client/components/workflow` | ✅ 87 tests | ✅ **88 tests** |
| Full web-shell `vitest` | ✅ 311 files, 7691 tests | ✅ 311 files, **7692** tests |
| Mutation check | 18 mutants; 17 fail the suites, **M7** still passes | 3 more mutants: M19 and M21 fail the suites, **M20** still passes |
| CI | all green (Lint & Static, Test, web-shell E2E Smoke, visuals, Integration, Desktop Shell) | Lint & Static, Integration (no-AK) and Desktop Shell pass. Test (ubuntu) and web-shell visuals were still running when this was posted |

On `5c4f1de`, the 87 tests are the author's 84 plus the tests #11434 brought in through `main`. The 353 `tsc` errors the author saw locally come from a missing `@qwen-code/sdk` dist; after a full `npm ci`, `tsc` exits 0.

### Still open from round 1

The author deferred these on purpose. None of them blocks merge.

- The chip row for more than 500 dependencies has no cap: `leaf-1` is 554px tall on head and 153px on base.
- `PlanExecutionView.module.css:249-250` still says a 390px phone "scrolls the last ~6px", but the measured overflow is 30px. The PR body already has the correct figure.
- Focus falls to `<body>` after you activate a dependency link or "Show all" (D9-3).
- Nodes at rest (ready or blocked) have no left hairline. That is a design decision.
- Mutant M7 still passes the suites.

### Not covered

- macOS and Windows.
- zh-CN visual rendering. Only the accessible name was checked.
- The path through the Plan & tasks dialog.
- The overlap case of the new agent count (section 3), which cannot be reached from the UI.

Figures, raw crops, JSON, logs, patches and the harness are in [`asserts/pr-10938/r2`](https://github.com/wenshao/qwen-code/tree/asserts/pr-10938/r2).
