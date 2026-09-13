## Local runtime verification (round 2) — PR #10938 @ `5c4f1de`

**Recommendation: both blockers from round 1 are fixed, and the fixes hold up in Chromium. The `main` merge broke nothing. Two small defects remain. This diff introduces both, and I verified a one-file patch for each in the same harness. Fix them before merge:**

1. **R8-2, the open Critical, reproduces in a real session.** One node reads "1 agent" but renders two live agent rows, and the overview strip says 2. The author's proposed fix from the thread makes the node read "2 agents". It turns exactly one test red: the `test:512` assertion that pins the wrong number.
2. **New: at ≤480px the return-lane edge rises through the step between its two ends.** This is the layer-spanning half of R6-3, which the author left open because nobody had observed it. At 390px and 430px, the segment at `riseX = endX - 24` runs 10px inside step 4, so a dependency from step 3 to step 5 looks like it enters step 4. A 10-line candidate patch keeps every 1440px path byte-identical, removes the crossing, and passes all 47 `PlanExecutionView` tests.

### What changed since round 1

- `4860e0a7e6` fixes R6-3 (the adjacent-edge shoulder) and R7-3 (adds an sr-only dependency summary).
- `5c4f1de9e8` merges `main`. The merge base is `bc7a186`, the current `main` tip, so the branch is 0 commits behind.

### Environment

This round reuses the round-1 harness. The worktree was rebuilt at `5c4f1de` with `npm ci` (Node 22.22.2, Linux). **One** real `qwen serve` daemon, built from head, backs every arm. Each arm is a static proxy that serves its own bundle and forwards all REST and SSE traffic to that daemon, so **all arms render the same live sessions**:

| Arm | Port | Bundle |
| --- | --- | --- |
| base | 4939 | The 7 changed sources exactly as they are on `bc7a186` (checked with `git diff --quiet`) |
| revert | 4940 | Head with `4860e0a7e6` reverse-applied (2 files) |
| **head** | 4938 | `5c4f1de`. The rebuilt `index-BOiyY4sp.js` has the same hash as the bundle the daemon serves |
| lanefix | 4941 | Head plus the candidate lane patch. **Not part of this PR** |
| r8fix | 4942 | Head plus the author's proposed R8-2 patch. **Not part of this PR** |

The sessions are new and were created through the real Plan & Review flow. Since #11423, the approval option reads **"Approve and execute · Full Access"**.

- **DAG:** 5 steps in 3 layers, one return lane, and 8 linked agents (6 succeed, 1 stays running, 1 fails).
- **REVIEW:** the same plan, left unapproved, so the approval card shows the interactive graph.
- **BIG:** 50 steps with 525 dependencies.
- **NEST:** a background agent linked to step 1 whose subagent launches a nested agent. Both stay live.

The browser is headless Chromium driven by Playwright 1.58.2.

### 1. R6-3 fixed: arrowheads point into their target at every width

For each adjacent-layer edge I took the end tangent (end point minus last control point) from the rendered `[data-plan-edge]` path. All three adjacent edges give the same value at each width:

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
- head, zh-CN: `被阻塞 4 Compare findings and draft the migration plan 依赖： 1 Survey the public API surface, 2 Read the existing test suite`

The summary changes nothing visible. The span is `1×1`, `position: absolute` and `clip-path: inset(50%)`. Screenshots of the approval-card graph differ between revert and head in **0 pixels** (966×253), and every node has the same height in both arms. Each surface states a dependency exactly once:

| Surface | Visible chip rows | sr-only summaries |
| --- | --- | --- |
| Approval card (edges drawn) | 0 | 2 (steps 4 and 5) |
| Cockpit (`showStepDetails={false}`) | 2 | 0 |
| BIG, 525 dependencies (no edges) | 25 | 0 |

Mutants M14–M17 all fail the suites: summary removed, clip removed, raw ids instead of number and title, and summary rendered next to the visible chips.

### 3. R8-2, the open Critical, reproduces in a real session

