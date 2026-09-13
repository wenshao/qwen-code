## Local runtime verification (round 3) — PR #10938 @ `d91a0f7e`

**Recommendation: merge once CI has actually run green on this head.** `d91a0f7e74` meets both conditions from round 2, and this round found nothing new:

- **The lane crossing is gone.** I checked the round-2 repro and a harder plan built for this round, where the layers a lane passes hold stacked steps and one edge skips two layers. At 700, 430 and 390px, every vertical lane segment now sits exactly on its gutter's centre line and crosses 0 steps. On the harder plan the previous head crossed 12. Desktop paths are byte-identical to the previous head.
- **The M20 test gap is closed.** Removing the `toolUseId` dedup now fails the new test.

One optional tightening remains. The lane test checks that each vertical stays inside its gutter, but not that it is centred, so mutant M24 survives (section 3). CI has not started on this head (section 4), so there is no CI signal yet.

### What changed since round 2

`d91a0f7e74` touches 2 files:

- **`PlanExecutionView.tsx` (+62/−10).** The router for layer-skipping edges now derives each shoulder from the gutter it crosses, `min(24, run / 2)`, and halves the corner radius so the curve still fits: `min(6, dropShoulder / 2, riseShoulder / 2)`. This is the round-2 candidate formula, with one difference: an unmeasured neighbouring layer falls back to the full 24px shoulder.
- **`PlanExecutionView.test.tsx` (+170).** Two new tests. One checks lane geometry on the 64/32/18px gutters and pins the desktop path as a golden string. The other checks that an agent seen both as a live task and in `subTools` is counted once.

### Environment

This round uses the same harness as rounds 1 and 2: Node 22.22.2 on Linux, and headless Chromium driven by Playwright 1.58.2. **One** real `qwen serve` daemon, built from `5c4f1de`, backs every arm. That build is still valid, because every commit after `5c4f1de` touches only web-shell client files: `git diff --stat 5c4f1de..d91a0f7e` shows 2 files, both under `packages/web-shell/client`. Each arm is a static proxy that serves its own bundle and forwards REST and SSE traffic to that daemon, so all arms render the same sessions.

| Arm | Port | Bundle |
| --- | --- | --- |
| base | 4939 | Sources from the merge base `bc7a186` |
| previous head | 4943 | `5f70a13` |
| lanefix | 4941 | Round-2 candidate patch. **Not part of this PR** |
| **head** | 4944 | `d91a0f7e`, from a fresh `vite build` |

Both sessions were created through the real Plan & Review flow: `enter_plan_mode` → `todo_write` with `blockedBy` → `exit_plan_mode` → **Approve and execute · Full Access**.

- **DAG** (from round 2): 5 steps in 3 layers. The edge `3 → 5` skips a layer, and the layer it passes holds a single step.
- **SKIP** (new this round): 7 steps in 4 layers, with 3 steps in layer 1 and 2 steps in layer 2. Three edges skip layers: `1 → 5` and `3 → 7` skip one layer each, and `1 → 7` skips two. Every drop and rise gutter borders a layer with several steps. The DAG session cannot show this: round 2 noted that its drop segment missed a node only because the layer it passes has one step.

### 1. The round-2 repro (DAG session)

| Viewport · gutter | Previous head `5f70a13` | **Head `d91a0f7e`** |
| --- | --- | --- |
| 1440 · 64px | 0 crossings | **All 4 paths byte-identical** to the previous head |
| 700 · 32px | Verticals at x=250 / 426 (gutters 222–254 / 422–454) | **x=238 / 438, the gutter centres.** End tangent (6, 0) |
| 430 · 18px | The rise at x=251 passes through step 4 (106px of overlap) | **x=136 / 270, centred.** 0 crossings, end tangent (2.5, 0) |
| 390 · 18px | The rise at x=246 passes through step 4 (106px of overlap) | **x=131 / 265, centred.** 0 crossings, end tangent (2.5, 0) |

At 700, 430 and 390px, all 4 paths are also byte-identical to the round-2 candidate. The adjacent-layer arrowheads keep the tangents the round-2 fix gave them: (28, 0), (12, 0) and (5, 0).