Session NEST, cockpit view, all values from a single render:

| Arm | Node face | Agent rows on that node | Overview strip |
| --- | --- | --- | --- |
| **head** | **`1 agent`** | 2 (`Agent: Parent agent`, `↳ general-purpose: Nested probe`) | `2 Active agents` |
| r8fix (the author's patch from the thread) | `2 agents` | 2 | `2 Active agents` |
| base | no count on the face | 2 | `2 Active agents` |

![R8-2 in a real session](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-10938/r2/fig3-r8-2-agent-count.png)

The trigger is ordinary: a background agent whose subagent calls `agent`. Nesting is on by default (`DEFAULT_MAX_SUBAGENT_DEPTH = 5`), and `general-purpose` inherits the `agent` tool. The nested child appears as a live task with `parentAgentId`, but the parent tool call has no matching `subTools` entry. That is the "live task with no transcript entry" case the review describes. The count on the node face is new in this PR, so this mismatch is new too.

With the patch applied, the PR suites pass 86/87. The one failure is `groups executions by todo and keeps missing links unassigned`, where `test:512` reports ``expected 'Running2Build◐2 agents…' to contain '1 agent'``. That is the assertion the review said would have to move. The fix needs a fixture with a single root agent to keep the singular form tested, plus a test for a live nested child.

### 4. New: at ≤480px the return lane rises through the step between its ends

The router for edges that span more than one layer still uses fixed 24px shoulders: `dropX = startX + 24` and `riseX = endX - 24` at `:871-872`. An 18px gutter leaves only a 10px run, so the vertical segment lands 6px inside the neighbouring lane of nodes.

In the DAG session at 390px, the edge `check-docs → write-summary` (step 3 → step 5) rises at x=246, and step 4 spans x=140–256. The segment overlaps step 4 for 106px, and the SVG is painted under the nodes. So the blue lane runs up into step 4's bottom edge and disappears, and on a phone it looks like a dependency of step 4. The numbers:

- 430px: same crossing.
- 700px (32px gutter): the rise clears step 4 by 4px.
- 1440px: it clears step 4 by 36px.
- base: never crosses, because its gutters are always 64px.
- The drop segment has the same geometry: at 390px, x=150 falls inside layer 2's span. It misses a node here only because layer 2 has a single node.

This is the half of the thread that the author left for a maintainer decision, since round 1 only measured this edge's end tangent.

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

A first version used `corner = min(6, shoulder)`. At 18px that left a zero-length final segment, which is why the corner is halved.

### 5. Round-1 claims after the `main` merge

Head only, same live session. Every value round 1 measured still holds:

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

![Cockpit on head](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-10938/r2/fig4-cockpit-head.png)

### 6. Static checks, tests and CI

| Check | Result |
| --- | --- |
| `tsc -p packages/web-shell/tsconfig.json --noEmit` | ✅ 0 errors |
| `eslint` on the 9 changed TS/TSX files · `prettier --check` on all 13 changed files | ✅ · ✅ |
| `vitest run client/components/messages/PlanExecutionView client/components/workflow` | ✅ 9 files, 87 tests: the author's 84 plus the tests #11434 brought in through `main` |
| Full web-shell `vitest` | ✅ 311 files, 7691 tests |
| Mutation check: 18 mutants (round 1's 12, plus 6 against `4860e0a7e6`) | 17 fail the suites. **M7**, which drops `documentMode` from the gate, still passes them |
| CI at `5c4f1de` | Lint & Static, Test (ubuntu), web-shell E2E Smoke, Capture web-shell visuals, Integration (no-AK) and Desktop Shell all pass |

The author reported 353 `tsc` errors. Those come from their environment, which has no built `@qwen-code/sdk` dist. After a full `npm ci`, `tsc` exits 0.

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
- R8-2's other direction, a transcript `subTools` entry with no live task.

Figures, raw crops, JSON, logs, patches and the harness are in [`asserts/pr-10938/r2`](https://github.com/wenshao/qwen-code/tree/asserts/pr-10938/r2).