![DAG session at 390px: previous head vs head](https://raw.githubusercontent.com/wenshao/qwen-code/aa92de6e340196b4f0321c004b1c368e43a99751/pr-10938/r3/fig2-dag-390.png)

### 2. A harder plan: stacked layers and a two-layer skip (SKIP session)

| Viewport · gutter | base | Previous head `5f70a13` | **Head `d91a0f7e`** |
| --- | --- | --- | --- |
| 1440 · 64px | 0 crossings | 0 crossings | **0 crossings. All 11 paths byte-identical to the previous head and to the candidate** |
| 700 · 32px | 0 crossings (the gutter is 64px at every width) | 0 crossings, but all 6 verticals sit 12px off-centre, 4px from the next step | **All 6 verticals centred, end tangent (6, 0)** |
| 430 · 18px | 0 crossings | **12 lane/step overlaps.** `1→5` drops and rises through steps 3 and 4, `3→7` through steps 5 and 6, and `1→7` through steps 3/4 and 5/6. Each vertical lands 10px or 106px inside a step, with up to 142px of overlap | **0 overlaps. All verticals centred, end tangent (2.5, 0)** |
| 390 · 18px | 0 crossings | The same 12 overlaps | **0 overlaps. Centred, end tangent (2.5, 0)** |

**Live resize.** I resized one page on the head from 1440 → 700 → 390 → 1440px. At every step, all 11 paths are byte-identical to a fresh load at that width, with 0 crossings.

![SKIP session at 390px: previous head vs head](https://raw.githubusercontent.com/wenshao/qwen-code/aa92de6e340196b4f0321c004b1c368e43a99751/pr-10938/r3/fig1-skip-390.png)

![SKIP session at 700px: previous head vs head](https://raw.githubusercontent.com/wenshao/qwen-code/aa92de6e340196b4f0321c004b1c368e43a99751/pr-10938/r3/fig3-skip-700.png)

Harness notes:

- **I discarded my first 1440px pass.** The cockpit's graph viewport loads at different widths depending on inspector state (1132px or 628px), which moves every path by a constant offset. Each byte comparison above was made at the same viewport width. The narrow tiers are not affected.
- **Screenshots at ≤700px were taken with the inspector drawer closed.** The auto-selected step opens the drawer over the graph, so I dismissed it with Escape and checked with `elementFromPoint` that the graph was on top. The geometry is read from the DOM either way.

### 3. Tests, mutation checks and static checks at `d91a0f7e`

| Check | Result |
| --- | --- |
| `vitest run client/components/messages/PlanExecutionView client/components/workflow` | ✅ 9 files, **90 tests** (88 at `5f70a13`, plus the 2 new ones) |
| Full web-shell `vitest run` | ✅ 311 files, **7694 tests** |
| `tsc -p packages/web-shell/tsconfig.json --noEmit` | ✅ 0 errors |
| `eslint --max-warnings 0` on the 2 changed files · `prettier --check` on all 13 PR files | ✅ · ✅ |

Each mutant below is a small, deliberate break in the new router (or, for M20, the agent count), run against `PlanExecutionView.test.tsx`; "killed" means the tests caught it. The source was restored byte-for-byte after each run.

| Mutant | Result |
| --- | --- |
| M22: both shoulders back to a fixed 24px (the round-2 defect) | Killed: `18px drop column: expected 196 to be less than 186` |
| M28: only the drop keeps 24px · M29: only the rise keeps 24px | Killed · killed |
| M25: drop measured against its own layer · M26: rise measured against its own layer | Killed · killed |
| M23: corner not halved · M27: corner back to the 6px constant | Killed (`end tangent x: expected 0 …`) · killed (`… -1 …`) |
| M20: `toolUseId` dedup dropped (it survived in round 2) | **Killed** by `counts an agent seen as both a live task and a transcript sub-tool once` |
| **M24**: run not halved (`min(24, run)`) | **Survives** (43/43 pass) |

M24 is minor but real. Without the halving, at 18px the vertical lands at `nextLayer.left − 4`, right on the tips of the adjacent edges' arrowheads. At 32px it lands 4px from the next step, which is the previous head's 700px geometry. The test only asserts "strictly inside the gutter", so nothing checks the centring the code comment claims. To kill M24, assert on the 32px and 18px tiers that `dropX` is `(startX + leftOf(1) - 4) / 2`, and mirror that for `riseX`. This is optional.

### 4. CI and review state

- **CI has not run on `d91a0f7e`.** Qwen Code CI, Web-shell Visuals and the PR review workflow were created at 08:50 UTC and are still `queued` with 0 jobs. At the time of writing, 59 runs are queued across the repository while `main`'s CI keeps completing, so this looks like an Actions backlog rather than anything in the PR. The previous head `5f70a13` finished all green: Test (ubuntu), Lint & Static, web-shell E2E Smoke, web-shell visuals, Integration (no-AK) and Desktop Shell (ubuntu and windows). `d91a0f7e` changes only `PlanExecutionView.tsx` and its test, and the local runs in section 3 cover both.
- **It merges cleanly with current `main`.** `main` is at `eb780062`, 13 commits past the merge base, and none of those commits touch the PR's 13 files. On a local merge commit of the two (`d91a0f7e` + `eb780062`), the focused suites pass 90/90, full web-shell `vitest` passes 311 files and 7895 tests (the extra tests come from `main`), and `tsc` reports 0 errors.
- **11 review threads are unresolved** (9 not outdated). All of them are `[Suggestion]` test-guard hardening items that the author deferred on purpose: R2-5, R2-6, R4-1, R5-1 to R5-6, and the skills keep-set.
- **The PR is still marked `CHANGES_REQUESTED`.** That status comes from `qwen-code-ci-bot` reviews on earlier heads. Rounds 1–3 fixed their Criticals and verified the fixes at runtime, so merging needs a fresh review or a dismissal.

### Still open from earlier rounds

None of these block merge, and `d91a0f7e` does not touch any of them.

- `PlanExecutionView.module.css:247-250` still says a 390px phone "scrolls the last ~6px". The measured overflow is 30px.
- The chip row for more than 500 dependencies has no cap. Not re-measured this round.
- Focus falls to `<body>` after you activate a dependency link or "Show all" (D9-3). Not re-measured this round.
- Mutant M7 still survives. Not re-run this round.

### Not covered

- macOS and Windows.
- The light theme, for this round's captures.
- The path through the Plan & tasks dialog.

Figures, JSON facts, logs and the probe scripts are in [`asserts/pr-10938/r3`](https://github.com/wenshao/qwen-code/tree/asserts/pr-10938/r3).

<details>
<summary>中文版</summary>

## 本地真实环境验证（第三轮）—— PR #10938 @ `d91a0f7e`

**建议：等 CI 在这个 head 上真正跑绿后合并。** `d91a0f7e74` 满足了第二轮提出的两个合并条件，本轮没有发现新问题：

- **泳道穿越已消除。** 我检查了第二轮的复现会话，以及本轮专门构造的一个更难的计划：泳道经过的层里叠放了多个步骤，另有一条边跨两层。在 700、430、390px 下，每一段竖直泳道现在都正好落在所在间隙的中线上，与步骤的穿越为 0。上一个 head 在这个更难的计划上有 12 处。桌面端路径与上一个 head 逐字节相同。
- **M20 测试缺口已补上。** 去掉 `toolUseId` 去重后，新测试会失败。

还剩一处可选的收紧。泳道测试只检查每条竖线落在间隙内，没有检查它是否居中，所以变异 M24 能存活（见第 3 节）。这个 head 上的 CI 还没开始跑（见第 4 节），目前没有 CI 信号。

### 与第二轮相比的变化

`d91a0f7e74` 改了 2 个文件：

- **`PlanExecutionView.tsx`（+62/−10）。** 跨层边的路由现在按每一侧实际经过的间隙推导肩宽 `min(24, run / 2)`，并把转角半径减半，让曲线仍然放得下：`min(6, dropShoulder / 2, riseShoulder / 2)`。这就是第二轮候选补丁的公式，只有一处差别：相邻层没有测量到时，回退为完整的 24px 肩宽。
- **`PlanExecutionView.test.tsx`（+170）。** 新增两个测试。一个检查 64/32/18px 三档间隙下的泳道几何，并把桌面端路径钉成 golden 字符串。另一个检查：同时以实时任务和 `subTools` 条目出现的 agent 只计一次。

### 环境

本轮沿用前两轮的验证环境：Linux 上的 Node 22.22.2，浏览器是 Playwright 1.58.2 驱动的无头 Chromium。所有分支共用**一个**由 `5c4f1de` 构建的真实 `qwen serve` daemon。这个构建仍然有效，因为 `5c4f1de` 之后的每个提交都只改 web-shell 客户端文件：`git diff --stat 5c4f1de..d91a0f7e` 只列出 2 个文件，都在 `packages/web-shell/client` 下。每个分支是一个静态代理：提供自己的 bundle，把 REST 和 SSE 请求转发给这个 daemon，所以所有分支渲染的是同一批会话。

| 分支 | 端口 | bundle |
| --- | --- | --- |
| base | 4939 | merge base `bc7a186` 的源文件 |
| 上一个 head | 4943 | `5f70a13` |
| lanefix | 4941 | 第二轮的候选补丁，**不属于本 PR** |
| **head** | 4944 | `d91a0f7e`，重新 `vite build` 所得 |

两个会话都通过真实的 Plan & Review 流程创建：`enter_plan_mode` → 带 `blockedBy` 的 `todo_write` → `exit_plan_mode` → **Approve and execute · Full Access**。

- **DAG**（沿用第二轮）：5 个步骤分 3 层。边 `3 → 5` 跨过一层，它经过的那一层只有一个步骤。
- **SKIP**（本轮新建）：7 个步骤分 4 层，第 1 层 3 个步骤，第 2 层 2 个步骤。有三条跨层边：`1 → 5` 和 `3 → 7` 各跨一层，`1 → 7` 跨两层。每个下降间隙和上升间隙都紧挨着一个有多个步骤的层。DAG 会话展示不了这种情况：第二轮就指出，它的下降段没有碰到节点，只是因为经过的那一层恰好只有一个步骤。

### 1. 第二轮的复现（DAG 会话）

| 视口 · 间隙 | 上一个 head `5f70a13` | **head `d91a0f7e`** |
| --- | --- | --- |
| 1440 · 64px | 0 处穿越 | **4 条路径与上一个 head 逐字节相同** |
| 700 · 32px | 竖线在 x=250 / 426（间隙 222–254 / 422–454） | **x=238 / 438，正好是间隙中线。** 末端切线 (6, 0) |
| 430 · 18px | x=251 处的上升段穿过步骤 4（重叠 106px） | **x=136 / 270，居中。** 0 处穿越，末端切线 (2.5, 0) |
| 390 · 18px | x=246 处的上升段穿过步骤 4（重叠 106px） | **x=131 / 265，居中。** 0 处穿越，末端切线 (2.5, 0) |

在 700、430、390px 下，这 4 条路径也与第二轮的候选补丁逐字节相同。相邻层边的箭头保持第二轮修复后的切线：(28, 0)、(12, 0)、(5, 0)。

![390px 下的 DAG 会话：上一个 head vs head](https://raw.githubusercontent.com/wenshao/qwen-code/aa92de6e340196b4f0321c004b1c368e43a99751/pr-10938/r3/fig2-dag-390.png)

### 2. 更难的计划：多步骤层与跨两层的边（SKIP 会话）

| 视口 · 间隙 | base | 上一个 head `5f70a13` | **head `d91a0f7e`** |
| --- | --- | --- | --- |
| 1440 · 64px | 0 处穿越 | 0 处穿越 | **0 处穿越。11 条路径与上一个 head、候选补丁都逐字节相同** |
| 700 · 32px | 0 处穿越（任何宽度下间隙都是 64px） | 0 处穿越，但 6 条竖线都偏离中线 12px，离下一个步骤只有 4px | **6 条竖线全部居中，末端切线 (6, 0)** |
| 430 · 18px | 0 处穿越 | **泳道与步骤重叠 12 处。** `1→5` 的下降段和上升段穿过步骤 3 和 4，`3→7` 穿过步骤 5 和 6，`1→7` 穿过步骤 3/4 和 5/6。每条竖线落在步骤内部 10px 或 106px 处，重叠最高 142px | **0 处重叠。竖线全部居中，末端切线 (2.5, 0)** |
| 390 · 18px | 0 处穿越 | 同样的 12 处重叠 | **0 处重叠。居中，末端切线 (2.5, 0)** |

**实时缩放。** 我在 head 上把同一个页面从 1440 → 700 → 390 → 1440px 依次缩放。每一步的 11 条路径都与该宽度下刷新加载的结果逐字节相同，且都没有穿越。

![390px 下的 SKIP 会话：上一个 head vs head](https://raw.githubusercontent.com/wenshao/qwen-code/aa92de6e340196b4f0321c004b1c368e43a99751/pr-10938/r3/fig1-skip-390.png)

![700px 下的 SKIP 会话：上一个 head vs head](https://raw.githubusercontent.com/wenshao/qwen-code/aa92de6e340196b4f0321c004b1c368e43a99751/pr-10938/r3/fig3-skip-700.png)

验证环境说明：

- **第一遍 1440px 的测量结果已作废。** cockpit 图区域的宽度取决于 inspector 的状态，每次加载可能是 1132px，也可能是 628px，这会让所有路径整体平移一个固定偏移。上面每次逐字节比对都是在相同视口宽度下做的，窄屏档位不受影响。
- **≤700px 的截图是在关闭 inspector 抽屉后拍的。** 自动选中的步骤会弹出抽屉盖住图，所以我先按 Escape 关掉，再用 `elementFromPoint` 确认图在最上层。几何数据是从 DOM 读取的，不受遮挡影响。

### 3. `d91a0f7e` 上的测试、变异与静态检查

| 检查 | 结果 |
| --- | --- |
| `vitest run client/components/messages/PlanExecutionView client/components/workflow` | ✅ 9 个文件、**90 个用例**（`5f70a13` 上是 88 个，加上 2 个新用例） |
| web-shell 全量 `vitest run` | ✅ 311 个文件、**7694 个用例** |
| `tsc -p packages/web-shell/tsconfig.json --noEmit` | ✅ 0 个错误 |
| 对 2 个改动文件跑 `eslint --max-warnings 0` · 对 PR 全部 13 个文件跑 `prettier --check` | ✅ · ✅ |

下表每个变异体都是对新路由（M20 则是 agent 计数）做的一处小而刻意的破坏，再跑 `PlanExecutionView.test.tsx`；“被抓到”表示测试能发现这处破坏。每次跑完都把源文件逐字节还原。

| 变异 | 结果 |
| --- | --- |
| M22：两侧肩宽都退回固定 24px（即第二轮的缺陷） | 被抓到：`18px drop column: expected 196 to be less than 186` |
| M28：只有下降段保留 24px · M29：只有上升段保留 24px | 被抓到 · 被抓到 |
| M25：下降段按自身所在层测量 · M26：上升段按自身所在层测量 | 被抓到 · 被抓到 |
| M23：转角不减半 · M27：转角退回 6px 常量 | 被抓到（`end tangent x: expected 0 …`）· 被抓到（`… -1 …`） |
| M20：去掉 `toolUseId` 去重（第二轮存活） | **被新测试 `counts an agent seen as both a live task and a transcript sub-tool once` 抓到** |
| **M24**：跨度不减半（`min(24, run)`） | **存活**（43/43 通过） |

M24 影响很小，但确实存在。不减半时，18px 间隙下竖线落在 `nextLayer.left − 4`，正好压在相邻边箭头的尖端上；32px 间隙下竖线离下一个步骤只有 4px，也就是上一个 head 在 700px 下的几何。测试只断言“严格位于间隙内”，所以代码注释声称的居中没有被任何测试检查。要抓到 M24，可以在 32px 和 18px 两档上断言 `dropX` 等于 `(startX + leftOf(1) - 4) / 2`，`riseX` 同理。这一项可选。

### 4. CI 与评审状态

- **`d91a0f7e` 上的 CI 还没跑。** Qwen Code CI、Web-shell Visuals 和 PR review 工作流都在 08:50 UTC 创建，至今仍是 `queued`，一个 job 都没有。撰写本报告时，整个仓库有 59 个 run 在排队，而 `main` 的 CI 一直在正常完成，所以这看起来是 Actions 积压，与 PR 本身无关。上一个 head `5f70a13` 的 CI 全绿：Test (ubuntu)、Lint & Static、web-shell E2E Smoke、web-shell visuals、Integration (no-AK)、Desktop Shell（ubuntu 和 windows）。`d91a0f7e` 只改了 `PlanExecutionView.tsx` 及其测试，第 3 节的本地运行覆盖了这两个文件。
- **与当前 `main` 可以无冲突合并。** `main` 现在是 `eb780062`，比 merge base 多 13 个提交，这些提交都没有改动本 PR 的 13 个文件。在本地把两者（`d91a0f7e` + `eb780062`）合成一个合并提交后：聚焦测试 90/90 通过，web-shell 全量 `vitest` 311 个文件、7895 个用例通过（多出的用例来自 `main`），`tsc` 0 个错误。
- **还有 11 个评审 thread 未解决**（其中 9 个未过期）。全部是作者有意推迟的 `[Suggestion]` 类测试守卫加固：R2-5、R2-6、R4-1、R5-1 至 R5-6，以及 skills keep-set。
- **PR 仍标记为 `CHANGES_REQUESTED`。** 这个状态来自 `qwen-code-ci-bot` 在更早 head 上的评审。那些 Critical 已在第 1–3 轮修复，并在运行时验证过，所以合并前需要一次新的评审，或者 dismiss 旧评审。

### 前几轮遗留项

这些都不阻断合并，`d91a0f7e` 也没有改动其中任何一项。

- `PlanExecutionView.module.css:247-250` 的注释仍写着 390px 手机“最后约 6px 需要滚动”，实测溢出是 30px。
- 依赖超过 500 条时，chip 行没有上限。本轮未重测。
- 激活依赖链接或 “Show all” 后，焦点掉到 `<body>`（D9-3）。本轮未重测。
- 变异 M7 仍然存活。本轮未重跑。

### 未覆盖

- macOS 和 Windows。
- 浅色主题（本轮的截图）。
- 经由 Plan & tasks 对话框的路径。

图、JSON 数据、日志和探针脚本都在 [`asserts/pr-10938/r3`](https://github.com/wenshao/qwen-code/tree/asserts/pr-10938/r3)。

</details>
